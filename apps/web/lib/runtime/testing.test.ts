// The helper lesson tests use to run example code: the platform's own runtime code in Node.
import { afterAll, describe, expect, it } from "vitest";
import { runProgramForTest, stopTestRuntimes } from "./testing";

afterAll(async () => {
  await stopTestRuntimes();
});

describe("runProgramForTest: JavaScript", { timeout: 30_000 }, () => {
  it("runs a program with stdin and returns the adapter's result", async () => {
    const result = await runProgramForTest({ track: "javascript", files: [{ name: "main.js", content: 'const name = readLine();\nconsole.log(`Hello, ${name}!`);\n' }], stdin: "Sara\n" });
    expect(result).toMatchObject({ status: "success", phase: "run", stdout: "Hello, Sara!\n", stderr: "", exitCode: 0, diagnostics: [], track: "javascript" });
    expect(result.executionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reports a runtime error with the file and line", async () => {
    const result = await runProgramForTest({ track: "javascript", files: [{ name: "main.js", content: 'console.log("before");\nconst value = undefined;\nconsole.log(value.length);\n' }] });
    expect(result).toMatchObject({ status: "error", phase: "run", stdout: "before\n", exitCode: 1 });
    expect(result.diagnostics).toEqual([expect.objectContaining({ file: "main.js", line: 3, source: "runtime", message: expect.stringMatching(/^TypeError/) })]);
  });

  it("reports an error thrown later from a timer", async () => {
    const result = await runProgramForTest({ track: "javascript", files: [{ name: "main.js", content: 'setTimeout(() => { throw new RangeError("late"); }, 10);\n' }] });
    expect(result).toMatchObject({ status: "error", phase: "run" });
    expect(result.stderr).toContain("RangeError: late");
  });

  it("links several files and reports a missing import as a compile error", async () => {
    const ok = await runProgramForTest({ track: "javascript", files: [{ name: "main.js", content: 'import { twice } from "./math.js";\nconsole.log(twice(21));\n' }, { name: "math.js", content: "export const twice = (n) => n * 2;\n" }] });
    expect(ok).toMatchObject({ status: "success", stdout: "42\n" });
    const missing = await runProgramForTest({ track: "javascript", files: [{ name: "main.js", content: 'import { x } from "./nowhere.js";\n' }] });
    expect(missing).toMatchObject({ status: "error", phase: "compile", stdout: "" });
    expect(missing.diagnostics[0]).toMatchObject({ file: "main.js", line: 1, source: "compiler" });
  });

  it("stops an endless program at the time limit", async () => {
    const result = await runProgramForTest({ track: "javascript", files: [{ name: "main.js", content: 'console.log("looping");\nfor (;;) {}\n' }] }, { timeoutMs: 500 });
    expect(result).toMatchObject({ status: "timeout", phase: "run" });
  });
});

describe("runProgramForTest: Python", { timeout: 60_000 }, () => {
  it("runs a program with input() and returns the adapter's result", async () => {
    const result = await runProgramForTest({ track: "python", files: [{ name: "main.py", content: 'name = input()\nprint(f"Hello, {name}!")\n' }], stdin: "Sara\n" });
    expect(result).toMatchObject({ status: "success", phase: "run", stdout: "Hello, Sara!\n", stderr: "", exitCode: 0, track: "python" });
  });

  it("reports an exception with the project file and line from the traceback", async () => {
    const result = await runProgramForTest({ track: "python", files: [{ name: "main.py", content: 'from stats import average\nprint("before")\nprint(average([]))\n' }, { name: "stats.py", content: "def average(values):\n    return sum(values) / len(values)\n" }] });
    expect(result).toMatchObject({ status: "error", phase: "run", stdout: "before\n", exitCode: 1 });
    expect(result.diagnostics).toContainEqual({ severity: "error", message: "ZeroDivisionError: division by zero", file: "stats.py", line: 2, source: "runtime" });
  });

  it("keeps runs apart: a module of one run is not seen by the next", async () => {
    await runProgramForTest({ track: "python", files: [{ name: "main.py", content: "import helper\n" }, { name: "helper.py", content: "VALUE = 1\n" }] });
    const second = await runProgramForTest({ track: "python", files: [{ name: "main.py", content: "import helper\n" }] });
    expect(second).toMatchObject({ status: "error" });
    expect(second.stderr).toContain("ModuleNotFoundError");
  });

  it("stops an endless program at the time limit and runs the next one", async () => {
    const looping = await runProgramForTest({ track: "python", files: [{ name: "main.py", content: 'print("looping", flush=True)\nwhile True:\n    pass\n' }] }, { timeoutMs: 3_000 });
    expect(looping).toMatchObject({ status: "timeout", phase: "run", stdout: "looping\n" });
    const next = await runProgramForTest({ track: "python", files: [{ name: "main.py", content: "print(6 * 7)\n" }] });
    expect(next).toMatchObject({ status: "success", stdout: "42\n" });
  });
});
