// Browser test harness for the run adapters. A dev-only page calls installRuntimeHarness(); a
// browser automation script then drives `window.__ytlRuntime`. Nothing here is used by the product.
import type { CodeTrack, ExecutionRequest, ExecutionResult, ExecutionStatus } from "@ytl/contracts";
import { createRunAdapters } from "./index";
import type { OutputChunk, RunAdapter } from "./types";
import type { TrainingJourney } from "../server/training/contract";

export interface HarnessExpectation {
  status: ExecutionResult["status"];
  phase?: ExecutionResult["phase"];
  /** Exact stdout. */
  stdout?: string;
  stdoutIncludes?: string[];
  stdoutExcludes?: string[];
  stderrIncludes?: string[];
  /** A diagnostic that must be present (fields given must match; `message` is matched as a substring). */
  diagnostic?: { file?: string; line?: number; column?: number; severity?: string; source?: string; message?: string };
  stdoutTruncated?: boolean;
  unavailableReason?: string;
  /** The run must end within this many milliseconds of starting. */
  endsWithinMs?: number;
}

export interface HarnessCase {
  name: string;
  track: CodeTrack;
  files: Record<string, string>;
  stdin?: string;
  /** Press Stop this long after the status became `running`. */
  stopAfterRunningMs?: number;
  /** Needs the runner service with its toolchains (C++, Java, C#); skipped by `runAll` unless asked for. */
  needsServer?: boolean;
  /** Gives the preview a training API (the "How websites work" track), with a project of its own. */
  training?: boolean;
  /** Each completed request's journey, as `layer:kind` lists, in the order the requests completed. */
  journeys?: string[][];
  expect: HarnessExpectation;
}

export interface HarnessOutcome {
  name: string;
  pass: boolean;
  /** Why it did not pass, one line per mismatch. */
  problems: string[];
  result: ExecutionResult;
  statuses: ExecutionStatus[];
  liveOutput: OutputChunk[];
  runtimeLoading: boolean[];
  journeys: TrainingJourney[];
  elapsedMs: number;
}

const PROBE_JS = `const results = [];
async function attempt(label, action) {
  try { results.push(label + "=" + (await action())); } catch (error) { results.push(label + "=blocked"); }
}
await attempt("fetch-api", async () => { const r = await fetch("/api/execute/health"); return "reached:" + r.status; });
await attempt("fetch-external", async () => { await fetch("https://example.com/"); return "reached"; });
await attempt("websocket", () => new Promise((resolve, reject) => { const s = new WebSocket("wss://example.com/"); s.onopen = () => resolve("reached"); s.onerror = () => reject(new Error("x")); }));
await attempt("indexeddb", () => new Promise((resolve, reject) => { const r = indexedDB.open("ytl-guest"); r.onsuccess = () => resolve("opened:" + Array.from(r.result.objectStoreNames).join(",")); r.onerror = () => reject(new Error("x")); }));
const elsewhere = "https://example.com/x.js";
await attempt("import-url", async () => { await import(elsewhere); return "reached"; });
await attempt("origin", () => self.origin);
console.log(results.join("\\n"));
`;

const PROBE_PAGE = `<!doctype html><html><body><p id="out">probe</p><script>
var results = [];
function attempt(label, action) { try { results.push(label + "=" + action()); } catch (error) { results.push(label + "=blocked"); } }
attempt("cookie", function () { return "read:" + document.cookie.length; });
attempt("localstorage", function () { return "read:" + window.localStorage.length; });
attempt("parent-document", function () { return "read:" + window.parent.document.title; });
attempt("top-location", function () { return "read:" + window.top.location.href; });
attempt("origin", function () { return window.origin; });
console.log(results.join("\\n"));
fetch("/api/execute/health").then(function () { console.log("fetch-api=reached"); }, function () { console.log("fetch-api=blocked"); });
</script></body></html>`;

/** The cases a browser check should run. Each has been written to give one unambiguous outcome. */
export const HARNESS_CASES: readonly HarnessCase[] = [
  // ---------- JavaScript ----------
  { name: "js: correct program", track: "javascript", files: { "main.js": 'console.log("Hello, lab!");\nconsole.log(6 * 7, { ok: true });\n' }, expect: { status: "success", phase: "run", stdout: "Hello, lab!\n42 { ok: true }\n" } },
  {
    name: "js: runtime error with file and line",
    track: "javascript",
    files: { "main.js": 'import { risky } from "./lib/risky.js";\nconsole.log("before");\nrisky();\nconsole.log("never");\n', "lib/risky.js": "export function risky() {\n  const value = undefined;\n  return value.length;\n}\n" },
    expect: { status: "error", phase: "run", stdout: "before\n", stderrIncludes: ["Uncaught TypeError", "lib/risky.js:3"], diagnostic: { file: "lib/risky.js", line: 3, source: "runtime", severity: "error" } },
  },
  {
    name: "js: error thrown later from a timer",
    track: "javascript",
    files: { "main.js": 'console.log("scheduled");\nsetTimeout(() => { throw new RangeError("late failure"); }, 50);\n' },
    expect: { status: "error", phase: "run", stdout: "scheduled\n", stderrIncludes: ["RangeError: late failure"], diagnostic: { file: "main.js", line: 2, source: "runtime" } },
  },
  {
    name: "js: multi-file with imports",
    track: "javascript",
    files: { "main.js": 'import { area } from "./shapes/area.js";\nimport label from "./label.js";\nconsole.log(label(area(6, 7)));\n', "shapes/area.js": 'import { multiply } from "../math.js";\nexport const area = (w, h) => multiply(w, h);\n', "math.js": "export const multiply = (a, b) => a * b;\n", "label.js": "export default (n) => `area = ${n}`;\n" },
    expect: { status: "success", stdout: "area = 42\n" },
  },
  { name: "js: missing import is a compile error", track: "javascript", files: { "main.js": 'import { x } from "./nowhere.js";\nconsole.log(x);\n' }, expect: { status: "error", phase: "compile", stdout: "", diagnostic: { file: "main.js", line: 1, source: "compiler", message: "nowhere.js" } } },
  { name: "js: stdin", track: "javascript", stdin: "Sara\n19\n23\n", files: { "main.js": "const name = readLine();\nconst sum = Number(readLine()) + Number(readLine());\nconsole.log(`Hi ${name}, ${sum}`, readLine());\n" }, expect: { status: "success", stdout: "Hi Sara, 42 null\n" } },
  { name: "js: timers finish before the run ends", track: "javascript", files: { "main.js": 'console.log("start");\nsetTimeout(() => console.log("later"), 200);\n' }, expect: { status: "success", stdout: "start\nlater\n" } },
  { name: "js: infinite loop stopped by the user", track: "javascript", files: { "main.js": 'console.log("looping");\nfor (;;) {}\n' }, stopAfterRunningMs: 500, expect: { status: "cancelled", phase: "run", stdout: "looping\n", endsWithinMs: 5_000 } },
  { name: "js: infinite loop stopped by the time limit", track: "javascript", files: { "main.js": 'console.log("looping");\nfor (;;) {}\n' }, expect: { status: "timeout", phase: "run", stdout: "looping\n", endsWithinMs: 20_000 } },
  { name: "js: excessive output is cut at the cap", track: "javascript", files: { "main.js": 'const line = "spam ".repeat(200);\nfor (;;) console.log(line);\n' }, expect: { status: "output_limit", phase: "run", stdoutTruncated: true, endsWithinMs: 20_000 } },
  {
    name: "js: sandbox blocks network, storage and the site's API",
    track: "javascript",
    files: { "main.js": PROBE_JS },
    expect: { status: "success", stdoutIncludes: ["fetch-api=blocked", "fetch-external=blocked", "websocket=blocked", "indexeddb=blocked", "import-url=blocked", "origin=null"], stdoutExcludes: ["reached", "opened"] },
  },

  // ---------- TypeScript ----------
  { name: "ts: correct program", track: "typescript", files: { "main.ts": 'interface Person { name: string; age: number }\nfunction greet(p: Person): string { return `Hello, ${p.name}! Next year: ${p.age + 1}`; }\nconsole.log(greet({ name: "Layla", age: 12 }));\n' }, expect: { status: "success", phase: "run", stdout: "Hello, Layla! Next year: 13\n" } },
  { name: "ts: type error is reported and nothing runs", track: "typescript", files: { "main.ts": 'console.log("must not run");\nconst count: number = "three";\nconsole.log(count);\n' }, expect: { status: "error", phase: "compile", stdout: "", diagnostic: { file: "main.ts", line: 2, column: 7, source: "type-checker", severity: "error", message: "TS2322" } } },
  {
    name: "ts: type error across files",
    track: "typescript",
    files: { "main.ts": 'import { area, type Size } from "./shapes/area";\nconst size: Size = { width: 6, height: "7" };\nconsole.log(area(size));\n', "shapes/area.ts": "export interface Size { width: number; height: number }\nexport const area = (s: Size): number => s.width * s.height;\n" },
    expect: { status: "error", phase: "compile", stdout: "", diagnostic: { file: "main.ts", line: 2, source: "type-checker" } },
  },
  {
    name: "ts: multi-file with stdin",
    track: "typescript",
    stdin: "6\n",
    files: { "main.ts": 'import { area, type Size } from "./shapes/area";\nconst size: Size = { width: Number(readLine() ?? "0"), height: 7 };\nconsole.log(`area = ${area(size)}`);\n', "shapes/area.ts": "export interface Size { width: number; height: number }\nexport const area = (s: Size): number => s.width * s.height;\n" },
    expect: { status: "success", stdout: "area = 42\n" },
  },
  {
    name: "ts: runtime error mapped to the TypeScript line",
    track: "typescript",
    files: { "main.ts": 'interface Account {\n  owner: string;\n  balance: number;\n}\n\ntype Lookup = Record<string, Account | undefined>;\n\nfunction balanceOf(accounts: Lookup, owner: string): number {\n  const account = accounts[owner] as Account;\n  return account.balance;\n}\n\nconsole.log("before");\nconsole.log(balanceOf({}, "nobody"));\n' },
    expect: { status: "error", phase: "run", stdout: "before\n", stderrIncludes: ["main.ts:10"], diagnostic: { file: "main.ts", line: 10, source: "runtime" } },
  },
  { name: "ts: infinite loop stopped by the user", track: "typescript", files: { "main.ts": 'console.log("looping");\nlet n: number = 0;\nwhile (true) { n++; }\n' }, stopAfterRunningMs: 500, expect: { status: "cancelled", phase: "run", stdout: "looping\n", endsWithinMs: 5_000 } },

  // ---------- Python ----------
  { name: "py: correct program", track: "python", files: { "main.py": 'import sys\nprint("Hello, lab!")\nprint(sum(range(10)))\nprint("warn", file=sys.stderr)\n' }, expect: { status: "success", phase: "run", stdout: "Hello, lab!\n45\n", stderrIncludes: ["warn"] } },
  {
    name: "py: runtime error with traceback",
    track: "python",
    files: { "main.py": 'from stats import average\nprint("before")\nprint(average([]))\n', "stats.py": "def average(values):\n    return sum(values) / len(values)\n" },
    expect: { status: "error", phase: "run", stdout: "before\n", stderrIncludes: ["Traceback", "ZeroDivisionError"], diagnostic: { file: "stats.py", line: 2, source: "runtime", message: "ZeroDivisionError" } },
  },
  { name: "py: syntax error", track: "python", files: { "main.py": 'print("ok")\nif True\n    print("x")\n' }, expect: { status: "error", phase: "run", stdout: "", diagnostic: { file: "main.py", line: 2, message: "SyntaxError" } } },
  { name: "py: multi-file with a package", track: "python", files: { "main.py": "from shapes.area import rectangle\nprint(rectangle(6, 7))\n", "shapes/__init__.py": "", "shapes/area.py": "def rectangle(w, h):\n    return w * h\n" }, expect: { status: "success", stdout: "42\n" } },
  { name: "py: stdin through input()", track: "python", stdin: "Sara\n19\n23\n", files: { "main.py": 'name = input()\nprint(f"Hi {name}, {int(input()) + int(input())}")\n' }, expect: { status: "success", stdout: "Hi Sara, 42\n" } },
  { name: "py: infinite loop stopped by the user", track: "python", files: { "main.py": 'print("looping", flush=True)\nwhile True:\n    pass\n' }, stopAfterRunningMs: 500, expect: { status: "cancelled", phase: "run", stdout: "looping\n", endsWithinMs: 5_000 } },
  { name: "py: excessive output is cut at the cap", track: "python", files: { "main.py": 'line = "spam " * 200\nwhile True:\n    print(line)\n' }, expect: { status: "output_limit", phase: "run", stdoutTruncated: true, endsWithinMs: 40_000 } },
  { name: "py: no network", track: "python", files: { "main.py": 'import urllib.request\ntry:\n    urllib.request.urlopen("https://example.com/")\n    print("reached")\nexcept Exception:\n    print("blocked")\n' }, expect: { status: "success", stdout: "blocked\n" } },

  // ---------- HTML/CSS preview ----------
  {
    name: "html: page with stylesheet and script, console captured",
    track: "html_css",
    files: { "index.html": '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><h1 id="title">Hello</h1><script src="app.js"></script></body></html>', "styles.css": "h1 { color: rgb(1, 2, 3); }\n", "app.js": 'console.log("color=" + getComputedStyle(document.getElementById("title")).color);\n' },
    stopAfterRunningMs: 800,
    expect: { status: "cancelled", phase: "run", stdout: "color=rgb(1, 2, 3)\n" },
  },
  {
    name: "html: page error is reported",
    track: "html_css",
    files: { "index.html": '<!doctype html><html><body><script>console.log("before"); missingFunction();</script></body></html>' },
    stopAfterRunningMs: 800,
    expect: { status: "cancelled", phase: "run", stdout: "before\n", stderrIncludes: ["missingFunction"], diagnostic: { source: "runtime", message: "missingFunction" } },
  },
  {
    name: "html: module script importing project files",
    track: "html_css",
    files: { "index.html": '<!doctype html><html><body><script type="module" src="js/main.js"></script></body></html>', "js/main.js": 'import { double } from "./math.js";\nconsole.log("double=" + double(21));\n', "js/math.js": "export const double = (n) => n * 2;\n" },
    stopAfterRunningMs: 800,
    expect: { status: "cancelled", stdout: "double=42\n" },
  },
  {
    name: "html: sandbox hides cookies, storage, the parent page and the site's API",
    track: "html_css",
    files: { "index.html": PROBE_PAGE },
    stopAfterRunningMs: 1_500,
    expect: { status: "cancelled", stdoutIncludes: ["cookie=blocked", "localstorage=blocked", "parent-document=blocked", "top-location=blocked", "origin=null", "fetch-api=blocked"], stdoutExcludes: ["read:", "reached"] },
  },
  {
    name: "html: external resources are not loaded",
    track: "html_css",
    files: { "index.html": '<!doctype html><html><head><link rel="stylesheet" href="https://example.com/x.css"><script src="https://example.com/x.js"></script></head><body><script>console.log("page ran");</script></body></html>' },
    stopAfterRunningMs: 800,
    expect: { status: "cancelled", stdout: "page ran\n", diagnostic: { severity: "warning", message: "another site" } },
  },
  { name: "js: project with a page runs as a preview", track: "javascript", files: { "index.html": '<!doctype html><html><body><button id="b">go</button><script src="main.js"></script></body></html>', "main.js": 'console.log("button=" + document.getElementById("b").textContent);\n' }, stopAfterRunningMs: 800, expect: { status: "cancelled", stdout: "button=go\n" } },

  // ---------- "How websites work": the page's fetch() through the training channel ----------
  {
    name: "web: a task is added and listed through the training API, with the real journey",
    track: "html_css",
    training: true,
    files: {
      "index.html": '<!doctype html><html><body><ul id="list"></ul><script src="app.js"></script></body></html>',
      "app.js": `async function main() {
  const added = await fetch("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Buy milk" }) });
  const task = await added.json();
  console.log("add", added.status, task.title, task.done);
  const listed = await fetch("/api/tasks");
  const tasks = await listed.json();
  console.log("list", listed.status, tasks.length, tasks[0].title);
}
main().catch((error) => console.error("failed", error.message));
`,
    },
    stopAfterRunningMs: 2_500,
    expect: { status: "cancelled", stdout: "add 201 Buy milk false\nlist 200 1 Buy milk\n" },
    journeys: [
      ["frontend:request_sent", "request:request_received", "server:route_matched", "storage:query", "server:validation", "storage:query", "server:response_sent", "frontend:response_received"],
      ["frontend:request_sent", "request:request_received", "server:route_matched", "storage:query", "server:response_sent", "frontend:response_received"],
    ],
  },
  {
    name: "web: an empty title is refused by the server's validation and nothing is stored",
    track: "html_css",
    training: true,
    files: {
      "index.html": '<!doctype html><html><body><script src="app.js"></script></body></html>',
      "app.js": `fetch("/api/tasks", { method: "POST", body: JSON.stringify({ title: "  " }) })
  .then((response) => response.json().then((body) => console.log(response.status, body.problems[0].field, body.problems[0].rule)))
  .then(() => fetch("/api/tasks")).then((response) => response.json()).then((tasks) => console.log("stored", tasks.length));
`,
    },
    stopAfterRunningMs: 2_500,
    expect: { status: "cancelled", stdout: "400 title required\nstored 0\n" },
    journeys: [
      ["frontend:request_sent", "request:request_received", "server:route_matched", "server:validation", "server:response_sent", "frontend:response_received"],
      ["frontend:request_sent", "request:request_received", "server:route_matched", "storage:query", "server:response_sent", "frontend:response_received"],
    ],
  },
  {
    name: "web: the page cannot fetch another address, and /api/ paths never reach the platform's own API",
    track: "html_css",
    training: true,
    files: {
      "index.html": '<!doctype html><html><body><script src="app.js"></script></body></html>',
      "app.js": `fetch("https://example.com/").then(() => console.log("external=reached"), () => console.log("external=blocked"))
  .then(() => fetch("/api/execute/health")).then((response) => response.json().then((body) => console.log("platform-api", response.status, body.error)))
  .then(() => fetch("/api/tasks?x=1")).then(() => console.log("query=reached"), () => console.log("query=blocked"));
`,
    },
    stopAfterRunningMs: 2_500,
    expect: { status: "cancelled", stdout: "external=blocked\nplatform-api 404 no_route\nquery=blocked\n" },
    journeys: [
      ["frontend:request_blocked"],
      ["frontend:request_sent", "request:request_received", "server:route_not_found", "server:response_sent", "frontend:response_received"],
      ["frontend:request_blocked"],
    ],
  },
  {
    name: "web: without a training API the page's fetch() fails and nothing is sent",
    track: "html_css",
    files: {
      "index.html": '<!doctype html><html><body><script>fetch("/api/tasks").then(() => console.log("reached"), (error) => console.log("failed:", error.message));</script></body></html>',
    },
    stopAfterRunningMs: 1_000,
    expect: { status: "cancelled", stdout: "failed: This project has no training API.\n" },
  },

  // ---------- Server track through /api/execute (needs the runner service) ----------
  { name: "cpp: correct program through the execution API", track: "cpp", needsServer: true, stdin: "6 7\n", files: { "main.cpp": "#include <iostream>\nint main() { int a, b; std::cin >> a >> b; std::cout << a * b << std::endl; }\n" }, expect: { status: "success", phase: "run", stdout: "42\n" } },
  { name: "cpp: compile error through the execution API", track: "cpp", needsServer: true, files: { "main.cpp": "int main() { return missing; }\n" }, expect: { status: "error", phase: "compile", stdout: "", diagnostic: { file: "main.cpp", line: 1, column: 21, source: "compiler" } } },
  { name: "java: correct program through the execution API", track: "java", needsServer: true, stdin: "6 7\n", files: { "Main.java": 'import java.util.Scanner;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        System.out.println(in.nextInt() * in.nextInt());\n    }\n}\n' }, expect: { status: "success", phase: "run", stdout: "42\n" } },
  { name: "java: compile error through the execution API", track: "java", needsServer: true, files: { "Main.java": 'public class Main {\n    public static void main(String[] args) {\n        int count = "three";\n    }\n}\n' }, expect: { status: "error", phase: "compile", stdout: "", diagnostic: { file: "Main.java", line: 3, column: 21, source: "compiler" } } },
  { name: "csharp: correct program through the execution API", track: "csharp", needsServer: true, stdin: "6 7\n", files: { "Program.cs": 'var parts = (Console.ReadLine() ?? "").Split(\' \').Select(int.Parse).ToArray();\nConsole.WriteLine(parts[0] * parts[1]);\n' }, expect: { status: "success", phase: "run", stdout: "42\n" } },
  { name: "csharp: runtime exception through the execution API", track: "csharp", needsServer: true, files: { "Program.cs": 'Console.WriteLine("before");\nint[] values = new int[1];\nConsole.WriteLine(values[3]);\n' }, expect: { status: "error", phase: "run", stdout: "before\n", diagnostic: { file: "Program.cs", line: 3, source: "runtime", message: "IndexOutOfRangeException" } } },
];

function toRequest(testCase: HarnessCase): ExecutionRequest {
  return {
    projectId: "harness",
    revision: 1,
    track: testCase.track,
    stdin: testCase.stdin ?? "",
    files: Object.entries(testCase.files).map(([name, content], order) => ({ id: `f${order}`, name, language: testCase.track, content, order })),
  };
}

function compare(testCase: HarnessCase, result: ExecutionResult, elapsedMs: number): string[] {
  const { expect } = testCase;
  const problems: string[] = [];
  const check = (label: string, actual: unknown, wanted: unknown) => {
    if (wanted !== undefined && actual !== wanted) problems.push(`${label}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
  };
  check("status", result.status, expect.status);
  check("phase", result.phase, expect.phase);
  check("stdout", result.stdout, expect.stdout);
  check("stdoutTruncated", result.stdoutTruncated, expect.stdoutTruncated);
  check("unavailableReason", result.unavailableReason, expect.unavailableReason);
  for (const text of expect.stdoutIncludes ?? []) if (!result.stdout.includes(text)) problems.push(`stdout does not contain ${JSON.stringify(text)}`);
  for (const text of expect.stdoutExcludes ?? []) if (result.stdout.includes(text)) problems.push(`stdout contains ${JSON.stringify(text)}`);
  for (const text of expect.stderrIncludes ?? []) if (!result.stderr.includes(text)) problems.push(`stderr does not contain ${JSON.stringify(text)}`);
  if (expect.endsWithinMs !== undefined && elapsedMs > expect.endsWithinMs) problems.push(`took ${Math.round(elapsedMs)} ms, limit ${expect.endsWithinMs} ms`);
  const wanted = expect.diagnostic;
  if (wanted) {
    const found = result.diagnostics.some(
      (diagnostic) =>
        (wanted.file === undefined || diagnostic.file === wanted.file) &&
        (wanted.line === undefined || diagnostic.line === wanted.line) &&
        (wanted.column === undefined || diagnostic.column === wanted.column) &&
        (wanted.severity === undefined || diagnostic.severity === wanted.severity) &&
        (wanted.source === undefined || diagnostic.source === wanted.source) &&
        (wanted.message === undefined || diagnostic.message.includes(wanted.message)),
    );
    if (!found) problems.push(`no diagnostic matching ${JSON.stringify(wanted)} in ${JSON.stringify(result.diagnostics)}`);
  }
  return problems;
}

export interface RuntimeHarness {
  cases: readonly HarnessCase[];
  /** Runs one request through the adapter of its track and reports everything observed. */
  run(request: ExecutionRequest, options?: { stopAfterRunningMs?: number; trainingProjectId?: string }): Promise<Omit<HarnessOutcome, "name" | "pass" | "problems">>;
  runCase(name: string): Promise<HarnessOutcome>;
  /** Runs the cases one after another. Server cases are included only with `{ server: true }`. */
  runAll(options?: { server?: boolean; only?: CodeTrack }): Promise<HarnessOutcome[]>;
  /** Sandbox frames currently in the document; 0 after every run has ended. */
  openFrames(): number;
}

declare global {
  interface Window {
    __ytlRuntime?: RuntimeHarness;
  }
}

/** Puts the harness on `window.__ytlRuntime`. `preview` is where page previews are shown. Returns the uninstall function. */
export function installRuntimeHarness(preview?: HTMLElement): () => void {
  const adapters: Record<CodeTrack, RunAdapter> = createRunAdapters();
  let ownContainer: HTMLElement | null = null;
  const container = () => {
    if (preview) return preview;
    if (!ownContainer) {
      ownContainer = document.createElement("div");
      ownContainer.style.cssText = "width:480px;height:320px;border:1px solid #888;";
      ownContainer.dataset.ytlHarnessPreview = "";
      document.body.appendChild(ownContainer);
    }
    return ownContainer;
  };

  const run: RuntimeHarness["run"] = async (request, options = {}) => {
    const statuses: ExecutionStatus[] = [];
    const liveOutput: OutputChunk[] = [];
    const runtimeLoading: boolean[] = [];
    const journeys: TrainingJourney[] = [];
    const startedAt = performance.now();
    const handle = adapters[request.track](request, {
      previewContainer: container(),
      onOutput: (chunk) => liveOutput.push(chunk),
      onRuntimeLoading: (loading) => runtimeLoading.push(loading),
      ...(options.trainingProjectId ? { training: { projectId: options.trainingProjectId, onJourney: (journey: TrainingJourney) => journeys.push(journey) } } : {}),
    });
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    handle.subscribe((status) => {
      statuses.push(status);
      if (status === "running" && options.stopAfterRunningMs !== undefined && stopTimer === undefined) {
        stopTimer = setTimeout(() => handle.stop(), options.stopAfterRunningMs);
      }
    });
    const result = await handle.result;
    clearTimeout(stopTimer);
    return { result, statuses, liveOutput, runtimeLoading, journeys, elapsedMs: performance.now() - startedAt };
  };

  const runCase: RuntimeHarness["runCase"] = async (name) => {
    const testCase = HARNESS_CASES.find((candidate) => candidate.name === name);
    if (!testCase) throw new Error(`no harness case named ${JSON.stringify(name)}`);
    let trainingProjectId: string | undefined;
    if (testCase.training) {
      // A project of its own, emptied first, so earlier runs cannot change what this one sees.
      trainingProjectId = `harness-${HARNESS_CASES.indexOf(testCase)}`;
      await fetch("/api/training/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: trainingProjectId }) });
    }
    const observed = await run(toRequest(testCase), { stopAfterRunningMs: testCase.stopAfterRunningMs, trainingProjectId });
    const problems = compare(testCase, observed.result, observed.elapsedMs);
    if (testCase.journeys) {
      const seen = observed.journeys.map((journey) => journey.events.map((event) => `${event.layer}:${event.kind}`));
      if (JSON.stringify(seen) !== JSON.stringify(testCase.journeys)) problems.push(`journeys: expected ${JSON.stringify(testCase.journeys)}, got ${JSON.stringify(seen)}`);
      // Numbered from 1 within each journey, all of this run.
      for (const journey of observed.journeys) {
        if (journey.events.some((event, index) => event.seq !== index + 1 || event.runId !== observed.result.executionId)) problems.push(`journey ${journey.requestNumber} is not numbered 1..n for this run`);
      }
    }
    // What was reported live must be what the result holds.
    const live = (stream: OutputChunk["stream"]) => observed.liveOutput.filter((chunk) => chunk.stream === stream).map((chunk) => chunk.text).join("");
    if (live("stdout") !== observed.result.stdout) problems.push("live stdout differs from the result's stdout");
    if (observed.statuses.at(-1) !== observed.result.status) problems.push(`last status ${observed.statuses.at(-1)} differs from the result's ${observed.result.status}`);
    return { name, pass: problems.length === 0, problems, ...observed };
  };

  const harness: RuntimeHarness = {
    cases: HARNESS_CASES,
    run,
    runCase,
    async runAll(options = {}) {
      const outcomes: HarnessOutcome[] = [];
      for (const testCase of HARNESS_CASES) {
        if (testCase.needsServer && !options.server) continue;
        if (options.only && testCase.track !== options.only) continue;
        outcomes.push(await runCase(testCase.name));
      }
      return outcomes;
    },
    openFrames: () => document.querySelectorAll("iframe[sandbox]").length,
  };
  window.__ytlRuntime = harness;
  return () => {
    if (window.__ytlRuntime === harness) delete window.__ytlRuntime;
    ownContainer?.remove();
  };
}
