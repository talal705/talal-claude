// The real TypeScript compiler (the same typescript.js the browser worker loads) checking real projects.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import { beforeAll, describe, expect, it } from "vitest";
import ts from "typescript-js";
import { buildModulePlan } from "./modules";
import { parseSandboxMessage, type SandboxMessage } from "./protocol";
import { JS_WORKER_SOURCE } from "./sandbox-sources";
import { createSourceMapLookup } from "./sourcemap";
import { describeRuntimeError } from "./stack";
import { CONSOLE_LIBS, checkAndEmit, isTypeScriptFile, referencedLibs, type EmittedModule } from "./ts-check";

const libDir = dirname(createRequire(import.meta.url).resolve("typescript-js"));
const libs = new Map<string, string>();

/** Loads the libs the way the worker does: the starting files, then whatever they reference. */
beforeAll(() => {
  const wanted: string[] = [...CONSOLE_LIBS];
  while (wanted.length > 0) {
    const name = wanted.pop()!;
    if (libs.has(name)) continue;
    const text = readFileSync(join(libDir, name), "utf8");
    libs.set(name, text);
    wanted.push(...referencedLibs(text));
  }
});

const EXECUTION_ID = "44444444-4444-4444-8444-444444444444";
const BROWSER_STAND_IN = `
const { parentPort } = require("node:worker_threads");
globalThis.self = globalThis;
self.postMessage = (message) => parentPort.postMessage(message);
self.addEventListener = () => {};
globalThis.Blob = class { constructor(parts) { this.text = parts.join(""); } };
URL.createObjectURL = (blob) => "data:text/javascript;base64," + Buffer.from(blob.text).toString("base64");
parentPort.on("message", (data) => { if (self.onmessage) self.onmessage({ data }); });
`;

/** Runs emitted modules with the real worker source, as the TypeScript adapter does after a clean check. */
async function runEmitted(emitted: EmittedModule[], entry: string, stdin = ""): Promise<SandboxMessage[]> {
  const planned = await buildModulePlan(emitted.map((module) => ({ path: module.path, source: module.source })), entry);
  if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics));
  const worker = new Worker(BROWSER_STAND_IN + JS_WORKER_SOURCE.replace('"use strict";', ""), { eval: true });
  const messages: SandboxMessage[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      worker.on("error", reject);
      worker.on("message", (data: unknown) => {
        const message = parseSandboxMessage(data, EXECUTION_ID);
        if (!message) return reject(new Error(`invalid message: ${JSON.stringify(data)}`));
        messages.push(message);
        if (message.type === "done") resolve();
      });
      worker.postMessage({ executionId: EXECUTION_ID, modules: planned.plan.modules, entry, stdin });
    });
  } finally {
    await worker.terminate();
  }
  return messages;
}

const stdout = (messages: SandboxMessage[]) => messages.map((message) => (message.type === "output" && message.stream === "stdout" ? message.text : "")).join("");

describe("TypeScript check and emit", { timeout: 30_000 }, () => {
  it("is the JavaScript-based compiler with the libs it needs", () => {
    expect(ts.version).toBe("6.0.3");
    expect(libs.has("lib.es2022.d.ts")).toBe(true);
    expect(libs.has("lib.es5.d.ts")).toBe(true);
    expect(libs.has("lib.webworker.d.ts")).toBe(true);
    expect(libs.size).toBeGreaterThan(40);
    expect(referencedLibs('/// <reference no-default-lib="true"/>\n/// <reference lib="es2021" />\n/// <reference lib="es2022.array" />\nconst x = 1;')).toEqual(["lib.es2021.d.ts", "lib.es2022.array.d.ts"]);
  });

  it("accepts a correct program and emits JavaScript that really runs", async () => {
    const result = checkAndEmit(
      ts,
      [{ path: "main.ts", source: 'interface Person { name: string; age: number }\nfunction greet(person: Person): string {\n  return `Hello, ${person.name}! Next year you are ${person.age + 1}.`;\n}\nconsole.log(greet({ name: "Layla", age: 12 }));\n' }],
      libs,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.emitted.map((module) => [module.path, module.from])).toEqual([["main.js", "main.ts"]]);
    expect(result.emitted[0].source).not.toContain("interface");
    expect(result.emitted[0].source).not.toContain("sourceMappingURL");
    expect(JSON.parse(result.emitted[0].map).version).toBe(3);

    const messages = await runEmitted(result.emitted, "main.js");
    expect(stdout(messages)).toBe("Hello, Layla! Next year you are 13.\n");
    expect(messages.at(-1)).toEqual({ type: "done", exitCode: 0 });
  });

  it("reports a type error with file, line, column and range, and emits nothing", () => {
    const result = checkAndEmit(
      ts,
      [{ path: "main.ts", source: 'const count: number = "three";\nconsole.log(count);\n' }],
      libs,
    );
    expect(result.emitted).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        message: "Type 'string' is not assignable to type 'number'. (TS2322)",
        file: "main.ts",
        line: 1,
        column: 7,
        endLine: 1,
        endColumn: 12,
        source: "type-checker",
      },
    ]);
  });

  it("is a type check, not a transpile: valid JavaScript with wrong types is rejected", () => {
    const sources = {
      "wrong argument": 'function double(n: number) { return n * 2; }\ndouble("4");\n',
      "missing property": "const point = { x: 1 };\nconsole.log(point.y);\n",
      "possibly null": "const line = readLine();\nconsole.log(line.length);\n",
      "implicit any": "function f(x) { return x; }\nf(1);\n",
      "unknown name": "console.log(missing);\n",
    };
    for (const [label, source] of Object.entries(sources)) {
      const result = checkAndEmit(ts, [{ path: "main.ts", source }], libs);
      expect([label, result.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length > 0, result.emitted.length]).toEqual([label, true, 0]);
      // A transpiler accepts every one of these.
      expect(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).diagnostics ?? []).toEqual([]);
    }
  });

  it("checks types across files and reports the error in the importing file", () => {
    const files = [
      { path: "main.ts", source: 'import { area } from "./shapes/area";\nimport type { Size } from "./shapes/area";\nconst size: Size = { width: 6, height: "7" };\nconsole.log(area(size));\n' },
      { path: "shapes/area.ts", source: "export interface Size { width: number; height: number }\nexport function area(size: Size): number {\n  return size.width * size.height;\n}\n" },
    ];
    const result = checkAndEmit(ts, files, libs);
    expect(result.emitted).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ file: "main.ts", line: 3, column: 32, severity: "error", source: "type-checker" });
    expect(result.diagnostics[0].message).toContain("Type 'string' is not assignable to type 'number'");
  });

  it("emits and runs a multi-file project, with stdin", async () => {
    const result = checkAndEmit(
      ts,
      [
        { path: "main.ts", source: 'import { area, type Size } from "./shapes/area";\nimport { label } from "./label.js";\nconst width = Number(readLine() ?? "0");\nconst size: Size = { width, height: 7 };\nconsole.log(label(area(size)));\n' },
        { path: "shapes/area.ts", source: "export interface Size { width: number; height: number }\nexport const area = (size: Size): number => size.width * size.height;\n" },
        { path: "label.ts", source: "export function label(value: number): string {\n  return `area = ${value}`;\n}\n" },
        { path: "notes.txt", source: "not code" },
      ],
      libs,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.emitted.map((module) => module.path).sort()).toEqual(["label.js", "main.js", "shapes/area.js"]);
    const messages = await runEmitted(result.emitted, "main.js", "6\n");
    expect(stdout(messages)).toBe("area = 42\n");
  });

  it("reports a missing import and a syntax error", () => {
    const missing = checkAndEmit(ts, [{ path: "main.ts", source: 'import { x } from "./nowhere";\nconsole.log(x);\n' }], libs);
    expect(missing.diagnostics[0]).toMatchObject({ file: "main.ts", line: 1, column: 19, severity: "error" });
    expect(missing.diagnostics[0].message).toMatch(/Cannot find module '\.\/nowhere'/);

    const syntax = checkAndEmit(ts, [{ path: "main.ts", source: "function broken( {\n" }], libs);
    expect(syntax.emitted).toEqual([]);
    expect(syntax.diagnostics.some((diagnostic) => diagnostic.severity === "error" && diagnostic.file === "main.ts")).toBe(true);
  });

  it("maps a runtime error in the emitted JavaScript back to the TypeScript line", async () => {
    const source = [
      "interface Account {",
      "  owner: string;",
      "  balance: number;",
      "}",
      "",
      "type Lookup = Record<string, Account | undefined>;",
      "",
      "function balanceOf(accounts: Lookup, owner: string): number {",
      "  const account = accounts[owner] as Account;",
      "  return account.balance;",
      "}",
      "",
      'console.log("before");',
      'console.log(balanceOf({}, "nobody"));',
      "",
    ].join("\n");
    const result = checkAndEmit(ts, [{ path: "main.ts", source }], libs);
    expect(result.diagnostics).toEqual([]);
    // The emitted file is shorter than the source, so unmapped line numbers would be wrong.
    expect(result.emitted[0].source.split("\n").length).toBeLessThan(source.split("\n").length - 4);

    const messages = await runEmitted(result.emitted, "main.js");
    expect(stdout(messages)).toBe("before\n");
    const error = messages.find((message) => message.type === "error");
    if (error?.type !== "error") throw new Error("no error reported");

    const lookup = createSourceMapLookup(result.emitted[0].map);
    const report = describeRuntimeError(error, (frame) => {
      const original = lookup(frame.line, frame.column);
      return original ? { file: "main.ts", line: original.line, column: original.column } : null;
    });
    expect(report.diagnostic).toMatchObject({ file: "main.ts", line: 10, source: "runtime" });
    expect(report.diagnostic.message).toMatch(/^TypeError: /);
    expect(report.text).toContain("at main.ts:10:");
    expect(report.text).toContain("at main.ts:14:");
  });

  it("recognizes TypeScript source files", () => {
    expect(["main.ts", "lib/a.mts", "types.d.ts", "main.js", "notes.txt"].map(isTypeScriptFile)).toEqual([true, true, false, false, false]);
  });
});
