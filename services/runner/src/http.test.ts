// The HTTP API over a real listening socket and the real compiler.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { request as httpRequest, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HealthReport, JobSnapshot } from "./contract.ts";
import { CppAdapter } from "./adapters/cpp.ts";
import { CsharpAdapter } from "./adapters/csharp.ts";
import { JavaAdapter } from "./adapters/java.ts";
import { createRunnerServer } from "./http.ts";
import { Runner } from "./runner.ts";
import { detectTestHost } from "./test-host.ts";

const host = await detectTestHost();

const TOKEN = "test-token";

let workRoot: string;
let runner: Runner;
let server: Server;
let port: number;

interface Reply<T> {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: T;
}

/** node:http instead of fetch, so the Host and Origin headers can be set freely. */
function call<T = any>(
  method: string,
  path: string,
  options: { body?: unknown; rawBody?: string; headers?: Record<string, string>; token?: string | null } = {},
): Promise<Reply<T>> {
  return new Promise((resolve, reject) => {
    const payload = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const headers: Record<string, string> = { ...options.headers };
    if (payload !== undefined && headers["content-type"] === undefined) headers["content-type"] = "application/json";
    if (options.token !== null) headers.authorization = `Bearer ${options.token ?? TOKEN}`;
    const outgoing = httpRequest({ host: "127.0.0.1", port, method, path, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: text ? JSON.parse(text) : undefined });
      });
    });
    outgoing.on("error", reject);
    outgoing.end(payload);
  });
}

function job(source: string, extra: Record<string, unknown> = {}) {
  return {
    projectId: "project-http",
    revision: 3,
    track: "cpp",
    files: [{ id: "f0", name: "main.cpp", language: "cpp", content: source, order: 0 }],
    ...extra,
  };
}

const HELLO = '#include <iostream>\nint main() { std::string name; std::cin >> name; std::cout << "Hello, " << name << "!" << std::endl; }\n';
const SLEEPER = "#include <unistd.h>\nint main() { sleep(120); }\n";

beforeAll(async () => {
  workRoot = await mkdtemp(join(tmpdir(), "ytl-runner-http-"));
  // Java is pointed at a path that holds nothing, so the "toolchain not installed" answers are
  // tested the same way on every machine; real Java and C# runs are in managed.test.ts.
  runner = await Runner.create(
    { workRoot, runWallMs: 30_000 },
    {
      adapters: [
        new CppAdapter(),
        new JavaAdapter({ javaHome: "/nonexistent/jdk", heapBytes: 256 * 1024 * 1024, searchPath: "/nonexistent/bin" }),
        new CsharpAdapter({ dotnetRoot: "/nonexistent/dotnet", heapBytes: 256 * 1024 * 1024, searchPath: "/nonexistent/bin" }),
      ],
    },
  );
  server = createRunnerServer(runner, { token: TOKEN });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await runner.close();
  expect(await readdir(workRoot)).toEqual([]);
  await rm(workRoot, { recursive: true, force: true });
});

describe.skipIf(!host.ok)(host.ok ? "runner HTTP API" : host.skipMessage, { timeout: 60_000 }, () => {
  it("GET /health reports which toolchains are available", async () => {
    const reply = await call<HealthReport>("GET", "/health", { token: null });
    expect(reply.status).toBe(200);
    expect(reply.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(reply.headers["access-control-allow-origin"]).toBeUndefined();
    expect(reply.body.status).toBe("ok");
    expect(reply.body.toolchains.cpp.available).toBe(true);
    expect(reply.body.toolchains.java).toMatchObject({ available: false, reason: "toolchain_not_installed" });
    expect(reply.body.toolchains.csharp).toMatchObject({ available: false, reason: "toolchain_not_installed" });
    expect(reply.body.sandbox).toMatchObject({ available: true, required: true });
    expect(reply.body.limits.runWallMs).toBe(30_000);
  });

  it("POST /jobs then GET /jobs/:id?wait=1 returns the finished result", async () => {
    const submitted = await call<JobSnapshot>("POST", "/jobs", { body: job(HELLO, { stdin: "Layla\n" }) });
    expect(submitted.status).toBe(202);
    expect(submitted.body).toMatchObject({ projectId: "project-http", revision: 3, track: "cpp" });
    expect(["queued", "compiling"]).toContain(submitted.body.status);
    expect(submitted.body.result).toBeUndefined();

    const finished = await call<JobSnapshot>("GET", `/jobs/${submitted.body.executionId}?wait=1`);
    expect(finished.status).toBe(200);
    expect(finished.body.status).toBe("success");
    expect(finished.body.result).toMatchObject({
      executionId: submitted.body.executionId,
      status: "success",
      phase: "run",
      stdout: "Hello, Layla!\n",
      exitCode: 0,
    });
    // Polling without wait gives the same stored result.
    expect((await call<JobSnapshot>("GET", `/jobs/${submitted.body.executionId}`)).body).toEqual(finished.body);
  });

  it("returns a compile error as a normal finished job", async () => {
    const submitted = await call<JobSnapshot>("POST", "/jobs", { body: job("int main() { return missing; }\n") });
    const finished = await call<JobSnapshot>("GET", `/jobs/${submitted.body.executionId}?wait=1`);
    expect(finished.body.result).toMatchObject({ status: "error", phase: "compile", stdout: "" });
    expect(finished.body.result?.diagnostics[0]).toMatchObject({ severity: "error", file: "main.cpp", line: 1, column: 21 });
  });

  it("DELETE /jobs/:id stops a running job and a fresh job runs afterwards", async () => {
    const submitted = await call<JobSnapshot>("POST", "/jobs", { body: job(SLEEPER) });
    const id = submitted.body.executionId;
    while ((await call<JobSnapshot>("GET", `/jobs/${id}`)).body.status !== "running") {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const stopped = await call<JobSnapshot>("DELETE", `/jobs/${id}`);
    expect(stopped.status).toBe(200);
    expect(stopped.body.result).toMatchObject({ status: "cancelled", phase: "run" });

    const next = await call<JobSnapshot>("POST", "/jobs", { body: job(HELLO, { stdin: "again" }) });
    const finished = await call<JobSnapshot>("GET", `/jobs/${next.body.executionId}?wait=1`);
    expect(finished.body.result).toMatchObject({ status: "success", stdout: "Hello, again!\n" });
  });

  it("answers a Java job with runner_unavailable instead of output", async () => {
    const submitted = await call<JobSnapshot>("POST", "/jobs", {
      body: { ...job("class Main {}"), track: "java", files: [{ id: "f0", name: "Main.java", language: "java", content: "class Main {}", order: 0 }] },
    });
    expect(submitted.status).toBe(202);
    expect(submitted.body.result).toMatchObject({ status: "runner_unavailable", unavailableReason: "toolchain_not_installed", stdout: "" });
  });

  it("rejects path traversal with 400 invalid_request", async () => {
    const body = job(HELLO);
    body.files.push({ id: "f1", name: "../../outside.cpp", language: "cpp", content: "int x;", order: 1 });
    const reply = await call("POST", "/jobs", { body });
    expect(reply.status).toBe(400);
    expect(reply.body.error.code).toBe("invalid_request");
  });

  it("requires the bearer token for jobs", async () => {
    expect((await call("POST", "/jobs", { body: job(HELLO), token: null })).status).toBe(401);
    expect((await call("POST", "/jobs", { body: job(HELLO), token: "wrong-token" })).status).toBe(401);
    expect((await call("GET", "/jobs/00000000-0000-4000-8000-000000000000", { token: null })).status).toBe(401);
  });

  it("refuses browser origins and foreign Host headers", async () => {
    const fromPage = await call("POST", "/jobs", { body: job(HELLO), headers: { origin: "http://localhost:3000" } });
    expect(fromPage.status).toBe(403);
    expect(fromPage.body.error.code).toBe("forbidden_origin");

    const rebound = await call("GET", "/health", { headers: { host: "attacker.example:4000" } });
    expect(rebound.status).toBe(403);
    expect(rebound.body.error.code).toBe("forbidden_host");
  });

  it("answers malformed requests with the right status", async () => {
    expect((await call("GET", "/jobs/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await call("DELETE", "/jobs/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await call("GET", "/nothing")).status).toBe(404);
    expect((await call("GET", "/jobs")).status).toBe(405);
    expect((await call("POST", "/health")).status).toBe(405);
    expect((await call("POST", "/jobs", { rawBody: "{not json" })).status).toBe(400);
    expect((await call("POST", "/jobs", { rawBody: "{}", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await call("POST", "/jobs", { body: { ...job(HELLO), track: "python" } })).status).toBe(400);
  });
});

describe.skipIf(!host.ok)(host.ok ? "runner HTTP API limits" : host.skipMessage, { timeout: 60_000 }, () => {
  it("answers 429 queue_full when the queue is full, and 413 for an oversized body", async () => {
    const small = await Runner.create({ workRoot, maxConcurrent: 1, maxQueued: 1, runWallMs: 30_000 });
    const smallServer = createRunnerServer(small, { maxBodyBytes: 4096 });
    await new Promise<void>((resolve) => smallServer.listen(0, "127.0.0.1", resolve));
    const mainPort = port;
    port = (smallServer.address() as { port: number }).port;
    try {
      expect((await call("POST", "/jobs", { body: job(SLEEPER), token: null })).status).toBe(202);
      expect((await call("POST", "/jobs", { body: job(SLEEPER), token: null })).status).toBe(202);
      const refused = await call("POST", "/jobs", { body: job(SLEEPER), token: null });
      expect(refused.status).toBe(429);
      expect(refused.body.error.code).toBe("queue_full");

      const oversized = await call("POST", "/jobs", { body: job(`// ${"x".repeat(8192)}`), token: null }).catch(() => ({ status: 413 }));
      expect(oversized.status).toBe(413);
    } finally {
      port = mainPort;
      await new Promise((resolve) => smallServer.close(resolve));
      await small.close();
    }
  });
});
