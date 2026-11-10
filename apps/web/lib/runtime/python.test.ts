// The Python sandbox's core (the text sent into the worker) on the real Pyodide interpreter, under Node.
import { describe, expect, it } from "vitest";
import { loadPyodide } from "pyodide";
import { parsePythonTraceback } from "./python-traceback";
import { parseSandboxMessage, type SandboxMessage } from "./protocol";
import { PYTHON_CORE_SOURCE } from "./sandbox-sources";

const EXECUTION_ID = "55555555-5555-4555-8555-555555555555";

type Core = (pyodide: unknown, init: unknown, send: (message: Record<string, unknown>) => void) => Promise<number>;
// Our own source text, not learner code: this is how the worker defines the function too.
const runPython = new Function(`${PYTHON_CORE_SOURCE}; return ytlRunPython;`)() as Core;

interface Outcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  messages: SandboxMessage[];
}

// Loading the interpreter is the slow part, so the tests share one. In the browser each run gets a
// new worker and so a new interpreter; here the project folder and its imported modules are cleared instead.
let shared: Awaited<ReturnType<typeof loadPyodide>> | null = null;
const RESET = `
import os, shutil, sys
os.chdir("/")
shutil.rmtree("/project", ignore_errors=True)
for name, module in list(sys.modules.items()):
    if str(getattr(module, "__file__", "") or "").startswith("/project/"):
        del sys.modules[name]
sys.path[:] = [entry for entry in sys.path if not entry.startswith("/project")]
`;

async function run(files: Record<string, string>, stdin = "", entry = "main.py"): Promise<Outcome> {
  shared ??= await loadPyodide();
  const pyodide = shared;
  pyodide.runPython(RESET);
  const messages: SandboxMessage[] = [];
  const exitCode = await runPython(
    pyodide,
    { files: Object.entries(files).map(([path, content]) => ({ path, content })), entry, stdin },
    (raw) => {
      const message = parseSandboxMessage({ ...raw, ytl: 1, executionId: EXECUTION_ID }, EXECUTION_ID);
      if (!message) throw new Error(`invalid message: ${JSON.stringify(raw)}`);
      messages.push(message);
    },
  );
  const text = (stream: string) => messages.map((message) => (message.type === "output" && message.stream === stream ? message.text : "")).join("");
  return { exitCode, stdout: text("stdout"), stderr: text("stderr"), messages };
}

describe("Python core on Pyodide", { timeout: 30_000 }, () => {
  it("runs a correct program and captures stdout and stderr separately", async () => {
    const outcome = await run({
      "main.py": 'import sys\nprint("Hello, lab!")\nprint("no newline", end="")\nprint()\nprint("to stderr", file=sys.stderr)\nprint(sum(range(10)), "مرحبا")\n',
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe("Hello, lab!\nno newline\n45 مرحبا\n");
    expect(outcome.stderr).toBe("to stderr\n");
    expect(outcome.messages[0]).toEqual({ type: "ready" });
  });

  it("feeds input() from stdin and raises EOFError when it runs out", async () => {
    const withInput = await run({ "main.py": 'name = input("Name? ")\na = int(input())\nb = int(input())\nprint(f"Hi {name}, {a + b}")\n' }, "سارة\r\n19\n23\n");
    expect(withInput.exitCode).toBe(0);
    expect(withInput.stdout).toContain("Hi سارة, 42\n");

    const exhausted = await run({ "main.py": "first = input()\nsecond = input()\nprint('never')\n" }, "only one line\n");
    expect(exhausted.exitCode).toBe(1);
    expect(exhausted.stdout).not.toContain("never");
    expect(parsePythonTraceback(exhausted.stderr)).toMatchObject({ file: "main.py", line: 2, message: expect.stringMatching(/^EOFError/) });
  });

  it("imports other files of the project, including a package folder", async () => {
    const outcome = await run({
      "main.py": "from shapes.area import rectangle\nimport helpers\nprint(helpers.label(rectangle(6, 7)))\nprint(__name__)\n",
      "shapes/__init__.py": "",
      "shapes/area.py": "def rectangle(width, height):\n    return width * height\n",
      "helpers.py": 'def label(value):\n    return f"area = {value}"\n',
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe("area = 42\n__main__\n");
  });

  it("reports a runtime error as a traceback naming only project files, with the right line", async () => {
    const outcome = await run({
      "main.py": 'from stats import average\nprint("before")\nprint(average([]))\nprint("never")\n',
      "stats.py": "def average(values):\n    return sum(values) / len(values)\n",
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.stdout).toBe("before\n");
    expect(outcome.stderr).toContain("Traceback (most recent call last):");
    expect(outcome.stderr).toContain('File "/project/main.py", line 3');
    expect(outcome.stderr).toContain('File "/project/stats.py", line 2');
    expect(outcome.stderr.trimEnd().endsWith("ZeroDivisionError: division by zero")).toBe(true);
    // No frames of the runner, runpy or Pyodide itself.
    expect(outcome.stderr).not.toMatch(/runpy|__ytl_run|<exec>|_pyodide/);
    expect(parsePythonTraceback(outcome.stderr)).toEqual({ severity: "error", message: "ZeroDivisionError: division by zero", file: "stats.py", line: 2, source: "runtime" });
  });

  it("reports a syntax error with its line", async () => {
    const outcome = await run({ "main.py": 'print("ok")\nif True\n    print("x")\n' });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.stdout).toBe("");
    expect(parsePythonTraceback(outcome.stderr)).toMatchObject({ file: "main.py", line: 2, message: expect.stringMatching(/^SyntaxError/) });
  });

  it("maps sys.exit to the exit code", async () => {
    expect((await run({ "main.py": "import sys\nprint('bye')\nsys.exit(0)\n" })).exitCode).toBe(0);
    const three = await run({ "main.py": "import sys\nsys.exit(3)\n" });
    expect([three.exitCode, three.stderr]).toEqual([3, ""]);
    const text = await run({ "main.py": "import sys\nsys.exit('fatal: bad input')\n" });
    expect([text.exitCode, text.stderr]).toEqual([1, "fatal: bad input\n"]);
  });

  it("has the standard library but no third-party packages", async () => {
    const outcome = await run({ "main.py": "import json, math, random, collections\nprint(json.dumps({'pi': round(math.pi, 2)}))\nimport numpy\n" });
    expect(outcome.stdout).toBe('{"pi": 3.14}\n');
    expect(outcome.exitCode).toBe(1);
    expect(parsePythonTraceback(outcome.stderr)).toMatchObject({ file: "main.py", line: 3, message: expect.stringMatching(/^ModuleNotFoundError/) });
  });
});
