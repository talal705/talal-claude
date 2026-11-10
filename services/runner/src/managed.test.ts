// Java and C#: real JDK and real .NET SDK, real programs, under the job sandbox. Nothing is mocked.
// The toolchain locations come from RUNNER_JAVA_HOME and RUNNER_DOTNET_ROOT (root .env.local).
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CppAdapter } from "./adapters/cpp.ts";
import { CsharpAdapter, parseCscDiagnostics, parseDotnetException } from "./adapters/csharp.ts";
import { JavaAdapter, findMainClass, parseJavaException, parseJavacDiagnostics } from "./adapters/java.ts";
import type { RunnerConfig } from "./config.ts";
import type { ExecutionResult, JobSnapshot } from "./contract.ts";
import { Runner } from "./runner.ts";
import { detectSandbox } from "./sandbox.ts";

const MIB = 1024 * 1024;
const HEAP = 256 * MIB;

const TEST_CONFIG: Partial<RunnerConfig> = {
  maxConcurrent: 4,
  // Generous: a virtual machine takes a moment to start on a busy machine. The time-limit test uses its own runner.
  runWallMs: 30_000,
  cpuSeconds: 20,
  maxOutputBytes: 64 * 1024,
  javaHome: process.env.RUNNER_JAVA_HOME,
  dotnetRoot: process.env.RUNNER_DOTNET_ROOT,
};

// What can run here is decided before the suites are defined.
const java = await new JavaAdapter({ javaHome: process.env.RUNNER_JAVA_HOME, heapBytes: HEAP }).detect();
const csharp = await new CsharpAdapter({ dotnetRoot: process.env.RUNNER_DOTNET_ROOT, heapBytes: HEAP }).detect();
const sandbox = await detectSandbox();
function skipMessage(name: string, status: { available: boolean; detail?: string }): string | null {
  const reason = !sandbox.available ? `no process sandbox (${sandbox.detail})` : !status.available ? status.detail : null;
  if (!reason) return null;
  const message = `SKIPPED: ${name} runner tests did not run on this host: ${reason}.`;
  process.stderr.write(`\n${message}\n`);
  return message;
}
const skipJava = skipMessage("Java", java);
const skipCsharp = skipMessage("C#", csharp);

let workRoot: string;
let runner: Runner;

type Files = Record<string, string>;
type Track = "java" | "csharp";

function request(track: Track, files: Files, stdin?: string) {
  return {
    projectId: "project-1",
    revision: 7,
    track,
    stdin,
    files: Object.entries(files).map(([name, content], order) => ({ id: `f${order}`, name, language: track, content, order })),
  };
}

function run(track: Track, files: Files, stdin?: string, on: Runner = runner): Promise<ExecutionResult> {
  return on.wait(on.submit(request(track, files, stdin)).executionId);
}

async function waitForReadyFile(): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    for (const job of await readdir(workRoot)) {
      if (existsSync(join(workRoot, job, "src", "ready.txt"))) return;
    }
    if (Date.now() > deadline) throw new Error("the program never created ready.txt");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

beforeAll(async () => {
  workRoot = await mkdtemp(join(tmpdir(), "ytl-managed-test-"));
  runner = await Runner.create({ ...TEST_CONFIG, workRoot });
});

afterAll(async () => {
  await runner.close();
  await rm(workRoot, { recursive: true, force: true });
});

afterEach(async () => {
  expect(await readdir(workRoot)).toEqual([]);
});

// A real file of this project and a real listening socket, for the sandbox tests.
const PROJECT_FILE = fileURLToPath(new URL("../package.json", import.meta.url));

async function withListener<T>(body: (port: number, connections: () => number) => Promise<T>): Promise<T> {
  let count = 0;
  const listener = createServer((socket) => {
    count++;
    socket.destroy();
  });
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  try {
    return await body((listener.address() as { port: number }).port, () => count);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
}

// ---------------------------------------------------------------------------------------------
// Java
// ---------------------------------------------------------------------------------------------

const JAVA_HELLO = `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, lab!");
    }
}
`;

const JAVA_SLEEPER = `import java.nio.file.Files;
import java.nio.file.Path;
public class Main {
    public static void main(String[] args) throws Exception {
        System.out.println("started");
        Files.writeString(Path.of("ready.txt"), "");
        Thread.sleep(120_000);
        System.out.println("woke up");
    }
}
`;

describe.skipIf(skipJava !== null)(skipJava ?? "runner: Java", { timeout: 120_000 }, () => {
  it("reports the real JDK in health", () => {
    const health = runner.health();
    expect(health.toolchains.java.available).toBe(true);
    expect(health.toolchains.java.version).toMatch(/javac \d+/);
    expect(health.toolchains.java.version).toMatch(/openjdk|java/i);
  });

  it("compiles and runs a correct program", async () => {
    const result = await run("java", { "Main.java": JAVA_HELLO });
    expect(result).toMatchObject({ status: "success", phase: "run", stdout: "Hello, lab!\n", stderr: "", exitCode: 0, diagnostics: [], compilerOutput: "", track: "java", revision: 7 });
    expect(result.compileMs).toBeGreaterThan(0);
    console.log(`java timings: compile ${result.compileMs} ms, run ${result.runMs} ms`);
  });

  it("reports a compile error with file, line and column", async () => {
    const result = await run("java", {
      "Main.java": `public class Main {
    public static void main(String[] args) {
        int count = "three";
        System.out.println(count);
    }
}
`,
    });
    expect(result).toMatchObject({ status: "error", phase: "compile", stdout: "", stderr: "" });
    expect(result.runMs).toBeUndefined();
    expect(result.compilerOutput).toContain("Main.java:3: error: incompatible types");
    expect(result.compilerOutput).not.toContain(workRoot);
    expect(result.diagnostics).toEqual([
      { severity: "error", message: "incompatible types: String cannot be converted to int", file: "Main.java", line: 3, column: 21, source: "compiler" },
    ]);
  });

  it("reports an uncaught exception with the project file and line, keeping earlier output", async () => {
    const result = await run("java", {
      "Main.java": `import stats.Mean;
public class Main {
    public static void main(String[] args) {
        System.out.println("before");
        System.out.println(Mean.of(new int[0]));
        System.out.println("never");
    }
}
`,
      "stats/Mean.java": `package stats;
public class Mean {
    public static int of(int[] values) {
        int sum = 0;
        for (int value : values) sum += value;
        return sum / values.length;
    }
}
`,
    });
    expect(result).toMatchObject({ status: "error", phase: "run", stdout: "before\n", exitCode: 1 });
    expect(result.stderr).toContain("java.lang.ArithmeticException: / by zero");
    expect(result.diagnostics).toEqual([{ severity: "error", message: "java.lang.ArithmeticException: / by zero", file: "stats/Mean.java", line: 6, source: "runtime" }]);
  });

  it("builds a multi-file program with packages, starting the class that has main", async () => {
    const result = await run("java", {
      "app/Start.java": `package app;
import shapes.Rectangle;
import shapes.Shape;
public class Start {
    public static void main(String[] args) {
        Shape shape = new Rectangle(6, 7);
        System.out.println(shape.name() + " area = " + shape.area());
    }
}
`,
      "shapes/Shape.java": "package shapes;\npublic interface Shape {\n    int area();\n    String name();\n}\n",
      "shapes/Rectangle.java": `package shapes;
public record Rectangle(int width, int height) implements Shape {
    public int area() { return width * height; }
    public String name() { return "rectangle"; }
}
`,
    });
    expect(result).toMatchObject({ status: "success", stdout: "rectangle area = 42\n", diagnostics: [] });
  });

  it("names the right file for an error in a second file", async () => {
    const result = await run("java", {
      "Main.java": "public class Main {\n    public static void main(String[] args) {\n        System.out.println(shapes.Area.of(2, 3));\n    }\n}\n",
      "shapes/Area.java": "package shapes;\npublic class Area {\n    public static int of(int w, int h) {\n        return w * missing;\n    }\n}\n",
    });
    expect(result).toMatchObject({ status: "error", phase: "compile" });
    expect(result.diagnostics).toContainEqual({ severity: "error", message: "cannot find symbol", file: "shapes/Area.java", line: 4, column: 20, source: "compiler" });
  });

  it("refuses a project without a main method before compiling", async () => {
    const result = await run("java", { "Util.java": "public class Util {\n    static int twice(int n) { return n * 2; }\n}\n" });
    expect(result).toMatchObject({ status: "error", phase: "compile", stdout: "" });
    expect(result.diagnostics[0]).toMatchObject({ severity: "error", source: "compiler" });
    expect(result.diagnostics[0].message).toContain("No main method");
    expect(result.compileMs).toBeUndefined();
  });

  it("passes stdin to the program, including non-ASCII text", async () => {
    const result = await run(
      "java",
      {
        "Main.java": `import java.util.Scanner;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in, "UTF-8");
        String name = in.nextLine();
        int a = in.nextInt(), b = in.nextInt();
        System.out.println("Hi " + name + ", " + (a + b));
    }
}
`,
      },
      "سارة Sara\n19 23\n",
    );
    expect(result).toMatchObject({ status: "success", stdout: "Hi سارة Sara, 42\n" });
  });

  it("stops an infinite loop at the time limit", async () => {
    const strict = await Runner.create({ ...TEST_CONFIG, workRoot, runWallMs: 3_000 });
    const result = await run("java", { "Main.java": 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("looping");\n        while (true) { }\n    }\n}\n' }, undefined, strict);
    expect(result).toMatchObject({ status: "timeout", phase: "run", stdout: "looping\n" });
    expect(result.runMs).toBeGreaterThanOrEqual(2_900);
    await strict.close();
  });

  it("stops a program that prints without end", async () => {
    const result = await run("java", { "Main.java": 'public class Main {\n    public static void main(String[] args) {\n        while (true) System.out.println("spam spam spam spam");\n    }\n}\n' });
    expect(result).toMatchObject({ status: "output_limit", phase: "run", stdoutTruncated: true });
    expect(Buffer.byteLength(result.stdout)).toBe(64 * 1024);
  });

  it("holds the program to the heap limit", async () => {
    const result = await run("java", {
      "Main.java": `import java.util.ArrayList;
import java.util.List;
public class Main {
    public static void main(String[] args) {
        List<byte[]> blocks = new ArrayList<>();
        for (int i = 0; i < 200; i++) blocks.add(new byte[16 * 1024 * 1024]);
        System.out.println("allocated " + blocks.size());
    }
}
`,
    });
    expect(result).toMatchObject({ status: "error", phase: "run", stdout: "" });
    expect(result.stderr).toContain("java.lang.OutOfMemoryError");
    expect(result.diagnostics[0]).toMatchObject({ source: "runtime", file: "Main.java", line: 6 });
  });

  it("cancels a running program and runs a fresh one afterwards", async () => {
    const job = runner.submit(request("java", { "Main.java": JAVA_SLEEPER }));
    await waitForReadyFile();
    expect(runner.get(job.executionId)?.status).toBe("running");
    runner.cancel(job.executionId);
    const result = await runner.wait(job.executionId);
    expect(result).toMatchObject({ status: "cancelled", phase: "run", stdout: "started\n" });
    expect((await run("java", { "Main.java": JAVA_HELLO })).stdout).toBe("Hello, lab!\n");
  });

  it("blocks network, child processes, reads of project files and writes outside the workspace", async () => {
    await withListener(async (port, connections) => {
      const result = await run(
        "java",
        {
          "Main.java": `import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Scanner;
public class Main {
    interface Action { void run() throws Exception; }
    static void attempt(String label, Action action) {
        try { action.run(); System.out.println(label + "=allowed"); } catch (Throwable error) { System.out.println(label + "=denied"); }
    }
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int port = Integer.parseInt(in.nextLine());
        String projectFile = in.nextLine(), outside = in.nextLine();
        attempt("network", () -> new java.net.Socket("127.0.0.1", port).close());
        attempt("exec", () -> new ProcessBuilder("/bin/echo", "x").start().waitFor());
        attempt("read-project", () -> Files.readString(Path.of(projectFile)));
        attempt("read-home", () -> Files.list(Path.of(System.getenv("REAL_HOME") == null ? "/Users" : System.getenv("REAL_HOME"))).count());
        attempt("write-outside", () -> Files.writeString(Path.of(outside), "x"));
        attempt("write-inside", () -> Files.writeString(Path.of("scratch.txt"), "x"));
        System.out.println("env=" + String.join(",", new java.util.TreeSet<>(System.getenv().keySet())));
    }
}
`,
        },
        `${port}\n${PROJECT_FILE}\n${join(workRoot, "escaped.txt")}\n`,
      );
      expect([result.status, result.compilerOutput, result.stderr]).toEqual(["success", "", ""]);
      const lines = result.stdout.trim().split("\n");
      expect(lines.slice(0, 6)).toEqual(["network=denied", "exec=denied", "read-project=denied", "read-home=denied", "write-outside=denied", "write-inside=allowed"]);
      // Only what the runner sets (plus what the shell and the JVM launcher add): no secret of the platform.
      expect(lines[6]).not.toMatch(/DATABASE_URL|SESSION_SECRET|RUNNER_TOKEN|AI_API_KEY/);
      expect(connections()).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// C#
// ---------------------------------------------------------------------------------------------

const CS_HELLO = `class Program
{
    static void Main()
    {
        Console.WriteLine("Hello, lab!");
    }
}
`;

const CS_SLEEPER = `Console.WriteLine("started");
File.WriteAllText("ready.txt", "");
Thread.Sleep(120_000);
Console.WriteLine("woke up");
`;

describe.skipIf(skipCsharp !== null)(skipCsharp ?? "runner: C#", { timeout: 120_000 }, () => {
  it("reports the real .NET SDK in health", () => {
    const health = runner.health();
    expect(health.toolchains.csharp.available).toBe(true);
    expect(health.toolchains.csharp.version).toMatch(/\.NET SDK \d+\.\d+\.\d+, runtime \d+\.\d+\.\d+, C# compiler \d+/);
  });

  it("compiles and runs a correct program", async () => {
    const result = await run("csharp", { "Program.cs": CS_HELLO });
    expect(result).toMatchObject({ status: "success", phase: "run", stdout: "Hello, lab!\n", stderr: "", exitCode: 0, diagnostics: [], compilerOutput: "", track: "csharp" });
    console.log(`csharp timings: compile ${result.compileMs} ms, run ${result.runMs} ms`);
  });

  it("runs a program written as top-level statements", async () => {
    const result = await run("csharp", { "Program.cs": 'var numbers = new List<int> { 1, 2, 3 };\nConsole.WriteLine($"sum = {numbers.Sum()}");\n' });
    expect(result).toMatchObject({ status: "success", stdout: "sum = 6\n" });
  });

  it("reports a compile error with file, line, column and range", async () => {
    const result = await run("csharp", {
      "Program.cs": `class Program
{
    static void Main()
    {
        int count = "three";
        Console.WriteLine(count);
    }
}
`,
    });
    expect(result).toMatchObject({ status: "error", phase: "compile", stdout: "", stderr: "" });
    expect(result.runMs).toBeUndefined();
    expect(result.compilerOutput).not.toContain(workRoot);
    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        message: "Cannot implicitly convert type 'string' to 'int' (CS0029)",
        file: "Program.cs",
        line: 5,
        column: 21,
        endLine: 5,
        endColumn: 28,
        source: "compiler",
      },
    ]);
  });

  it("keeps compiler warnings as diagnostics when the program still runs", async () => {
    const result = await run("csharp", { "Program.cs": 'int unused = 4;\nConsole.WriteLine("ok");\n' });
    expect(result.status).toBe("success");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "warning", file: "Program.cs", line: 1, column: 5, source: "compiler" }));
  });

  it("reports an unhandled exception with the project file and line, keeping earlier output", async () => {
    const result = await run("csharp", {
      "Program.cs": 'using Stats;\nConsole.WriteLine("before");\nConsole.WriteLine(Mean.Of(new int[0]));\nConsole.WriteLine("never");\n',
      "Stats/Mean.cs": `namespace Stats;
public static class Mean
{
    public static int Of(int[] values)
    {
        int sum = 0;
        foreach (int value in values) sum += value;
        return sum / values.Length;
    }
}
`,
    });
    expect(result).toMatchObject({ status: "error", phase: "run", stdout: "before\n" });
    expect(result.stderr).toContain("System.DivideByZeroException");
    expect(result.stderr).not.toContain(workRoot);
    expect(result.diagnostics).toEqual([expect.objectContaining({ severity: "error", file: "Stats/Mean.cs", line: 8, source: "runtime", message: expect.stringContaining("System.DivideByZeroException") })]);
  });

  it("builds a multi-file program with namespaces in subfolders", async () => {
    const result = await run("csharp", {
      "Program.cs": 'using Shapes;\nIShape shape = new Rectangle(6, 7);\nConsole.WriteLine($"{shape.Name} area = {shape.Area}");\n',
      "Shapes/IShape.cs": "namespace Shapes;\npublic interface IShape\n{\n    int Area { get; }\n    string Name { get; }\n}\n",
      "Shapes/Rectangle.cs": 'namespace Shapes;\npublic record Rectangle(int Width, int Height) : IShape\n{\n    public int Area => Width * Height;\n    public string Name => "rectangle";\n}\n',
    });
    expect(result).toMatchObject({ status: "success", stdout: "rectangle area = 42\n", diagnostics: [] });
  });

  it("names the right file for an error in a second file", async () => {
    const result = await run("csharp", {
      "Program.cs": "Console.WriteLine(Shapes.Area.Of(2, 3));\n",
      "Shapes/Area.cs": "namespace Shapes;\npublic static class Area\n{\n    public static int Of(int w, int h) => w * missing;\n}\n",
    });
    expect(result).toMatchObject({ status: "error", phase: "compile" });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", file: "Shapes/Area.cs", line: 4, column: 47, message: expect.stringContaining("CS0103") }));
  });

  it("passes stdin to the program, including non-ASCII text", async () => {
    const result = await run(
      "csharp",
      { "Program.cs": 'string name = Console.ReadLine() ?? "";\nint[] parts = (Console.ReadLine() ?? "").Split(\' \').Select(int.Parse).ToArray();\nConsole.WriteLine($"Hi {name}, {parts[0] + parts[1]}");\nConsole.WriteLine(Console.ReadLine() is null ? "end" : "more");\n' },
      "سارة Sara\n19 23\n",
    );
    expect(result).toMatchObject({ status: "success", stdout: "Hi سارة Sara, 42\nend\n" });
  });

  it("stops an infinite loop at the time limit", async () => {
    const strict = await Runner.create({ ...TEST_CONFIG, workRoot, runWallMs: 3_000 });
    const result = await run("csharp", { "Program.cs": 'Console.WriteLine("looping");\nwhile (true) { }\n' }, undefined, strict);
    expect(result).toMatchObject({ status: "timeout", phase: "run", stdout: "looping\n" });
    expect(result.runMs).toBeGreaterThanOrEqual(2_900);
    await strict.close();
  });

  it("stops a program that prints without end", async () => {
    const result = await run("csharp", { "Program.cs": 'while (true) Console.WriteLine("spam spam spam spam");\n' });
    expect(result).toMatchObject({ status: "output_limit", phase: "run", stdoutTruncated: true });
    expect(Buffer.byteLength(result.stdout)).toBe(64 * 1024);
  });

  it("holds the program to the heap limit", async () => {
    const result = await run("csharp", {
      "Program.cs": 'var blocks = new List<byte[]>();\nfor (int i = 0; i < 200; i++) blocks.Add(new byte[16 * 1024 * 1024]);\nConsole.WriteLine($"allocated {blocks.Count}");\n',
    });
    expect(result).toMatchObject({ status: "error", phase: "run", stdout: "" });
    expect(result.stderr).toMatch(/OutOfMemoryException|Out of memory/i);
  });

  it("cancels a running program and runs a fresh one afterwards", async () => {
    const job = runner.submit(request("csharp", { "Program.cs": CS_SLEEPER }));
    await waitForReadyFile();
    expect(runner.get(job.executionId)?.status).toBe("running");
    runner.cancel(job.executionId);
    const result = await runner.wait(job.executionId);
    expect(result).toMatchObject({ status: "cancelled", phase: "run", stdout: "started\n" });
    expect((await run("csharp", { "Program.cs": CS_HELLO })).stdout).toBe("Hello, lab!\n");
  });

  it("blocks network, child processes, reads of project files and writes outside the workspace", async () => {
    await withListener(async (port, connections) => {
      const result = await run(
        "csharp",
        {
          "Program.cs": `int port = int.Parse(Console.ReadLine()!);
string projectFile = Console.ReadLine()!, outside = Console.ReadLine()!;
void Attempt(string label, Action action)
{
    try { action(); Console.WriteLine(label + "=allowed"); } catch (Exception) { Console.WriteLine(label + "=denied"); }
}
Attempt("network", () => { using var client = new System.Net.Sockets.TcpClient("127.0.0.1", port); });
Attempt("exec", () => System.Diagnostics.Process.Start("/bin/echo", "x")!.WaitForExit());
Attempt("read-project", () => File.ReadAllText(projectFile));
Attempt("read-home", () => Directory.GetFiles("/Users"));
Attempt("write-outside", () => File.WriteAllText(outside, "x"));
Attempt("write-inside", () => File.WriteAllText("scratch.txt", "x"));
Console.WriteLine("env=" + string.Join(",", Environment.GetEnvironmentVariables().Keys.Cast<string>().OrderBy(key => key)));
`,
        },
        `${port}\n${PROJECT_FILE}\n${join(workRoot, "escaped.txt")}\n`,
      );
      expect([result.status, result.compilerOutput, result.stderr]).toEqual(["success", "", ""]);
      const lines = result.stdout.trim().split("\n");
      expect(lines.slice(0, 6)).toEqual(["network=denied", "exec=denied", "read-project=denied", "read-home=denied", "write-outside=denied", "write-inside=allowed"]);
      expect(lines[6]).not.toMatch(/DATABASE_URL|SESSION_SECRET|RUNNER_TOKEN|AI_API_KEY/);
      expect(connections()).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Missing toolchains and parsers: these run everywhere.
// ---------------------------------------------------------------------------------------------

describe("runner: toolchain not installed", { timeout: 60_000 }, () => {
  it("reports Java and C# as not installed when their paths hold nothing, and prints nothing for them", async () => {
    const missing = await Runner.create(
      { ...TEST_CONFIG, workRoot },
      {
        adapters: [
          new CppAdapter(),
          new JavaAdapter({ javaHome: "/nonexistent/jdk", heapBytes: HEAP, searchPath: "/nonexistent/bin" }),
          new CsharpAdapter({ dotnetRoot: "/nonexistent/dotnet", heapBytes: HEAP, searchPath: "/nonexistent/bin" }),
        ],
      },
    );
    const health = missing.health();
    for (const track of ["java", "csharp"] as const) {
      expect(health.toolchains[track]).toMatchObject({ available: false, reason: "toolchain_not_installed" });
      expect(health.toolchains[track].detail).toMatch(/not installed.*\/nonexistent\//);
      const snapshot: JobSnapshot = missing.submit(request(track, track === "java" ? { "Main.java": JAVA_HELLO } : { "Program.cs": CS_HELLO }));
      expect(snapshot.result).toMatchObject({
        status: "runner_unavailable",
        unavailableReason: "toolchain_not_installed",
        phase: null,
        stdout: "",
        stderr: "",
        compilerOutput: "",
        diagnostics: [],
      });
      expect(snapshot.result?.exitCode).toBeUndefined();
    }
    await missing.close();
  });

  it("does not take a JDK placeholder or a runtime without an SDK for a toolchain", async () => {
    // /usr/bin holds macOS's javac placeholder; it exists but cannot compile without a JDK behind it.
    const placeholder = await new JavaAdapter({ heapBytes: HEAP, searchPath: "/nonexistent/bin" }).detect();
    expect(placeholder).toMatchObject({ available: false, reason: "toolchain_not_installed" });
    const empty = await new CsharpAdapter({ dotnetRoot: tmpdir(), heapBytes: HEAP, searchPath: "/nonexistent/bin" }).detect();
    expect(empty).toMatchObject({ available: false, reason: "toolchain_not_installed" });
    expect(empty.detail).toContain("no dotnet host");
  });
});

describe("Java and C# output parsers", () => {
  it("parses javac errors and warnings, taking the column from the caret line", () => {
    const output = [
      "Main.java:3: error: incompatible types: String cannot be converted to int",
      '        int count = "three";',
      "                    ^",
      "shapes/Area.java:4: error: cannot find symbol",
      "        return w * missing;",
      "                   ^",
      "  symbol:   variable missing",
      "  location: class Area",
      "./Old.java:7: warning: [deprecation] stop() in Thread has been deprecated",
      "        t.stop();",
      "         ^",
      "error: no source files",
      "Note: Some input files use unchecked or unsafe operations.",
      "2 errors",
      "1 warning",
    ].join("\n");
    expect(parseJavacDiagnostics(output)).toEqual([
      { severity: "error", message: "incompatible types: String cannot be converted to int", file: "Main.java", line: 3, column: 21, source: "compiler" },
      { severity: "error", message: "cannot find symbol", file: "shapes/Area.java", line: 4, column: 20, source: "compiler" },
      { severity: "warning", message: "[deprecation] stop() in Thread has been deprecated", file: "Old.java", line: 7, column: 10, source: "compiler" },
      { severity: "error", message: "no source files", source: "compiler" },
    ]);
  });

  it("finds the main class from the sources", () => {
    const file = (path: string, content: string) => ({ path, content });
    expect(findMainClass([file("Main.java", JAVA_HELLO)])).toBe("Main");
    expect(findMainClass([file("app/Start.java", "package app;\npublic class Start { public static void main(String[] a) {} }")])).toBe("app.Start");
    expect(findMainClass([file("Util.java", "class Util { static int f() { return 1; } }")])).toBeNull();
    // Not fooled by comments and strings.
    expect(findMainClass([file("A.java", 'class A { String s = "static void main("; /* void main( */ // void main(\n }')])).toBeNull();
    // Several entry points: Main.java wins, else the first file.
    const two = [file("Tool.java", "class Tool { public static void main(String[] a) {} }"), file("Main.java", JAVA_HELLO)];
    expect(findMainClass(two)).toBe("Main");
    expect(findMainClass([two[0], file("Other.java", "class Other { public static void main(String[] a) {} }")])).toBe("Tool");
    // The class that declares main, when a file holds several types.
    expect(findMainClass([file("Shapes.java", "interface Shape {}\nrecord Box(int w) implements Shape {}\nclass Runner { public static void main(String[] a) {} }")])).toBe("Runner");
    // A type nested inside the main class is not the main class.
    expect(findMainClass([file("Main.java", "public class Main {\n  interface Action { void run(); }\n  static class Helper {}\n  public static void main(String[] a) {}\n}")])).toBe("Main");
    // A compact source file (instance main, no class): the class is named after the file.
    expect(findMainClass([file("Hello.java", 'void main() {\n    IO.println("hi");\n}\n')])).toBe("Hello");
  });

  it("reads a Java exception, using the first frame that is a project file", () => {
    const files = [{ path: "Main.java", content: "" }, { path: "stats/Mean.java", content: "" }];
    const stderr = 'Exception in thread "main" java.lang.ArithmeticException: / by zero\n\tat java.base/java.lang.Integer.divide(Integer.java:99)\n\tat stats.Mean.of(Mean.java:6)\n\tat Main.main(Main.java:5)\n';
    expect(parseJavaException(stderr, files)).toEqual([{ severity: "error", message: "java.lang.ArithmeticException: / by zero", file: "stats/Mean.java", line: 6, source: "runtime" }]);
    expect(parseJavaException("just a warning\n", files)).toEqual([]);
    // Two files with the same name in different folders: the frame is ambiguous, so no file is claimed.
    const twins = [{ path: "a/Util.java", content: "" }, { path: "b/Util.java", content: "" }];
    expect(parseJavaException('Exception in thread "main" java.lang.IllegalStateException\n\tat a.Util.f(Util.java:3)\n', twins)).toEqual([{ severity: "error", message: "java.lang.IllegalStateException", source: "runtime" }]);
  });

  it("parses C# compiler output with and without an end position", () => {
    const output = [
      "Program.cs(5,21,5,28): error CS0029: Cannot implicitly convert type 'string' to 'int'",
      "./Shapes/Area.cs(4,47): error CS0103: The name 'missing' does not exist in the current context",
      "Program.cs(1,5,1,11): warning CS0219: The variable 'unused' is assigned but its value is never used",
      "error CS5001: Program does not contain a static 'Main' method suitable for an entry point",
      "",
    ].join("\r\n");
    expect(parseCscDiagnostics(output)).toEqual([
      { severity: "error", message: "Cannot implicitly convert type 'string' to 'int' (CS0029)", file: "Program.cs", line: 5, column: 21, endLine: 5, endColumn: 28, source: "compiler" },
      { severity: "error", message: "The name 'missing' does not exist in the current context (CS0103)", file: "Shapes/Area.cs", line: 4, column: 47, source: "compiler" },
      { severity: "warning", message: "The variable 'unused' is assigned but its value is never used (CS0219)", file: "Program.cs", line: 1, column: 5, endLine: 1, endColumn: 11, source: "compiler" },
      { severity: "error", message: "Program does not contain a static 'Main' method suitable for an entry point (CS5001)", source: "compiler" },
    ]);
  });

  it("reads a .NET unhandled exception", () => {
    const files = [{ path: "Program.cs", content: "" }, { path: "Stats/Mean.cs", content: "" }];
    const stderr = "Unhandled exception. System.DivideByZeroException: Attempted to divide by zero.\n   at System.Linq.Enumerable.Sum()\n   at Stats.Mean.Of(Int32[] values) in ./Stats/Mean.cs:line 8\n   at Program.<Main>$(String[] args) in ./Program.cs:line 3\n";
    expect(parseDotnetException(stderr, files)).toEqual([
      { severity: "error", message: "System.DivideByZeroException: Attempted to divide by zero.", file: "Stats/Mean.cs", line: 8, source: "runtime" },
    ]);
    expect(parseDotnetException("warning only\n", files)).toEqual([]);
  });
});
