// Node only, for tests of lesson content: runs a JavaScript or Python program through the
// platform's own runtime code and returns the ExecutionResult the browser adapter would give.
// What is the same as in the browser: the worker source (JavaScript), the Pyodide core (Python),
// module linking, the message protocol, output caps, error and traceback reading, the result.
// What differs: there is no sandbox frame (Node has none), and blob: URLs become data: URLs.
// Never import this from application code: it loads node:worker_threads.
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { RUNTIME_CONFIGS, type CodeDiagnostic, type CodeFile, type ExecutionRequest, type ExecutionResult } from "@ytl/contracts";
import { buildModulePlan, pickEntry } from "./modules";
import { createProgramSession, type ProgramSession } from "./program-session";
import { parseSandboxMessage } from "./protocol";
import { parsePythonTraceback } from "./python-traceback";
import { buildResult, formatDiagnostics } from "./result";
import { JS_WORKER_SOURCE, PYTHON_CORE_SOURCE } from "./sandbox-sources";

export interface TestProgramInput {
  track: "javascript" | "python";
  files: readonly { name: string; content: string }[];
  stdin?: string;
}

export interface TestProgramOptions {
  /** Default: the track's limit in RUNTIME_CONFIGS (10 s JavaScript, 30 s Python). */
  timeoutMs?: number;
}

// Stand-ins for the browser worker globals the worker source uses.
const JS_STAND_IN = `
const { parentPort } = require("node:worker_threads");
globalThis.self = globalThis;
self.postMessage = (message) => parentPort.postMessage(message);
self.addEventListener = (type, listener) => {
  if (type === "unhandledrejection") process.on("unhandledRejection", (reason) => listener({ reason, preventDefault() {} }));
  if (type === "error") process.on("uncaughtException", (error) => listener({ error, message: String(error && error.message), preventDefault() {} }));
};
globalThis.Blob = class { constructor(parts) { this.text = parts.join(""); } };
URL.createObjectURL = (blob) => "data:text/javascript;base64," + Buffer.from(blob.text).toString("base64");
parentPort.on("message", (data) => { if (self.onmessage) self.onmessage({ data }); });
`;

// A long-lived worker holding one Pyodide, reused between calls (loading takes about a second).
// The project folder and its imported modules are cleared before each run.
const PYTHON_WORKER = (pyodidePath: string) => `
const { parentPort } = require("node:worker_threads");
${PYTHON_CORE_SOURCE}
const RESET = [
  "import os, shutil, sys",
  "os.chdir('/')",
  "shutil.rmtree('/project', ignore_errors=True)",
  "for name, module in list(sys.modules.items()):",
  "    if str(getattr(module, '__file__', '') or '').startswith('/project/'):",
  "        del sys.modules[name]",
  "sys.path[:] = [entry for entry in sys.path if not entry.startswith('/project')]",
].join("\\n");
let ready = null;
parentPort.on("message", async (init) => {
  const send = (message) => parentPort.postMessage({ ...message, ytl: 1, executionId: init.executionId });
  try {
    ready ??= require(${JSON.stringify(pyodidePath)}).loadPyodide();
    const pyodide = await ready;
    pyodide.runPython(RESET);
    const exitCode = await ytlRunPython(pyodide, init, send);
    send({ type: "done", exitCode });
  } catch (error) {
    send({ type: "error", name: String(error && error.name || "Error"), message: String(error && error.message || error), stack: "" });
    send({ type: "done", exitCode: 1 });
  }
});
`;

let pythonWorker: Worker | null = null;

function request(input: TestProgramInput): ExecutionRequest {
  const files: CodeFile[] = input.files.map((file, order) => ({ id: `f${order}`, name: file.name, language: input.track, content: file.content, order }));
  return { projectId: "lesson-test", revision: 1, track: input.track, files, stdin: input.stdin ?? "" };
}

/** Feeds a worker's messages through a session until the program ends, the time runs out, or the worker fails. */
function drive(worker: Worker, executionId: string, session: ProgramSession, timeoutMs: number, init: unknown): Promise<{ status: "success" | "error" | "output_limit" | "timeout" | "start_failed"; exitCode?: number; message?: string }> {
  return new Promise((resolve) => {
    const finish = (outcome: { status: "success" | "error" | "output_limit" | "timeout" | "start_failed"; exitCode?: number; message?: string }) => {
      clearTimeout(timer);
      worker.off("message", onMessage);
      worker.off("error", onError);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ status: "timeout" }), timeoutMs);
    const onError = (error: Error) => finish({ status: "start_failed", message: error.message });
    const onMessage = (data: unknown) => {
      const message = parseSandboxMessage(data, executionId);
      if (!message) return;
      const event = session.handle(message);
      if (event?.kind === "ended") finish({ status: event.status, exitCode: event.exitCode });
      else if (event?.kind === "start_failed") finish({ status: "start_failed", message: event.message });
    };
    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.postMessage(init);
  });
}

/**
 * Runs the program and returns its result: `success` with stdout, `error` with diagnostics
 * (file and line) for a runtime error or a failed import, `timeout`, or `output_limit`.
 * The entry file follows the adapters' rule: `main.js` / `index.js`, `main.py`, else the first file of the track.
 */
export async function runProgramForTest(input: TestProgramInput, options: TestProgramOptions = {}): Promise<ExecutionResult> {
  const executionId = randomUUID();
  const req = request(input);
  const limits = RUNTIME_CONFIGS[input.track];
  const timeoutMs = options.timeoutMs ?? limits.timeoutMs;
  const startedAt = performance.now();
  const sorted = [...req.files].sort((a, b) => a.order - b.order);

  if (input.track === "javascript") {
    const modules = sorted.filter((file) => /\.m?js$/i.test(file.name)).map((file) => ({ path: file.name, source: file.content }));
    const entry = pickEntry(modules.map((module) => module.path), ["main.js", "index.js"], [".js", ".mjs"]);
    const compileError = (message: string, diagnostics: CodeDiagnostic[] = [{ severity: "error", message, source: "compiler" }]) =>
      buildResult(req, executionId, { status: "error", phase: "compile", diagnostics, compilerOutput: formatDiagnostics(diagnostics), elapsedMs: performance.now() - startedAt });
    if (entry === null) return compileError("This project has no JavaScript file to run.");
    const planned = await buildModulePlan(modules, entry);
    if (!planned.ok) return compileError("", planned.diagnostics);

    const session = createProgramSession({ maxOutputBytes: limits.maxOutputBytes });
    const worker = new Worker(JS_STAND_IN + JS_WORKER_SOURCE.replace('"use strict";', ""), { eval: true });
    try {
      const outcome = await drive(worker, executionId, session, timeoutMs, { executionId, modules: planned.plan.modules, entry: planned.plan.entry, stdin: req.stdin });
      return toResult(req, executionId, session, outcome, startedAt);
    } finally {
      await worker.terminate();
    }
  }

  const files = sorted.map((file) => ({ path: file.name, content: file.content }));
  const entry = pickEntry(files.map((file) => file.path), ["main.py"], [".py"]);
  if (entry === null) {
    const diagnostics = [{ severity: "error" as const, message: "This project has no Python file to run.", source: "compiler" as const }];
    return buildResult(req, executionId, { status: "error", phase: "compile", diagnostics, compilerOutput: formatDiagnostics(diagnostics), elapsedMs: 0 });
  }
  pythonWorker ??= new Worker(PYTHON_WORKER(createRequire(import.meta.url).resolve("pyodide")), { eval: true });
  const worker = pythonWorker;
  const session = createProgramSession({ maxOutputBytes: limits.maxOutputBytes, diagnoseStderr: parsePythonTraceback });
  const outcome = await drive(worker, executionId, session, timeoutMs, { executionId, files, entry, stdin: req.stdin });
  // An endless loop holds the interpreter: the worker is replaced, as the browser replaces its frame.
  if (outcome.status === "timeout" || outcome.status === "output_limit" || outcome.status === "start_failed") {
    pythonWorker = null;
    await worker.terminate();
  }
  return toResult(req, executionId, session, outcome, startedAt);
}

function toResult(
  req: ExecutionRequest,
  executionId: string,
  session: ProgramSession,
  outcome: { status: "success" | "error" | "output_limit" | "timeout" | "start_failed"; exitCode?: number; message?: string },
  startedAt: number,
): ExecutionResult {
  const elapsedMs = performance.now() - startedAt;
  if (outcome.status === "start_failed") {
    return buildResult(req, executionId, { status: "runner_unavailable", phase: null, unavailableReason: "internal_error", message: outcome.message, elapsedMs });
  }
  return buildResult(req, executionId, {
    status: outcome.status,
    phase: "run",
    output: session.output,
    diagnostics: session.diagnostics,
    ...(outcome.exitCode === undefined ? {} : { exitCode: outcome.exitCode }),
    elapsedMs,
    runMs: elapsedMs,
  });
}

/** Ends the shared Python worker so a test process can exit. Call it in `afterAll`. */
export async function stopTestRuntimes(): Promise<void> {
  const worker = pythonWorker;
  pythonWorker = null;
  if (worker) await worker.terminate();
}
