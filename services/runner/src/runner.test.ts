// These tests compile and run real C++ programs with the host's compiler. Nothing is mocked.
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CODE_FILE_NAME_MAX_DEPTH, CODE_FILE_NAME_MAX_LENGTH, CODE_FILE_NAME_SEGMENT, isValidCodeFileName } from "@ytl/contracts";
import { parseClangDiagnostics } from "./adapters/cpp.ts";
import type { RunnerConfig } from "./config.ts";
import { RunnerRequestError, type ExecutionResult, type JobSnapshot } from "./contract.ts";
import { MAX_DEPTH, MAX_PATH_LENGTH, SEGMENT_PATTERN, normalizeFilePath } from "./paths.ts";
import { Runner } from "./runner.ts";
import { detectTestHost } from "./test-host.ts";

const host = await detectTestHost();

const KIB = 1024;
const MIB = 1024 * KIB;

let workRoot: string;
let runner: Runner;

const TEST_CONFIG: Partial<RunnerConfig> = {
  maxConcurrent: 4,
  // Generous: a new executable can take seconds to start on a busy machine. Tests of the time
  // limit itself use a runner with tight limits.
  runWallMs: 15_000,
  cpuSeconds: 10,
  maxOutputBytes: 64 * KIB,
  maxFileBytes: MIB,
  memoryWatchdogBytes: 128 * MIB,
};

type Files = Record<string, string>;

function request(files: Files, extra: { stdin?: string; track?: string; revision?: number } = {}) {
  return {
    projectId: "project-1",
    revision: extra.revision ?? 7,
    track: extra.track ?? "cpp",
    stdin: extra.stdin,
    files: Object.entries(files).map(([name, content], order) => ({ id: `f${order}`, name, language: "cpp", content, order })),
  };
}

function run(files: Files, extra?: Parameters<typeof request>[1], on: Runner = runner): Promise<ExecutionResult> {
  return on.wait(on.submit(request(files, extra)).executionId);
}

async function waitForStatus(on: Runner, id: string, status: JobSnapshot["status"]): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (on.get(id)?.status !== status) {
    if (Date.now() > deadline) throw new Error(`job never reached ${status}; it is ${on.get(id)?.status}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Waits until a running program has created \`ready.txt\` in its workspace (it does so after printing). */
async function waitForReadyFile(): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    for (const job of await readdir(workRoot)) {
      if (existsSync(join(workRoot, job, "src", "ready.txt"))) return;
    }
    if (Date.now() > deadline) throw new Error("the program never created ready.txt");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function expectInvalid(action: () => unknown, code: RunnerRequestError["code"] = "invalid_request"): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(RunnerRequestError);
  expect((thrown as RunnerRequestError).code).toBe(code);
}

const HELLO = `#include <iostream>
int main() { std::cout << "Hello, lab!" << std::endl; return 0; }
`;

// Prints its PID, signals readiness, then sleeps far longer than any limit in these tests.
const SLEEPER = `#include <iostream>
#include <fstream>
#include <thread>
#include <chrono>
#include <unistd.h>
int main() {
  std::cout << getpid() << std::endl;
  { std::ofstream ready("ready.txt"); }
  std::this_thread::sleep_for(std::chrono::seconds(120));
  std::cout << "woke up" << std::endl;
}
`;

beforeAll(async () => {
  workRoot = await mkdtemp(join(tmpdir(), "ytl-runner-test-"));
  runner = await Runner.create({ ...TEST_CONFIG, workRoot });
});

afterAll(async () => {
  await runner.close();
  await rm(workRoot, { recursive: true, force: true });
});

afterEach(async () => {
  // Every job's workspace is gone once its result is delivered, whatever the outcome.
  expect(await readdir(workRoot)).toEqual([]);
});

describe.skipIf(!host.ok)(host.ok ? "runner: toolchains" : host.skipMessage, { timeout: 60_000 }, () => {
  it("reports the real C++ compiler and the process sandbox in health", () => {
    const health = runner.health();
    expect(health.toolchains.cpp.available).toBe(true);
    expect(health.toolchains.cpp.version).toMatch(/clang|g\+\+|gcc/i);
    expect(health.sandbox).toMatchObject({ kind: "macos-seatbelt", available: true, required: true });
    expect(health.queue).toMatchObject({ running: 0, queued: 0, maxConcurrent: 4 });
  });

  it("refuses to execute when the sandbox is required but unavailable", async () => {
    const unsandboxed = await Runner.create(
      { ...TEST_CONFIG, workRoot },
      { sandbox: { kind: "none", available: false, detail: "test: no sandbox", wrap: (_p, _w, _r, argv) => argv } },
    );
    expect(unsandboxed.health().toolchains.cpp).toMatchObject({ available: false, reason: "sandbox_unavailable" });
    const result = await run({ "main.cpp": HELLO }, {}, unsandboxed);
    expect(result).toMatchObject({ status: "runner_unavailable", unavailableReason: "sandbox_unavailable", stdout: "" });
    await unsandboxed.close();
  });
});

describe.skipIf(!host.ok)(host.ok ? "runner: C++ programs" : host.skipMessage, { timeout: 60_000 }, () => {
  it("compiles and runs a correct program", async () => {
    const result = await run({ "main.cpp": HELLO });
    expect(result).toMatchObject({
      status: "success",
      phase: "run",
      stdout: "Hello, lab!\n",
      stderr: "",
      stdoutTruncated: false,
      exitCode: 0,
      diagnostics: [],
      compilerOutput: "",
      projectId: "project-1",
      revision: 7,
      track: "cpp",
    });
    expect(result.executionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.compileMs).toBeGreaterThan(0);
    expect(result.runMs).toBeGreaterThanOrEqual(0);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(result.compileMs!);
    expect(result.signal).toBeUndefined();
  });

  it("reports a compile error with file, line and column parsed from the compiler", async () => {
    const result = await run({
      "main.cpp": `#include <iostream>
int main() {
  int count = "three";
  std::cout << count << std::endl;
}
`,
    });
    expect(result).toMatchObject({ status: "error", phase: "compile", stdout: "", stderr: "" });
    expect(result.exitCode).toBe(1);
    expect(result.runMs).toBeUndefined();
    expect(result.compilerOutput).toContain("main.cpp:3:7: error:");
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ file: "main.cpp", line: 3, column: 7, source: "compiler" });
    expect(errors[0].message).toMatch(/cannot initialize a variable of type 'int'/);
  });

  it("keeps compiler warnings as diagnostics when the program still runs", async () => {
    const result = await run({ "main.cpp": "int main() {\n  int unused = 4;\n  return 0;\n}\n" });
    expect(result.status).toBe("success");
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ severity: "warning", file: "main.cpp", line: 2, column: 7, source: "compiler" }),
    ]);
    expect(result.compilerOutput).toContain("unused variable 'unused'");
  });

  it("reports a runtime crash with its signal and keeps the output printed before it", async () => {
    const result = await run({
      "main.cpp": `#include <iostream>
int main() {
  std::cout << "before the crash" << std::endl;
  volatile int* nowhere = nullptr;
  *nowhere = 1;
  std::cout << "never printed" << std::endl;
}
`,
    });
    expect(result).toMatchObject({ status: "error", phase: "run", stdout: "before the crash\n", signal: "SIGSEGV" });
    expect(result.exitCode).toBeUndefined();
    expect(result.diagnostics).toContainEqual({
      severity: "error",
      message: "The program was terminated by SIGSEGV",
      source: "runtime",
    });
  });

  it("reports a non-zero exit code and an uncaught exception", async () => {
    const exited = await run({ "main.cpp": '#include <iostream>\nint main() { std::cerr << "bad input" << std::endl; return 3; }\n' });
    expect(exited).toMatchObject({ status: "error", phase: "run", exitCode: 3, stderr: "bad input\n", stdout: "" });
    expect(exited.signal).toBeUndefined();

    const threw = await run({ "main.cpp": '#include <stdexcept>\nint main() { throw std::runtime_error("boom"); }\n' });
    expect(threw).toMatchObject({ status: "error", phase: "run", signal: "SIGABRT" });
    expect(threw.stderr).toContain("boom");
  });

  it("builds a multi-file program with a header in a subdirectory", async () => {
    const result = await run({
      "main.cpp": '#include <iostream>\n#include "shapes/area.h"\nint main() { std::cout << rectangleArea(6, 7) << std::endl; }\n',
      "shapes/area.h": "#pragma once\nint rectangleArea(int width, int height);\n",
      "shapes/area.cpp": '#include "area.h"\nint rectangleArea(int width, int height) { return width * height; }\n',
    });
    expect(result).toMatchObject({ status: "success", stdout: "42\n", diagnostics: [] });
  });

  it("names the right file for an error in a second source file, and reports linker errors", async () => {
    const wrongFile = await run({
      "main.cpp": '#include "shapes/area.h"\nint main() { return rectangleArea(1, 2); }\n',
      "shapes/area.h": "#pragma once\nint rectangleArea(int width, int height);\n",
      "shapes/area.cpp": '#include "area.h"\nint rectangleArea(int width, int height) { return width * missing; }\n',
    });
    expect(wrongFile).toMatchObject({ status: "error", phase: "compile" });
    expect(wrongFile.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "error", file: "shapes/area.cpp", line: 2, column: 59 }),
    );

    const unlinked = await run({ "main.cpp": "int rectangleArea(int, int);\nint main() { return rectangleArea(1, 2); }\n" });
    expect(unlinked).toMatchObject({ status: "error", phase: "compile", stdout: "" });
    expect(unlinked.compilerOutput).toMatch(/rectangleArea/);
    // Neither result tells the learner where on the runner's disk the job lived.
    for (const output of [wrongFile.compilerOutput, unlinked.compilerOutput]) {
      expect(output).not.toContain(workRoot);
      expect(output).not.toContain("ytl-job-");
    }
    expect(unlinked.diagnostics.some((diagnostic) => diagnostic.severity === "error" && diagnostic.file === undefined)).toBe(true);
  });

  it("passes stdin to the program", async () => {
    const result = await run(
      {
        "main.cpp": `#include <iostream>
#include <string>
int main() {
  std::string name; int a = 0, b = 0;
  std::getline(std::cin, name);
  std::cin >> a >> b;
  std::cout << "Hi " << name << ", " << a + b << std::endl;
}
`,
      },
      { stdin: "سارة Sara\n19 23\n" },
    );
    expect(result).toMatchObject({ status: "success", stdout: "Hi سارة Sara, 42\n" });
  });

  it("gives two concurrent jobs with the same file names separate workspaces", async () => {
    const program = (word: string) => ({
      "main.cpp": `#include <fstream>\n#include <iostream>\n#include <thread>\n#include <chrono>\nint main() {\n  { std::ofstream out("note.txt"); out << "${word}"; }\n  std::this_thread::sleep_for(std::chrono::milliseconds(300));\n  std::ifstream in("note.txt"); std::string text; in >> text; std::cout << text << std::endl;\n}\n`,
    });
    const [first, second] = await Promise.all([run(program("alpha")), run(program("beta"))]);
    expect(first).toMatchObject({ status: "success", stdout: "alpha\n" });
    expect(second).toMatchObject({ status: "success", stdout: "beta\n" });
    expect(first.executionId).not.toBe(second.executionId);
  });
});

describe.skipIf(!host.ok)(host.ok ? "runner: limits" : host.skipMessage, { timeout: 60_000 }, () => {
  it("stops an infinite loop at the time limit", async () => {
    const strict = await Runner.create({ ...TEST_CONFIG, workRoot, runWallMs: 2_000, cpuSeconds: 1 });
    const busy = await run({ "main.cpp": "int main() { volatile unsigned long n = 0; for (;;) n = n + 1; }\n" }, {}, strict);
    expect(busy).toMatchObject({ status: "timeout", phase: "run" });
    expect(busy.runMs).toBeLessThan(10_000);

    // No CPU use at all: only the wall clock can stop this one.
    const idle = await run({ "main.cpp": SLEEPER }, {}, strict);
    expect(idle).toMatchObject({ status: "timeout", phase: "run" });
    expect(idle.runMs).toBeGreaterThanOrEqual(1_900);
    expect(idle.runMs).toBeLessThan(10_000);
    expect(idle.stdout).not.toContain("woke up");
    expect(isAlive(Number(idle.stdout))).toBe(false);
    await strict.close();
  });

  it("stops a program that prints without end and marks the output as truncated", async () => {
    const result = await run({ "main.cpp": '#include <iostream>\nint main() { for (;;) std::cout << "spam spam spam spam\\n"; }\n' });
    expect(result).toMatchObject({ status: "output_limit", phase: "run", stdoutTruncated: true, stderrTruncated: false });
    expect(Buffer.byteLength(result.stdout)).toBe(64 * KIB);
    // Well before the 15 s time limit: the cap stopped it, not the clock.
    expect(result.runMs).toBeLessThan(10_000);
  });

  it("stops a program whose memory passes the watchdog threshold", async () => {
    const result = await run({
      "main.cpp": `#include <cstring>
#include <cstdlib>
#include <thread>
#include <chrono>
int main() {
  // 16 MiB every 40 ms, touched so it is resident; would reach 1.6 GiB if nothing stopped it.
  for (int i = 0; i < 100; i++) {
    char* block = static_cast<char*>(std::malloc(16 * 1024 * 1024));
    std::memset(block, 1, 16 * 1024 * 1024);
    std::this_thread::sleep_for(std::chrono::milliseconds(40));
  }
}
`,
    });
    expect(result).toMatchObject({ status: "memory_limit", phase: "run" });
  });

  it("stops a program that writes a file larger than the file-size limit", async () => {
    const result = await run({
      "main.cpp": `#include <cstdio>
int main() {
  std::FILE* file = std::fopen("big.bin", "wb");
  static char block[65536];
  for (int i = 0; i < 1024; i++) std::fwrite(block, 1, sizeof block, file);
  std::fclose(file);
  std::puts("wrote 64 MiB");
}
`,
    });
    expect(result).toMatchObject({ status: "error", phase: "run", signal: "SIGXFSZ" });
    expect(result.stdout).toBe("");
  });

  it("bounds the queue: extra jobs wait, and a full queue refuses new ones", async () => {
    const small = await Runner.create({ ...TEST_CONFIG, workRoot, maxConcurrent: 1, maxQueued: 1, runWallMs: 30_000 });
    const first = small.submit(request({ "main.cpp": SLEEPER }));
    const second = small.submit(request({ "main.cpp": HELLO }));
    expect(second.status).toBe("queued");
    expect(small.health().queue).toMatchObject({ running: 1, queued: 1 });
    expectInvalid(() => small.submit(request({ "main.cpp": HELLO })), "queue_full");

    // Stopping a queued job: it never starts.
    expect(small.cancel(second.executionId)?.status).toBe("cancelled");
    expect(await small.wait(second.executionId)).toMatchObject({ status: "cancelled", phase: null, stdout: "" });

    // The queue has room again; the next job runs as soon as the first one is stopped.
    const third = small.submit(request({ "main.cpp": HELLO }));
    expect(third.status).toBe("queued");
    await waitForStatus(small, first.executionId, "running");
    small.cancel(first.executionId);
    expect(await small.wait(third.executionId)).toMatchObject({ status: "success", stdout: "Hello, lab!\n" });
    await small.close();
  });
});

describe.skipIf(!host.ok)(host.ok ? "runner: stop" : host.skipMessage, { timeout: 60_000 }, () => {
  it("cancels a running job, kills its process, and runs a fresh job afterwards", async () => {
    const job = runner.submit(request({ "main.cpp": SLEEPER }));
    await waitForReadyFile();
    expect(runner.get(job.executionId)?.status).toBe("running");

    const cancelledAt = Date.now();
    runner.cancel(job.executionId);
    const result = await runner.wait(job.executionId);
    expect(Date.now() - cancelledAt).toBeLessThan(10_000);
    expect(result).toMatchObject({ status: "cancelled", phase: "run" });
    const pid = Number(result.stdout);
    expect(pid).toBeGreaterThan(1);
    expect(isAlive(pid)).toBe(false);
    expect(result.stdout).not.toContain("woke up");
    expect(runner.get(job.executionId)?.status).toBe("cancelled");
    expect(runner.cancel("00000000-0000-4000-8000-000000000000")).toBeUndefined();

    const fresh = await run({ "main.cpp": HELLO });
    expect(fresh).toMatchObject({ status: "success", stdout: "Hello, lab!\n" });
  });

  it("cancels a job while it is compiling", async () => {
    // Recursive template instantiation keeps the compiler busy for a long time.
    const slow = `template <int N> struct Fib { static const long value = Fib<N - 1>::value + Fib<N - 2>::value; };
template <> struct Fib<0> { static const long value = 0; };
template <> struct Fib<1> { static const long value = 1; };
${Array.from({ length: 400 }, (_, i) => `template <int N> struct Wrap${i} { static const long value = Fib<N + ${i}>::value; };`).join("\n")}
#include <iostream>
#include <regex>
#include <map>
#include <algorithm>
int main() { std::cout << Fib<80>::value << std::endl; }
`;
    const job = runner.submit(request({ "main.cpp": slow }));
    await waitForStatus(runner, job.executionId, "compiling");
    runner.cancel(job.executionId);
    const result = await runner.wait(job.executionId);
    expect(result).toMatchObject({ status: "cancelled", phase: "compile", stdout: "" });
  });

  it("kills the whole process group, including a child the program started", async () => {
    // fork is denied inside the sandbox, so this check runs with the sandbox switched off.
    const open = await Runner.create({ ...TEST_CONFIG, workRoot, sandbox: "off", runWallMs: 30_000 });
    const job = open.submit(
      request({
        "main.cpp": `#include <iostream>
#include <fstream>
#include <unistd.h>
int main() {
  pid_t child = fork();
  if (child == 0) { sleep(120); return 0; }
  std::cout << getpid() << " " << child << std::endl;
  { std::ofstream ready("ready.txt"); }
  sleep(120);
}
`,
      }),
    );
    await waitForReadyFile();
    open.cancel(job.executionId);
    const result = await open.wait(job.executionId);
    expect(result.status).toBe("cancelled");
    const [parent, child] = result.stdout.trim().split(" ").map(Number);
    expect(parent).toBeGreaterThan(1);
    expect(child).toBeGreaterThan(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(isAlive(parent)).toBe(false);
    expect(isAlive(child)).toBe(false);
    await open.close();
  });

  it("close() stops every job", async () => {
    const closing = await Runner.create({ ...TEST_CONFIG, workRoot, maxConcurrent: 1, runWallMs: 30_000 });
    const active = closing.submit(request({ "main.cpp": SLEEPER }));
    const waiting = closing.submit(request({ "main.cpp": SLEEPER }));
    await waitForStatus(closing, active.executionId, "running");
    await closing.close();
    expect(closing.get(active.executionId)?.status).toBe("cancelled");
    expect(closing.get(waiting.executionId)?.status).toBe("cancelled");
    expectInvalid(() => closing.submit(request({ "main.cpp": HELLO })), "queue_full");
  });
});

describe.skipIf(!host.ok)(host.ok ? "runner: isolation" : host.skipMessage, { timeout: 60_000 }, () => {
  it("rejects path traversal and other unsafe file names before anything is written", () => {
    const unsafe = [
      "../evil.cpp",
      "../../etc/passwd",
      "/etc/passwd",
      "/tmp/evil.cpp",
      "src/../../evil.cpp",
      "a/./b.cpp",
      "a//b.cpp",
      "a/",
      "..",
      ".",
      "",
      "..\\evil.cpp",
      "C:\\evil.cpp",
      "evil\0.cpp",
      ".hidden.cpp",
      "-o",
      "-Wl,-rpath.cpp",
      "sub/-include.cpp",
      "name with space.cpp",
      "~/evil.cpp",
      "$(touch evil).cpp",
      "a;b.cpp",
      "ملف.cpp",
      "a/b/c/d/e/f/g.cpp",
      "x".repeat(201),
    ];
    for (const name of unsafe) {
      expectInvalid(() => runner.submit(request({ "main.cpp": HELLO, [name]: "int x;" })));
      expectInvalid(() => normalizeFilePath(name));
    }
    expectInvalid(() => runner.submit(request({ "main.cpp": HELLO, "Main.cpp": HELLO })));
    expectInvalid(() => runner.submit(request({ "util": "x", "util/a.cpp": HELLO })));
    expect(normalizeFilePath("include/shapes/area_v2.test-1.h")).toBe("include/shapes/area_v2.test-1.h");

    // The runner's copy of the rule and the shared one in @ytl/contracts accept exactly the same names.
    expect(SEGMENT_PATTERN.source).toBe(CODE_FILE_NAME_SEGMENT.source);
    expect(SEGMENT_PATTERN.flags).toBe(CODE_FILE_NAME_SEGMENT.flags);
    expect([MAX_DEPTH, MAX_PATH_LENGTH]).toEqual([CODE_FILE_NAME_MAX_DEPTH, CODE_FILE_NAME_MAX_LENGTH]);
    const accepted = ["main.cpp", "Main.java", "_x.h", "a/b/c/d/e/f.cpp", "include/shapes/area_v2.test-1.h", "x".repeat(200)];
    for (const name of [...unsafe, ...accepted]) {
      let runnerAccepts = true;
      try {
        normalizeFilePath(name);
      } catch {
        runnerAccepts = false;
      }
      expect([name, runnerAccepts]).toEqual([name, isValidCodeFileName(name)]);
    }
  });

  it("rejects malformed requests", () => {
    expectInvalid(() => runner.submit(request({ "main.cpp": HELLO }, { track: "python" })));
    expectInvalid(() => runner.submit(request({ "notes.txt": "no source" })));
    expectInvalid(() => runner.submit(request({})));
    expectInvalid(() => runner.submit(request({ "main.cpp": HELLO }, { revision: 0 })));
    expectInvalid(() => runner.submit(request({ "main.cpp": HELLO }, { stdin: "x".repeat(300 * KIB) })));
    expectInvalid(() => runner.submit(request({ "main.cpp": `// ${"x".repeat(2 * MIB)}` })));
    expectInvalid(() => runner.submit(request(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`f${i}.cpp`, "int x;"])))));
    expectInvalid(() => runner.submit(null));
    expectInvalid(() => runner.submit({ ...request({ "main.cpp": HELLO }), files: [{ name: "main.cpp" }] }));
  });

  it("gives the program a scrubbed environment with no platform secret", async () => {
    const secrets = {
      DATABASE_URL: "postgresql://ytl_app:super-secret-db@localhost:5432/yourtechlab",
      TEST_DATABASE_URL: "postgresql://ytl_app:super-secret-test@localhost:5432/yourtechlab_test",
      AI_API_KEY: "sk-super-secret-ai",
      RUNNER_TOKEN: "super-secret-runner-token",
    };
    const saved = Object.fromEntries(Object.keys(secrets).map((name) => [name, process.env[name]]));
    Object.assign(process.env, secrets);
    try {
      const result = await run({
        "main.cpp": `#include <iostream>
extern char** environ;
int main() { for (char** entry = environ; *entry; entry++) std::cout << *entry << std::endl; }
`,
      });
      expect(result.status).toBe("success");
      expect(result.stdout).not.toContain("super-secret");
      const names = result.stdout.trim().split("\n").map((line) => line.split("=")[0]);
      for (const name of Object.keys(secrets)) expect(names).not.toContain(name);
      // Only what the runner sets, plus the three variables /bin/sh adds by itself.
      expect(names.filter((name) => !["PWD", "SHLVL", "_"].includes(name)).sort()).toEqual(["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR"]);
      expect(result.stdout).toContain("PATH=/usr/bin:/bin\n");
      expect(result.stdout).not.toContain(process.env.HOME!);
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("blocks network, child processes, reads of user files and writes outside the workspace", async () => {
    let connections = 0;
    const listener = createServer((socket) => {
      connections++;
      socket.destroy();
    });
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    const port = (listener.address() as { port: number }).port;
    // A real file of this project, outside any job workspace.
    const projectFile = fileURLToPath(new URL("../package.json", import.meta.url));
    const outsideFile = join(workRoot, "escaped.txt");

    try {
      const result = await run(
        {
          "main.cpp": `#include <iostream>
#include <fstream>
#include <string>
#include <thread>
#include <unistd.h>
#include <signal.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
int main() {
  int port; pid_t runnerPid; std::string projectFile, outsideFile;
  std::cin >> port >> runnerPid >> projectFile >> outsideFile;
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  sockaddr_in address{}; address.sin_family = AF_INET; address.sin_port = htons(port);
  inet_pton(AF_INET, "127.0.0.1", &address.sin_addr);
  std::cout << "network=" << (fd >= 0 && connect(fd, (sockaddr*)&address, sizeof address) == 0 ? "allowed" : "denied") << std::endl;
  pid_t child = fork();
  if (child == 0) _exit(0);
  std::cout << "fork=" << (child > 0 ? "allowed" : "denied") << std::endl;
  std::cout << "read-project=" << (std::ifstream(projectFile).good() ? "allowed" : "denied") << std::endl;
  std::cout << "write-outside=" << (std::ofstream(outsideFile).good() ? "allowed" : "denied") << std::endl;
  std::cout << "write-inside=" << (std::ofstream("scratch.txt").good() ? "allowed" : "denied") << std::endl;
  std::cout << "read-system-accounts=" << (std::ifstream("/etc/passwd").good() ? "allowed" : "denied") << std::endl;
  std::cout << "signal-other=" << (kill(runnerPid, 0) == 0 ? "allowed" : "denied") << std::endl;
  std::thread worker([] { std::cout << "thread=ok" << std::endl; });
  worker.join();
  // Replacing itself with another program (no fork needed) must fail too.
  execl("/bin/echo", "echo", "exec=allowed", (char*)nullptr);
  std::cout << "exec=denied" << std::endl;
}
`,
        },
        { stdin: `${port}\n${process.pid}\n${projectFile}\n${outsideFile}\n` },
      );
      expect(result.status).toBe("success");
      expect(result.stdout.trim().split("\n")).toEqual([
        "network=denied",
        "fork=denied",
        "read-project=denied",
        "write-outside=denied",
        "write-inside=allowed",
        "read-system-accounts=denied",
        "signal-other=denied",
        "thread=ok",
        "exec=denied",
      ]);
      expect(connections).toBe(0);
    } finally {
      await new Promise((resolve) => listener.close(resolve));
    }
  });

  it("does not let the compiler read a file outside the workspace", async () => {
    const projectFile = fileURLToPath(new URL("../package.json", import.meta.url));
    const result = await run({ "main.cpp": `#include "${projectFile}"\nint main() {}\n` });
    expect(result).toMatchObject({ status: "error", phase: "compile" });
    expect(result.compilerOutput).toMatch(/Operation not permitted/);
    expect(result.compilerOutput).not.toContain("@ytl/runner");
  });
});

describe("clang diagnostics parser", () => {
  it("parses errors, warnings, notes and linker lines, and ignores source excerpts", () => {
    const output = [
      "main.cpp:3:7: error: cannot initialize a variable of type 'int' with an lvalue of type 'const char[6]'",
      '    3 |   int count = "three";',
      "      |       ^       ~~~~~~~",
      "./shapes/area.cpp:10:3: warning: unused variable 'x' [-Wunused-variable]",
      "shapes/area.h:2:5: note: candidate function not viable",
      "main.cpp:1:10: fatal error: 'missing.h' file not found",
      'Undefined symbols for architecture arm64:',
      '  "rectangleArea(int, int)", referenced from:',
      "ld: symbol(s) not found for architecture arm64",
      "clang++: error: linker command failed with exit code 1 (use -v to see invocation)",
      "1 warning and 2 errors generated.",
    ].join("\n");
    expect(parseClangDiagnostics(output)).toEqual([
      { severity: "error", message: "cannot initialize a variable of type 'int' with an lvalue of type 'const char[6]'", file: "main.cpp", line: 3, column: 7, source: "compiler" },
      { severity: "warning", message: "unused variable 'x' [-Wunused-variable]", file: "shapes/area.cpp", line: 10, column: 3, source: "compiler" },
      { severity: "info", message: "candidate function not viable", file: "shapes/area.h", line: 2, column: 5, source: "compiler" },
      { severity: "error", message: "'missing.h' file not found", file: "main.cpp", line: 1, column: 10, source: "compiler" },
      { severity: "error", message: "symbol(s) not found for architecture arm64", source: "compiler" },
      { severity: "error", message: "linker command failed with exit code 1 (use -v to see invocation)", source: "compiler" },
    ]);
    expect(parseClangDiagnostics("")).toEqual([]);
  });
});
