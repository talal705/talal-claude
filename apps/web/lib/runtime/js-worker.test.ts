// Runs the real JavaScript worker source (the text that is sent into the sandbox) in a Node worker
// thread, with a few lines that stand in for the browser's worker globals. Node cannot import
// blob: URLs, so the stand-in hands out data: URLs; everything else is the code learners will run on.
import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { buildModulePlan, type ModuleFile } from "./modules";
import { parseSandboxMessage, type SandboxMessage } from "./protocol";
import { JS_WORKER_SOURCE } from "./sandbox-sources";
import { describeRuntimeError } from "./stack";

const EXECUTION_ID = "33333333-3333-4333-8333-333333333333";

const BROWSER_STAND_IN = `
const { parentPort } = require("node:worker_threads");
globalThis.self = globalThis;
self.postMessage = (message) => parentPort.postMessage(message);
self.addEventListener = () => {};
globalThis.Blob = class { constructor(parts) { this.text = parts.join(""); } };
URL.createObjectURL = (blob) => "data:text/javascript;base64," + Buffer.from(blob.text).toString("base64");
parentPort.on("message", (data) => { if (self.onmessage) self.onmessage({ data }); });
`;

async function runInWorker(files: ModuleFile[], entry: string, stdin = ""): Promise<SandboxMessage[]> {
  const planned = await buildModulePlan(files, entry);
  if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics));
  const worker = new Worker(BROWSER_STAND_IN + JS_WORKER_SOURCE.replace('"use strict";', ""), { eval: true });
  const messages: SandboxMessage[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no "done" within 10 s; got ${JSON.stringify(messages)}`)), 10_000);
      worker.on("error", reject);
      worker.on("message", (data: unknown) => {
        const message = parseSandboxMessage(data, EXECUTION_ID);
        // Every message the worker sends must pass the page's validation.
        if (!message) return reject(new Error(`invalid message: ${JSON.stringify(data)}`));
        messages.push(message);
        if (message.type === "done") {
          clearTimeout(timer);
          resolve();
        }
      });
      worker.postMessage({ executionId: EXECUTION_ID, modules: planned.plan.modules, entry: planned.plan.entry, stdin });
    });
  } finally {
    await worker.terminate();
  }
  return messages;
}

const stdout = (messages: SandboxMessage[]) => messages.map((message) => (message.type === "output" && message.stream === "stdout" ? message.text : "")).join("");
const stderr = (messages: SandboxMessage[]) => messages.map((message) => (message.type === "output" && message.stream === "stderr" ? message.text : "")).join("");

describe("JavaScript worker source", { timeout: 20_000 }, () => {
  it("runs a program, captures the console and ends with exit code 0", async () => {
    const messages = await runInWorker(
      [{ path: "main.js", source: 'console.log("Hello,", "lab!");\nconsole.info(1 + 2, true, null, undefined);\nconsole.warn("careful");\nconsole.error("bad");\n' }],
      "main.js",
    );
    expect(messages[0]).toEqual({ type: "ready" });
    expect(messages.at(-1)).toEqual({ type: "done", exitCode: 0 });
    expect(stdout(messages)).toBe("Hello, lab!\n3 true null undefined\n");
    expect(stderr(messages)).toBe("careful\nbad\n");
  });

  it("formats objects, arrays, maps, errors and cycles readably", async () => {
    const messages = await runInWorker(
      [
        {
          path: "main.js",
          source: `class Point { constructor() { this.x = 1; this.y = 2; } }
const loop = { name: "loop" }; loop.self = loop;
console.log({ a: 1, b: "two", c: [1, 2, { d: null }] });
console.log([1, "a", [2]], new Point(), new Map([["k", 1]]), new Set([1]));
console.log(loop, () => 1, function named() {}, 10n, Symbol("s"));
console.log(new Date(0), /re/g, {});
console.log("%s is not substituted", "text");
`,
        },
      ],
      "main.js",
    );
    expect(stdout(messages).split("\n")).toEqual([
      '{ a: 1, b: "two", c: [1, 2, { d: null }] }',
      '[1, "a", [2]] Point { x: 1, y: 2 } Map(1) [["k", 1]] Set(1) [1]',
      '{ name: "loop", self: [Circular] } [Function] [Function: named] 10n Symbol(s)',
      "1970-01-01T00:00:00.000Z /re/g {}",
      "%s is not substituted text",
      "",
    ]);
  });

  it("runs a multi-file project through its imports", async () => {
    const messages = await runInWorker(
      [
        { path: "main.js", source: 'import { area } from "./shapes/area.js";\nimport label from "./label.js";\nconsole.log(label(area(6, 7)));\n' },
        { path: "shapes/area.js", source: 'import { multiply } from "../math.js";\nexport const area = (w, h) => multiply(w, h);\n' },
        { path: "math.js", source: "export const multiply = (a, b) => a * b;\n" },
        { path: "label.js", source: "export default (n) => `area = ${n}`;\n" },
      ],
      "main.js",
    );
    expect(stdout(messages)).toBe("area = 42\n");
    expect(messages.at(-1)).toEqual({ type: "done", exitCode: 0 });
  });

  it("gives the program its stdin line by line, then null", async () => {
    const messages = await runInWorker(
      [{ path: "main.js", source: 'const name = readLine();\nconst a = Number(readLine()), b = Number(readLine());\nconsole.log(`Hi ${name}, ${a + b}`);\nconsole.log(readLine(), readLine());\n' }],
      "main.js",
      "سارة\r\n19\n23\n",
    );
    expect(stdout(messages)).toBe("Hi سارة, 42\nnull null\n");
  });

  it("reports an uncaught error with the project file and line, keeping earlier output", async () => {
    const messages = await runInWorker(
      [
        { path: "main.js", source: 'import { risky } from "./lib/risky.js";\nconsole.log("before");\nrisky();\nconsole.log("never");\n' },
        { path: "lib/risky.js", source: "export function risky() {\n  const value = undefined;\n  return value.length;\n}\n" },
      ],
      "main.js",
    );
    expect(stdout(messages)).toBe("before\n");
    expect(messages.at(-1)).toEqual({ type: "done", exitCode: 1 });
    const error = messages.find((message) => message.type === "error");
    if (error?.type !== "error") throw new Error("no error message");
    expect(error.name).toBe("TypeError");
    expect(error.stack).not.toContain("data:");
    const report = describeRuntimeError(error);
    expect(report.diagnostic).toMatchObject({ severity: "error", source: "runtime", file: "lib/risky.js", line: 3 });
    expect(report.diagnostic.message).toMatch(/^TypeError: /);
    expect(report.text).toContain("    at lib/risky.js:3:");
    expect(report.text).toContain("    at main.js:3:");
  });

  it("reports a thrown non-error value and a rejected top-level await", async () => {
    const thrown = await runInWorker([{ path: "main.js", source: 'throw "just a string";\n' }], "main.js");
    expect(thrown.find((message) => message.type === "error")).toEqual({ type: "error", name: "", message: "just a string", stack: "" });
    expect(thrown.at(-1)).toEqual({ type: "done", exitCode: 1 });

    const rejected = await runInWorker([{ path: "main.js", source: 'await Promise.reject(new RangeError("too big"));\n' }], "main.js");
    expect(rejected.find((message) => message.type === "error")).toMatchObject({ name: "RangeError", message: "too big" });
  });

  it("waits for timers and top-level await before reporting the end", async () => {
    const messages = await runInWorker(
      [
        {
          path: "main.js",
          source: `console.log("start");
setTimeout(() => { console.log("timeout"); setTimeout(() => console.log("nested"), 20); }, 30);
let ticks = 0;
const id = setInterval(() => { console.log("tick", ++ticks); if (ticks === 3) clearInterval(id); }, 10);
const cancelled = setTimeout(() => console.log("never"), 5);
clearTimeout(cancelled);
await new Promise((resolve) => setTimeout(resolve, 5));
console.log("after await");
`,
        },
      ],
      "main.js",
    );
    const lines = stdout(messages).trim().split("\n");
    expect(lines[0]).toBe("start");
    expect(lines).toContain("after await");
    expect(lines).toContain("tick 3");
    expect(lines).not.toContain("never");
    expect(lines.indexOf("nested")).toBeGreaterThan(lines.indexOf("timeout"));
    // "done" comes after the last output.
    expect(messages.at(-1)).toEqual({ type: "done", exitCode: 0 });
    expect(messages.filter((message) => message.type === "done")).toHaveLength(1);
  });
});
