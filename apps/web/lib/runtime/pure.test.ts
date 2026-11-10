// The parts of the browser adapters that need no browser.
import { describe, expect, it } from "vitest";
import type { ExecutionRequest } from "@ytl/contracts";
import { buildModulePlan, pickEntry, positionAt, resolveSpecifier, type ModulePlan } from "./modules";
import { OutputCollector } from "./output";
import { parseSandboxMessage } from "./protocol";
import { parsePythonTraceback } from "./python-traceback";
import { buildResult, formatDiagnostics, unavailableResult } from "./result";
import { createRun } from "./run";
import { createSourceMapLookup, decodeVlq } from "./sourcemap";
import { describeRuntimeError, parseStackFrames } from "./stack";

const request: ExecutionRequest = {
  projectId: "p1",
  revision: 3,
  track: "javascript",
  files: [{ id: "a", name: "main.js", language: "javascript", content: "", order: 0 }],
};

/** Links a plan the way the sandbox does, with data: URLs standing in for blob: URLs. */
function link(plan: ModulePlan): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const module of plan.modules) {
    const source = module.chunks.map((chunk) => (typeof chunk === "string" ? chunk : JSON.stringify(urls[chunk.dep]))).join("");
    expect(source).not.toContain("undefined");
    urls[module.path] = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  }
  return urls;
}

describe("module plan", () => {
  it("orders modules after their imports and cuts the source at each specifier", async () => {
    const result = await buildModulePlan(
      [
        { path: "main.js", source: 'import { area } from "./lib/shapes.js";\nimport total from \'./lib/sum.js\';\nexport const answer = total([area(2, 3), 36]);\n' },
        { path: "lib/shapes.js", source: 'import { multiply } from "./math.js";\nexport const area = (w, h) => multiply(w, h);\n' },
        { path: "lib/math.js", source: "export const multiply = (a, b) => a * b;\n" },
        { path: "lib/sum.js", source: 'import { multiply } from "../lib/math.js";\nexport default (xs) => xs.reduce((a, b) => a + multiply(b, 1), 0);\n' },
        { path: "unused.js", source: 'import "./nowhere.js";\n' },
      ],
      "main.js",
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.plan.entry).toBe("main.js");
    expect(result.plan.modules.map((module) => module.path)).toEqual(["lib/math.js", "lib/shapes.js", "lib/sum.js", "main.js"]);
    expect(result.plan.modules[3].chunks).toEqual([
      "import { area } from ",
      { dep: "lib/shapes.js" },
      ";\nimport total from ",
      { dep: "lib/sum.js" },
      ";\nexport const answer = total([area(2, 3), 36]);\n",
    ]);

    // The linked modules really load and run.
    const urls = link(result.plan);
    const loaded = (await import(/* @vite-ignore */ urls["main.js"])) as { answer: number };
    expect(loaded.answer).toBe(42);
  });

  it("links literal dynamic imports, re-exports and side-effect imports, and keeps line numbers", async () => {
    const source = '// first line\nexport * from "./a.js";\nimport "./b.js";\nconst later = await import("./a.js");\nexport const value = later.one + 1;\nconst skipped = (name) => import(name);\n';
    const result = await buildModulePlan(
      [
        { path: "main.js", source },
        { path: "a.js", source: "export const one = 1;\n" },
        { path: "b.js", source: "globalThis.__ytlSideEffect = true;\n" },
      ],
      "main.js",
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const main = result.plan.modules.find((module) => module.path === "main.js")!;
    expect(main.chunks.filter((chunk) => typeof chunk !== "string")).toEqual([{ dep: "a.js" }, { dep: "b.js" }, { dep: "a.js" }]);
    const text = main.chunks.map((chunk) => (typeof chunk === "string" ? chunk : '"X"')).join("");
    expect(text).toBe(source.replaceAll('"./a.js"', '"X"').replaceAll('"./b.js"', '"X"'));
    expect(text.split("\n")).toHaveLength(source.split("\n").length);

    const loaded = (await import(/* @vite-ignore */ link(result.plan)["main.js"])) as { value: number; one: number };
    expect([loaded.value, loaded.one]).toEqual([2, 1]);
  });

  it("does not treat import-like text in strings and comments as imports", async () => {
    const result = await buildModulePlan(
      [{ path: "main.js", source: '// import x from "./missing.js";\nconst text = \'import y from "./also-missing.js"\';\nconst t = `import("./nope.js")`;\nexport default text + t;\n' }],
      "main.js",
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.plan.modules[0].chunks).toHaveLength(1);
  });

  it("reports a missing file, a package import and a missing entry with positions", async () => {
    const result = await buildModulePlan(
      [{ path: "src/main.js", source: 'import a from "./a.js";\nimport _ from "lodash";\n  import up from "../../outside.js";\n' }],
      "src/main.js",
    );
    expect(result).toEqual({
      ok: false,
      diagnostics: [
        { severity: "error", message: 'Cannot find the file "./a.js" imported here.', file: "src/main.js", line: 1, column: 16, source: "compiler" },
        expect.objectContaining({ file: "src/main.js", line: 2, column: 16, message: expect.stringContaining('Cannot import "lodash"') }),
        expect.objectContaining({ file: "src/main.js", line: 3, column: 19, message: expect.stringContaining("../../outside.js") }),
      ],
    });
    const missing = await buildModulePlan([], "main.js");
    expect(missing.ok).toBe(false);
  });

  it("reports a circular import instead of looping", async () => {
    const result = await buildModulePlan(
      [
        { path: "main.js", source: 'import "./a.js";\n' },
        { path: "a.js", source: 'import "./b.js";\n' },
        { path: "b.js", source: 'import "./a.js";\n' },
      ],
      "main.js",
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.diagnostics).toEqual([expect.objectContaining({ file: "b.js", message: expect.stringContaining("a.js -> b.js -> a.js") })]);
  });

  it("reports a file the lexer cannot read", async () => {
    const result = await buildModulePlan([{ path: "main.js", source: 'import { from "./a.js";\n' }], "main.js");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.diagnostics[0]).toMatchObject({ file: "main.js", severity: "error", message: expect.stringContaining("Syntax error") });
  });

  it("resolves specifiers the ways learners write them, and never outside the project", () => {
    const paths = new Set(["main.js", "util.js", "lib/math.js", "lib/index.js", "data.mjs"]);
    expect(resolveSpecifier("./util.js", "main.js", paths)).toBe("util.js");
    expect(resolveSpecifier("./util", "main.js", paths)).toBe("util.js");
    expect(resolveSpecifier("./util.ts", "main.js", paths)).toBe("util.js");
    expect(resolveSpecifier("./data", "main.js", paths)).toBe("data.mjs");
    expect(resolveSpecifier("./lib", "main.js", paths)).toBe("lib/index.js");
    expect(resolveSpecifier("../util.js", "lib/math.js", paths)).toBe("util.js");
    expect(resolveSpecifier("./math.js", "lib/index.js", paths)).toBe("lib/math.js");
    expect(resolveSpecifier("/lib/math.js", "lib/index.js", paths)).toBe("lib/math.js");
    expect(resolveSpecifier("../../etc/passwd", "lib/math.js", paths)).toBeNull();
    expect(resolveSpecifier("./missing.js", "main.js", paths)).toBeNull();
    expect(resolveSpecifier("util.js", "main.js", paths)).toBeNull();
    expect(resolveSpecifier("https://example.com/x.js", "main.js", paths)).toBeNull();
  });

  it("picks the entry file and computes positions", () => {
    expect(pickEntry(["util.js", "index.js", "main.js"], ["main.js", "index.js"], [".js"])).toBe("main.js");
    expect(pickEntry(["util.js", "index.js"], ["main.js", "index.js"], [".js"])).toBe("index.js");
    expect(pickEntry(["notes.txt", "app.JS"], ["main.js"], [".js"])).toBe("app.JS");
    expect(pickEntry(["notes.txt"], ["main.js"], [".js"])).toBeNull();
    expect(positionAt("ab\ncd\nef", 0)).toEqual({ line: 1, column: 1 });
    expect(positionAt("ab\ncd\nef", 4)).toEqual({ line: 2, column: 2 });
    expect(positionAt("ab\ncd\nef", 6)).toEqual({ line: 3, column: 1 });
  });
});

describe("sandbox message protocol", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const envelope = { ytl: 1, executionId: id };

  it("accepts exactly the known messages for this execution", () => {
    expect(parseSandboxMessage({ ...envelope, type: "ready" }, id)).toEqual({ type: "ready" });
    expect(parseSandboxMessage({ ...envelope, type: "output", stream: "stdout", text: "hi\n", extra: 1 }, id)).toEqual({ type: "output", stream: "stdout", text: "hi\n" });
    expect(parseSandboxMessage({ ...envelope, type: "error", name: "TypeError", message: "x is not a function", stack: "s" }, id)).toEqual({
      type: "error",
      name: "TypeError",
      message: "x is not a function",
      stack: "s",
    });
    expect(parseSandboxMessage({ ...envelope, type: "loading", loading: true }, id)).toEqual({ type: "loading", loading: true });
    expect(parseSandboxMessage({ ...envelope, type: "done", exitCode: 0 }, id)).toEqual({ type: "done", exitCode: 0 });
  });

  it("rejects another execution's messages, wrong shapes and oversized text", () => {
    const rejected: unknown[] = [
      null,
      "ready",
      42,
      [],
      { type: "ready" },
      { ytl: 1, executionId: "22222222-2222-4222-8222-222222222222", type: "ready" },
      { ytl: 2, executionId: id, type: "ready" },
      { ...envelope, type: "unknown" },
      { ...envelope },
      { ...envelope, type: "output", stream: "stdlog", text: "x" },
      { ...envelope, type: "output", stream: "stdout", text: 5 },
      { ...envelope, type: "output", stream: "stdout" },
      { ...envelope, type: "output", stream: "stdout", text: "x".repeat(1024 * 1024 + 1) },
      { ...envelope, type: "error", name: "E", message: {}, stack: "" },
      { ...envelope, type: "loading", loading: "yes" },
      { ...envelope, type: "done", exitCode: 1.5 },
      { ...envelope, type: "done", exitCode: "0" },
      { ...envelope, type: "done" },
    ];
    for (const data of rejected) expect(parseSandboxMessage(data, id)).toBeNull();
  });
});

describe("output collector", () => {
  it("keeps each stream separately and forwards chunks", () => {
    const seen: string[] = [];
    const output = new OutputCollector(100, (chunk) => seen.push(`${chunk.stream}:${chunk.text}`));
    expect(output.append("stdout", "a\n")).toBe(true);
    expect(output.append("stderr", "warn\n")).toBe(true);
    expect(output.append("stdout", "b\n")).toBe(true);
    expect([output.text("stdout"), output.text("stderr")]).toEqual(["a\nb\n", "warn\n"]);
    expect(seen).toEqual(["stdout:a\n", "stderr:warn\n", "stdout:b\n"]);
    expect(output.truncated).toEqual({ stdout: false, stderr: false });
  });

  it("cuts a stream at the byte cap without splitting a character, and stays cut", () => {
    const output = new OutputCollector(10);
    expect(output.append("stdout", "12345678")).toBe(true);
    // Each Arabic letter is two bytes: only one more fits.
    expect(output.append("stdout", "سلام")).toBe(false);
    expect(output.text("stdout")).toBe("12345678س");
    expect(output.truncated.stdout).toBe(true);
    expect(output.append("stdout", "more")).toBe(false);
    expect(output.text("stdout")).toBe("12345678س");
    // The other stream has its own allowance.
    expect(output.append("stderr", "0123456789")).toBe(true);
    expect(output.append("stderr", "x")).toBe(false);
    expect(output.truncated).toEqual({ stdout: true, stderr: true });
  });

  it("survives a listener that throws", () => {
    const output = new OutputCollector(100, () => {
      throw new Error("ui bug");
    });
    expect(output.append("stdout", "still kept")).toBe(true);
    expect(output.text("stdout")).toBe("still kept");
  });
});

describe("result normalisation", () => {
  it("builds the frozen result shape from a run", () => {
    const output = new OutputCollector(5);
    output.append("stdout", "123456789");
    const result = buildResult(request, "exec-1", { status: "output_limit", phase: "run", output, elapsedMs: 12.6, runMs: 10.2 });
    expect(result).toEqual({
      executionId: "exec-1",
      projectId: "p1",
      revision: 3,
      track: "javascript",
      status: "output_limit",
      phase: "run",
      stdout: "12345",
      stderr: "",
      stdoutTruncated: true,
      stderrTruncated: false,
      compilerOutput: "",
      compilerOutputTruncated: false,
      diagnostics: [],
      elapsedMs: 13,
      runMs: 10,
    });
  });

  it("builds an unavailable result with no output", () => {
    expect(unavailableResult(request, "exec-2", "runner_unreachable", "offline")).toMatchObject({
      status: "runner_unavailable",
      phase: null,
      stdout: "",
      stderr: "",
      diagnostics: [],
      unavailableReason: "runner_unreachable",
      message: "offline",
    });
  });

  it("formats diagnostics as compiler output", () => {
    expect(
      formatDiagnostics([
        { severity: "error", message: "Type 'string' is not assignable to type 'number'.", file: "main.ts", line: 3, column: 7, source: "type-checker" },
        { severity: "warning", message: "unused", file: "a.ts", line: 1, source: "type-checker" },
        { severity: "error", message: "no entry", source: "compiler" },
      ]),
    ).toBe("main.ts:3:7: error: Type 'string' is not assignable to type 'number'.\na.ts:1:1: warning: unused\nerror: no entry");
  });
});

describe("run life cycle", () => {
  it("reports status changes and resolves once with the first result", async () => {
    const seen: string[] = [];
    const cleaned: string[] = [];
    const handle = createRun(request, (control) => {
      control.onEnd(() => cleaned.push("end"));
      control.setStatus("compiling");
      control.setStatus("running");
      control.finish({ status: "success", phase: "run", exitCode: 0 });
      control.finish({ status: "error", phase: "run", exitCode: 1 });
      control.setStatus("running");
    });
    expect(handle.status()).toBe("queued");
    handle.subscribe((status) => seen.push(status));
    const result = await handle.result;
    expect(result).toMatchObject({ status: "success", exitCode: 0, executionId: handle.executionId, projectId: "p1", revision: 3 });
    expect(handle.executionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen).toEqual(["compiling", "running", "success"]);
    expect(handle.status()).toBe("success");
    expect(cleaned).toEqual(["end"]);
    handle.stop();
    expect(handle.status()).toBe("success");
  });

  it("stop runs the adapter's stop action, and cleanup runs once", async () => {
    let cleanups = 0;
    const handle = createRun(request, (control) => {
      control.setStatus("running");
      control.onEnd(() => cleanups++);
      control.onStop(() => control.finish({ status: "cancelled", phase: "run" }));
    });
    await Promise.resolve();
    handle.stop();
    handle.stop();
    expect(await handle.result).toMatchObject({ status: "cancelled", phase: "run", stdout: "" });
    expect(cleanups).toBe(1);
  });

  it("stop before the adapter has started ends the run without running anything", async () => {
    let started = false;
    const handle = createRun(request, () => {
      started = true;
    });
    handle.stop();
    expect(await handle.result).toMatchObject({ status: "cancelled", phase: null });
    await Promise.resolve();
    expect(started).toBe(false);
  });

  it("turns an adapter fault into runner_unavailable, never into program output", async () => {
    const thrown = await createRun(request, () => {
      throw new Error("adapter bug");
    }).result;
    expect(thrown).toMatchObject({ status: "runner_unavailable", unavailableReason: "internal_error", message: "adapter bug", stdout: "", stderr: "" });
    const rejected = await createRun(request, async () => {
      throw new Error("async adapter bug");
    }).result;
    expect(rejected).toMatchObject({ status: "runner_unavailable", unavailableReason: "internal_error", stdout: "" });
  });
});

describe("runtime error reports", () => {
  it("reads Chrome and Firefox style stacks", () => {
    const chrome = "TypeError: x is not a function\n    at helper (project:/lib/util.js:4:9)\n    at project:/main.js:2:1";
    const firefox = "helper@project:/lib/util.js:4:9\n@project:/main.js:2:1\n";
    for (const stack of [chrome, firefox]) {
      expect(parseStackFrames(stack)).toEqual([
        { file: "lib/util.js", line: 4, column: 9 },
        { file: "main.js", line: 2, column: 1 },
      ]);
    }
    expect(parseStackFrames("Error: x\n    at https://example.com/other.js:1:1")).toEqual([]);
  });

  it("produces console text and a diagnostic at the innermost project frame", () => {
    const report = describeRuntimeError({ name: "TypeError", message: "x is not a function", stack: "TypeError: x is not a function\n    at helper (project:/lib/util.js:4:9)\n    at project:/main.js:2:1" });
    expect(report.text).toBe("Uncaught TypeError: x is not a function\n    at lib/util.js:4:9\n    at main.js:2:1\n");
    expect(report.diagnostic).toEqual({ severity: "error", message: "TypeError: x is not a function", file: "lib/util.js", line: 4, column: 9, source: "runtime" });
  });

  it("maps frames through a mapper and copes with an error that has no stack", () => {
    const mapped = describeRuntimeError({ name: "Error", message: "boom", stack: "Error: boom\n    at project:/main.js:10:3" }, (frame) => ({ file: "main.ts", line: frame.line - 4, column: 7 }));
    expect(mapped.diagnostic).toMatchObject({ file: "main.ts", line: 6, column: 7 });
    expect(mapped.text).toContain("at main.ts:6:7");
    const bare = describeRuntimeError({ name: "", message: "a thrown string", stack: "" });
    expect(bare).toEqual({ text: "Uncaught a thrown string\n", diagnostic: { severity: "error", message: "a thrown string", source: "runtime" } });
  });
});

describe("source maps", () => {
  it("decodes VLQ", () => {
    expect(decodeVlq("AAAA")).toEqual([0, 0, 0, 0]);
    expect(decodeVlq("AACA")).toEqual([0, 0, 1, 0]);
    expect(decodeVlq("D")).toEqual([-1]);
    expect(decodeVlq("gB")).toEqual([16]);
    expect(decodeVlq("2H")).toEqual([123]);
  });

  it("maps generated positions back to the source", () => {
    // Generated line 1 maps to source line 3 (two type-only lines were erased); line 2 to line 5.
    const map = JSON.stringify({ version: 3, sources: ["main.ts"], mappings: "AAEA,KAAK;AAEL" });
    const lookup = createSourceMapLookup(map);
    expect(lookup(1, 1)).toEqual({ source: "main.ts", line: 3, column: 1 });
    expect(lookup(1, 7)).toEqual({ source: "main.ts", line: 3, column: 6 });
    expect(lookup(1)).toEqual({ source: "main.ts", line: 3, column: 1 });
    expect(lookup(2, 4)).toEqual({ source: "main.ts", line: 5, column: 1 });
    expect(lookup(3, 1)).toBeNull();
    expect(createSourceMapLookup("not json")(1, 1)).toBeNull();
    expect(createSourceMapLookup('{"sources":["a.ts"],"mappings":"!!"}')(1, 1)).toBeNull();
  });
});

describe("python tracebacks", () => {
  it("locates the innermost project frame and the exception line", () => {
    const stderr = [
      "Traceback (most recent call last):",
      '  File "/project/main.py", line 5, in <module>',
      "    print(average([]))",
      '  File "/project/stats/mean.py", line 2, in average',
      "    return sum(xs) / len(xs)",
      "ZeroDivisionError: division by zero",
      "",
    ].join("\n");
    expect(parsePythonTraceback(stderr)).toEqual({ severity: "error", message: "ZeroDivisionError: division by zero", file: "stats/mean.py", line: 2, source: "runtime" });
  });

  it("reads a syntax error and ignores earlier output", () => {
    const stderr = ['warning printed by the program', '  File "/project/main.py", line 3', "    print(1", "         ^", "SyntaxError: '(' was never closed", ""].join("\n");
    expect(parsePythonTraceback(stderr)).toEqual({ severity: "error", message: "SyntaxError: '(' was never closed", file: "main.py", line: 3, source: "runtime" });
  });

  it("uses the last traceback and returns null when there is none", () => {
    const two = 'Traceback (most recent call last):\n  File "/project/a.py", line 1, in <module>\nValueError: first\nTraceback (most recent call last):\n  File "/project/b.py", line 9, in <module>\nKeyError: \'k\'\n';
    expect(parsePythonTraceback(two)).toMatchObject({ file: "b.py", line: 9, message: "KeyError: 'k'" });
    expect(parsePythonTraceback("just some text on stderr\n")).toBeNull();
    expect(parsePythonTraceback("")).toBeNull();
  });
});
