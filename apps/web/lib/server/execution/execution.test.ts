// The execution API's route handlers, called with real Request objects, against a real runner
// process (services/runner/src/main.ts on a free port) that compiles and runs real programs.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isValidCodeFileName, type JobSnapshot } from "@ytl/contracts";
import { createRunnerClient } from "./runner-client";
import { createExecutionService, getExecutionService, withExecutionService, type ExecutionHealth, type ExecutionService } from "./service";
import { SESSION_COOKIE, createSession, isUsableSecret, readSession } from "./session";
import { validateExecutionRequest } from "./validate";

const RUNNER_ENTRY = fileURLToPath(new URL("../../../../../services/runner/src/main.ts", import.meta.url));
const RUNNER_TOKEN = "runner-token-that-must-never-reach-a-browser";
const SESSION_SECRET = "session-secret-for-tests-0123456789abcdef";
const SITE = "http://localhost:3000";

interface RunnerProcess {
  url: string;
  workRoot: string;
  stop(): Promise<void>;
}

/** Starts the runner as its own process, as in production, and waits for the port it reports. */
async function startRunner(): Promise<RunnerProcess> {
  const workRoot = await mkdtemp(join(tmpdir(), "ytl-execution-test-"));
  const child: ChildProcess = spawn(process.execPath, [RUNNER_ENTRY], {
    // Only what the runner needs; in particular not this process's DATABASE_URL.
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      RUNNER_PORT: "0",
      RUNNER_TOKEN,
      RUNNER_WORK_ROOT: workRoot,
      ...(process.env.RUNNER_JAVA_HOME ? { RUNNER_JAVA_HOME: process.env.RUNNER_JAVA_HOME } : {}),
      ...(process.env.RUNNER_DOTNET_ROOT ? { RUNNER_DOTNET_ROOT: process.env.RUNNER_DOTNET_ROOT } : {}),
    } as unknown as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const url = await new Promise<string>((resolve, reject) => {
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) resolve(match[1]);
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.once("exit", (code) => reject(new Error(`the runner exited with code ${code} before listening:\n${output}`)));
    setTimeout(() => reject(new Error(`the runner did not start within 20 s:\n${output}`)), 20_000).unref();
  });
  return {
    url,
    workRoot,
    async stop() {
      // SIGTERM: the runner kills its jobs and removes their workspaces before exiting.
      child.kill("SIGTERM");
      await exited;
      expect(await readdir(workRoot)).toEqual([]);
      await rm(workRoot, { recursive: true, force: true });
    },
  };
}

function request(
  method: string,
  path: string,
  options: { body?: unknown; rawBody?: string; cookie?: string; origin?: string | null; headers?: Record<string, string> } = {},
): Request {
  const headers: Record<string, string> = { ...options.headers };
  // A browser sends Origin on POST and DELETE from the site's own pages.
  if (options.origin !== null && method !== "GET") headers.origin = options.origin ?? SITE;
  if (options.cookie) headers.cookie = options.cookie;
  const body = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (body !== undefined && headers["content-type"] === undefined) headers["content-type"] = "application/json";
  return new Request(`${SITE}${path}`, { method, headers, body });
}

function program(source: string, extra: Record<string, unknown> = {}) {
  return {
    projectId: "project-api",
    revision: 4,
    track: "cpp",
    files: [{ id: "f0", name: "main.cpp", language: "cpp", content: source, order: 0 }],
    ...extra,
  };
}

const JAVA_JOB = program("class Main {}", { track: "java", files: [{ id: "f0", name: "Main.java", language: "java", content: "class Main {}", order: 0 }] });
const JAVA_HELLO_JOB = program("", {
  track: "java",
  files: [{ id: "f0", name: "Main.java", language: "java", content: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello from Java");\n    }\n}\n', order: 0 }],
});
const HELLO = '#include <iostream>\nint main() { std::string name; std::cin >> name; std::cout << "Hello, " << name << "!" << std::endl; }\n';
const SLEEPER = "#include <unistd.h>\nint main() { sleep(120); }\n";

/** The `name=value` part of a Set-Cookie header, as a browser would send it back. */
function cookieFrom(response: Response): string {
  const header = response.headers.get("set-cookie");
  if (!header) throw new Error("the response set no cookie");
  return header.split(";")[0];
}

function expectNoSecrets(text: string, runnerUrl: string): void {
  expect(text).not.toContain(RUNNER_TOKEN);
  expect(text).not.toContain(SESSION_SECRET);
  expect(text).not.toContain(runnerUrl);
}

const runner = await startRunner();
const runnerHealth = await createRunnerClient({ url: runner.url, token: RUNNER_TOKEN, timeoutMs: 5_000 }).health();
const canRunCpp = runnerHealth.toolchains.cpp.available;
const SKIP_MESSAGE = `SKIPPED: execution API tests that run C++ did not run: ${runnerHealth.toolchains.cpp.reason} (${runnerHealth.toolchains.cpp.detail}).`;
if (!canRunCpp) process.stderr.write(`\n${SKIP_MESSAGE}\n`);

function service(overrides: Partial<Parameters<typeof createExecutionService>[0]> = {}): ExecutionService {
  return createExecutionService({
    runner: createRunnerClient({ url: runner.url, token: RUNNER_TOKEN, timeoutMs: 5_000 }),
    sessionSecret: SESSION_SECRET,
    appOrigin: SITE,
    rateLimit: { max: 100, windowMs: 60_000 },
    maxActiveJobsPerSession: 4,
    longPollMs: 25_000,
    ...overrides,
  });
}

async function waitUntil(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("condition was not met within 20 s");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

afterAll(async () => {
  await runner.stop();
});

describe.skipIf(!canRunCpp)(canRunCpp ? "execution API routes" : SKIP_MESSAGE, { timeout: 60_000 }, () => {
  // The real route modules, configured from the environment as in the application.
  let POST: (request: Request) => Promise<Response>;
  let GET: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
  let DELETE: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
  let HEALTH: () => Promise<Response>;
  const savedEnv = { ...process.env };

  const submit = (body: unknown, cookie?: string) => POST(request("POST", "/api/execute", { body, cookie }));
  const fetchJob = (id: string, cookie?: string, wait = true) =>
    GET(request("GET", `/api/execute/${id}${wait ? "?wait=1" : ""}`, { cookie }), { params: Promise.resolve({ id }) });
  const stopJob = (id: string, cookie?: string, origin?: string | null) =>
    DELETE(request("DELETE", `/api/execute/${id}`, { cookie, origin }), { params: Promise.resolve({ id }) });

  beforeAll(async () => {
    Object.assign(process.env, { RUNNER_URL: runner.url, RUNNER_TOKEN, SESSION_SECRET, NEXT_PUBLIC_APP_URL: SITE });
    delete (globalThis as { __ytlExecution?: unknown }).__ytlExecution;
    ({ POST } = await import("@/app/api/execute/route"));
    ({ GET, DELETE } = await import("@/app/api/execute/[id]/route"));
    ({ GET: HEALTH } = await import("@/app/api/execute/health/route"));
  });

  afterAll(() => {
    for (const name of ["RUNNER_URL", "RUNNER_TOKEN", "SESSION_SECRET", "NEXT_PUBLIC_APP_URL"]) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
    delete (globalThis as { __ytlExecution?: unknown }).__ytlExecution;
  });

  it("GET /api/execute/health reports the toolchains without host details or secrets", async () => {
    const response = await HEALTH();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expectNoSecrets(text, runner.url);
    const body = JSON.parse(text) as ExecutionHealth;
    expect(body).toMatchObject({
      reachable: true,
      toolchains: { cpp: { available: true } },
    });
    // Java and C# depend on what the runner host has; the API passes on exactly what the runner found.
    if (body.reachable) {
      for (const track of ["java", "csharp"] as const) {
        expect(body.toolchains[track].available).toBe(runnerHealth.toolchains[track].available);
        expect(body.toolchains[track].reason).toBe(runnerHealth.toolchains[track].reason);
      }
    }
    expect(body.reachable && body.limits.runWallMs).toBe(10_000);
    expect(text).not.toContain("detail");
  });

  it("submits a C++ program and fetches its real result", async () => {
    const submitted = await submit(program(HELLO, { stdin: "Noor\n", extraField: "dropped" }));
    expect(submitted.status).toBe(202);
    const setCookie = submitted.headers.get("set-cookie")!;
    expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE}=v1\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}; `));
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Secure"); // plain http in this test
    const snapshot = (await submitted.json()) as JobSnapshot;
    expect(snapshot).toMatchObject({ projectId: "project-api", revision: 4, track: "cpp" });
    expect(["queued", "compiling", "running"]).toContain(snapshot.status);

    const cookie = cookieFrom(submitted);
    const finished = await fetchJob(snapshot.executionId, cookie);
    expect(finished.status).toBe(200);
    expect(finished.headers.get("set-cookie")).toBeNull();
    const text = await finished.text();
    expectNoSecrets(text, runner.url);
    const body = JSON.parse(text) as JobSnapshot;
    expect(body.result).toMatchObject({
      executionId: snapshot.executionId,
      status: "success",
      phase: "run",
      stdout: "Hello, Noor!\n",
      stderr: "",
      exitCode: 0,
      projectId: "project-api",
      revision: 4,
    });
    // A finished job is answered again without waiting, with the same result.
    expect(await (await fetchJob(snapshot.executionId, cookie, false)).json()).toEqual(body);
  });

  it("passes compiler diagnostics through", async () => {
    const submitted = await submit(program("int main() { return missing; }\n"));
    const { executionId } = (await submitted.json()) as JobSnapshot;
    const body = (await (await fetchJob(executionId, cookieFrom(submitted))).json()) as JobSnapshot;
    expect(body.result).toMatchObject({ status: "error", phase: "compile", stdout: "" });
    expect(body.result?.diagnostics[0]).toMatchObject({ severity: "error", file: "main.cpp", line: 1, column: 21, source: "compiler" });
  });

  it("answers 404 when another session, no session or a forged session asks for a job", async () => {
    const mine = await submit(program(HELLO, { stdin: "owner" }));
    const { executionId } = (await mine.json()) as JobSnapshot;
    const myCookie = cookieFrom(mine);
    const other = await submit(JAVA_JOB);
    const otherCookie = cookieFrom(other);
    expect(otherCookie).not.toBe(myCookie);

    const forged = createSession("a-different-secret-0123456789abcdef-xyz", false).setCookie.split(";")[0];
    const [name, value] = myCookie.split("=");
    const tampered = `${name}=${value.slice(0, -2)}${value.endsWith("AA") ? "BB" : "AA"}`;
    for (const cookie of [otherCookie, undefined, forged, tampered, `${SESSION_COOKIE}=garbage`]) {
      const read = await fetchJob(executionId, cookie);
      expect(read.status).toBe(404);
      expect(await read.json()).toEqual({ error: { code: "not_found", message: "No such execution for this session." } });
      expect((await stopJob(executionId, cookie)).status).toBe(404);
    }
    // Same answer as for an ID that does not exist at all.
    expect((await fetchJob("00000000-0000-4000-8000-000000000000", myCookie)).status).toBe(404);
    expect((await fetchJob("not-an-id", myCookie)).status).toBe(404);

    // The owner was not affected by any of that.
    const body = (await (await fetchJob(executionId, myCookie)).json()) as JobSnapshot;
    expect(body.result).toMatchObject({ status: "success", stdout: "Hello, owner!\n" });
  });

  it("DELETE stops a running program, and a fresh run works afterwards", async () => {
    const submitted = await submit(program(SLEEPER));
    const cookie = cookieFrom(submitted);
    const { executionId } = (await submitted.json()) as JobSnapshot;
    await waitUntil(async () => ((await (await fetchJob(executionId, cookie, false)).json()) as JobSnapshot).status === "running");

    const stopped = await stopJob(executionId, cookie);
    expect(stopped.status).toBe(200);
    expect(((await stopped.json()) as JobSnapshot).result).toMatchObject({ status: "cancelled", phase: "run", stdout: "" });
    expect(((await (await fetchJob(executionId, cookie)).json()) as JobSnapshot).status).toBe("cancelled");
    // Stopping again is harmless.
    expect((await stopJob(executionId, cookie)).status).toBe(200);

    const next = await submit(program(HELLO, { stdin: "again" }), cookie);
    expect(next.headers.get("set-cookie")).toBeNull();
    const body = (await (await fetchJob(((await next.json()) as JobSnapshot).executionId, cookie)).json()) as JobSnapshot;
    expect(body.result).toMatchObject({ status: "success", stdout: "Hello, again!\n" });
  });

  it("runs Java when the runner has a JDK, and otherwise says it is not installed with no output", async () => {
    const submitted = await submit(JAVA_HELLO_JOB);
    expect(submitted.status).toBe(202);
    const { executionId } = (await submitted.json()) as JobSnapshot;
    const body = (await (await fetchJob(executionId, cookieFrom(submitted))).json()) as JobSnapshot;
    if (runnerHealth.toolchains.java.available) {
      expect(body.result).toMatchObject({ status: "success", phase: "run", stdout: "Hello from Java\n", exitCode: 0 });
    } else {
      expect(body.result).toMatchObject({ status: "runner_unavailable", unavailableReason: "toolchain_not_installed", phase: null, stdout: "", stderr: "" });
    }
  });

  it("rejects malformed bodies with 400, 413 or 415 and creates no session for them", async () => {
    const cases: [Request, number, string][] = [
      [request("POST", "/api/execute", { rawBody: "{not json" }), 400, "invalid_request"],
      [request("POST", "/api/execute", { rawBody: "[]" }), 400, "invalid_request"],
      [request("POST", "/api/execute", { rawBody: "{}", headers: { "content-type": "text/plain" } }), 415, "unsupported_media_type"],
      [request("POST", "/api/execute", { rawBody: JSON.stringify(program(HELLO)), headers: { "content-type": "application/x-www-form-urlencoded" } }), 415, "unsupported_media_type"],
      [request("POST", "/api/execute", { body: program(HELLO, { track: "python" }) }), 400, "invalid_request"],
      [request("POST", "/api/execute", { body: program(HELLO, { revision: 0 }) }), 400, "invalid_request"],
      [request("POST", "/api/execute", { body: program(HELLO, { projectId: "" }) }), 400, "invalid_request"],
      [request("POST", "/api/execute", { body: program(HELLO, { files: [] }) }), 400, "invalid_request"],
      [request("POST", "/api/execute", { body: program(HELLO, { stdin: 5 }) }), 400, "invalid_request"],
      [request("POST", "/api/execute", { body: program(HELLO, { files: [{ name: "../../etc/passwd", content: "x" }] }) }), 400, "invalid_request"],
      [request("POST", "/api/execute", { body: program(HELLO, { files: [{ name: "/abs.cpp", content: "x" }] }) }), 400, "invalid_request"],
      [request("POST", "/api/execute", { body: program(HELLO, { files: [{ name: "main.cpp" }] }) }), 400, "invalid_request"],
      [request("POST", "/api/execute", { body: program(`// ${"x".repeat(1024 * 1024)}`) }), 400, "invalid_request"],
      [request("POST", "/api/execute", { rawBody: `{"pad":"${"x".repeat(5 * 1024 * 1024)}"}` }), 413, "payload_too_large"],
      // Valid here, refused by the runner: no C++ source file.
      [request("POST", "/api/execute", { body: program(HELLO, { files: [{ name: "notes.txt", content: "x" }] }) }), 400, "invalid_request"],
    ];
    for (const [malformed, status, code] of cases) {
      const response = await POST(malformed);
      const body = await response.json();
      expect([response.status, body.error?.code]).toEqual([status, code]);
      expect(typeof body.error.message).toBe("string");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("refuses state-changing requests that are not same-origin", async () => {
    for (const origin of ["http://evil.example", "http://localhost:3001", "null", "not a url"]) {
      const response = await POST(request("POST", "/api/execute", { body: program(HELLO), origin }));
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("forbidden_origin");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    // No Origin header at all (not a browser, or a stripped header).
    expect((await POST(request("POST", "/api/execute", { body: program(HELLO), origin: null }))).status).toBe(403);
    // Browsers that omit Origin still label the request.
    const labelled = await POST(request("POST", "/api/execute", { body: JAVA_JOB, origin: null, headers: { "sec-fetch-site": "same-origin" } }));
    expect(labelled.status).toBe(202);
    expect((await POST(request("POST", "/api/execute", { body: JAVA_JOB, origin: null, headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);

    // A cross-site page cannot stop someone's program even with their cookie attached.
    const submitted = await submit(program(SLEEPER));
    const cookie = cookieFrom(submitted);
    const { executionId } = (await submitted.json()) as JobSnapshot;
    expect((await stopJob(executionId, cookie, "http://evil.example")).status).toBe(403);
    expect(["queued", "compiling", "running"]).toContain(((await (await fetchJob(executionId, cookie, false)).json()) as JobSnapshot).status);
    expect(((await (await stopJob(executionId, cookie)).json()) as JobSnapshot).status).toBe("cancelled");
  });
});

describe.skipIf(!canRunCpp)(canRunCpp ? "execution API limits" : SKIP_MESSAGE, { timeout: 60_000 }, () => {
  it("limits submissions per session and says when to retry", async () => {
    let clock = 1_000_000;
    const limited = service({ rateLimit: { max: 3, windowMs: 60_000 }, now: () => clock });
    const first = await limited.submit(request("POST", "/api/execute", { body: JAVA_JOB }));
    const cookie = cookieFrom(first);
    clock += 10_000;
    expect((await limited.submit(request("POST", "/api/execute", { body: JAVA_JOB, cookie }))).status).toBe(202);
    expect((await limited.submit(request("POST", "/api/execute", { body: JAVA_JOB, cookie }))).status).toBe(202);

    const refused = await limited.submit(request("POST", "/api/execute", { body: JAVA_JOB, cookie }));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("50");
    expect((await refused.json()).error).toMatchObject({ code: "rate_limited", retryAfterSeconds: 50 });

    // Another session has its own allowance.
    expect((await limited.submit(request("POST", "/api/execute", { body: JAVA_JOB }))).status).toBe(202);
    // Invalid requests are refused before they count.
    expect((await limited.submit(request("POST", "/api/execute", { rawBody: "{", cookie }))).status).toBe(400);

    clock += 50_001;
    expect((await limited.submit(request("POST", "/api/execute", { body: JAVA_JOB, cookie }))).status).toBe(202);
  });

  it("limits unfinished jobs per session, and frees the slot when one ends", async () => {
    const limited = service({ maxActiveJobsPerSession: 1 });
    const running = await limited.submit(request("POST", "/api/execute", { body: program(SLEEPER) }));
    const cookie = cookieFrom(running);
    const { executionId } = (await running.json()) as JobSnapshot;

    const refused = await limited.submit(request("POST", "/api/execute", { body: program(HELLO), cookie }));
    expect(refused.status).toBe(429);
    expect((await refused.json()).error.code).toBe("concurrent_limit");
    // Another session is not blocked by it.
    const other = await limited.submit(request("POST", "/api/execute", { body: JAVA_JOB }));
    expect(other.status).toBe(202);

    await limited.stop(request("DELETE", `/api/execute/${executionId}`, { cookie }), executionId);
    const quick = await limited.submit(request("POST", "/api/execute", { body: program(HELLO, { stdin: "x" }), cookie }));
    expect(quick.status).toBe(202);

    // That job finishes without the client ever polling it; the slot is still found free.
    const quickId = ((await quick.json()) as JobSnapshot).executionId;
    const direct = createRunnerClient({ url: runner.url, token: RUNNER_TOKEN, timeoutMs: 5_000 });
    await direct.get(quickId, { waitMs: 30_000 });
    expect((await limited.submit(request("POST", "/api/execute", { body: JAVA_JOB, cookie }))).status).toBe(202);
  });
});

describe("execution API when the runner is not available", { timeout: 60_000 }, () => {
  it("returns a normal runner_unavailable result when the runner is offline, never output", async () => {
    // Port 9 (discard) on loopback: nothing listens there.
    const offline = service({ runner: createRunnerClient({ url: "http://127.0.0.1:9", token: RUNNER_TOKEN, timeoutMs: 2_000 }) });
    const submitted = await offline.submit(request("POST", "/api/execute", { body: program(HELLO) }));
    expect(submitted.status).toBe(202);
    const text = await submitted.text();
    expectNoSecrets(text, "127.0.0.1:9");
    const body = JSON.parse(text) as JobSnapshot;
    expect(body).toMatchObject({ status: "runner_unavailable", projectId: "project-api", revision: 4, track: "cpp" });
    expect(body.result).toMatchObject({
      status: "runner_unavailable",
      unavailableReason: "runner_unreachable",
      phase: null,
      stdout: "",
      stderr: "",
      compilerOutput: "",
      diagnostics: [],
    });
    expect(body.result?.exitCode).toBeUndefined();

    const cookie = cookieFrom(submitted);
    const again = await offline.get(request("GET", `/api/execute/${body.executionId}?wait=1`, { cookie }), body.executionId);
    expect(await again.json()).toEqual(body);
    expect(await (await offline.health()).json()).toEqual({ reachable: false });
  });

  it("returns runner_unavailable, without the token, when the runner rejects the web app's token", async () => {
    const wrongToken = service({ runner: createRunnerClient({ url: runner.url, token: "wrong-token", timeoutMs: 5_000 }) });
    const submitted = await wrongToken.submit(request("POST", "/api/execute", { body: program(HELLO) }));
    const text = await submitted.text();
    expect(text).not.toContain("wrong-token");
    expect((JSON.parse(text) as JobSnapshot).result).toMatchObject({ status: "runner_unavailable", unavailableReason: "internal_error", stdout: "" });
  });

  it.skipIf(!canRunCpp)("ends a job as runner_unavailable when the runner goes away while it runs", async () => {
    const second = await startRunner();
    const api = service({ runner: createRunnerClient({ url: second.url, token: RUNNER_TOKEN, timeoutMs: 2_000 }) });
    const submitted = await api.submit(request("POST", "/api/execute", { body: program(SLEEPER) }));
    const cookie = cookieFrom(submitted);
    const { executionId } = (await submitted.json()) as JobSnapshot;
    await second.stop();

    const lost = (await (await api.get(request("GET", `/api/execute/${executionId}?wait=1`, { cookie }), executionId)).json()) as JobSnapshot;
    expect(lost.result).toMatchObject({ status: "runner_unavailable", unavailableReason: "runner_unreachable", stdout: "" });
    // Stop on a lost job answers with the same final result instead of failing.
    const stopped = await api.stop(request("DELETE", `/api/execute/${executionId}`, { cookie }), executionId);
    expect(await stopped.json()).toEqual(lost);
  });

  it("answers 500 server_misconfigured in production without a usable SESSION_SECRET", async () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = { NODE_ENV: env.NODE_ENV, SESSION_SECRET: env.SESSION_SECRET };
    const globals = globalThis as { __ytlExecution?: unknown };
    const savedService = globals.__ytlExecution;
    try {
      for (const secret of [undefined, "short", "CHANGE_ME_generate_with_the_command_above_0123456789"]) {
        delete globals.__ytlExecution;
        env.NODE_ENV = "production";
        if (secret === undefined) delete env.SESSION_SECRET;
        else env.SESSION_SECRET = secret;
        expect(getExecutionService()).toBeNull();
        const response = await withExecutionService((api) => api.health());
        expect(response.status).toBe(500);
        expect((await response.json()).error.code).toBe("server_misconfigured");
      }
    } finally {
      env.NODE_ENV = saved.NODE_ENV;
      if (saved.SESSION_SECRET === undefined) delete env.SESSION_SECRET;
      else env.SESSION_SECRET = saved.SESSION_SECRET;
      if (savedService === undefined) delete globals.__ytlExecution;
      else globals.__ytlExecution = savedService;
    }
  });
});

describe("guest session cookie", () => {
  it("round-trips a signed session and rejects anything altered", () => {
    const session = createSession(SESSION_SECRET, true);
    expect(session.setCookie).toContain("; Secure");
    const cookie = session.setCookie.split(";")[0];
    const read = (value: string, secret = SESSION_SECRET) => readSession(new Request(SITE, { headers: { cookie: value } }), secret);

    expect(read(cookie)).toBe(session.id);
    expect(read(`ytl_locale=ar; ${cookie}; other=1`)).toBe(session.id);
    expect(read(cookie, "another-secret-0123456789abcdef-another")).toBeNull();
    const other = createSession(SESSION_SECRET, false);
    // Another session's ID with this session's signature.
    expect(read(cookie.replace(session.id, other.id))).toBeNull();
    expect(read(`${SESSION_COOKIE}=v2.${cookie.split(".").slice(1).join(".")}`)).toBeNull();
    expect(read(`${SESSION_COOKIE}=`)).toBeNull();
    expect(read("unrelated=1")).toBeNull();
    expect(readSession(new Request(SITE), SESSION_SECRET)).toBeNull();
  });

  it("accepts only a long, non-placeholder secret", () => {
    expect(isUsableSecret(SESSION_SECRET)).toBe(true);
    expect(isUsableSecret(undefined)).toBe(false);
    expect(isUsableSecret("x".repeat(31))).toBe(false);
    expect(isUsableSecret(`CHANGE_ME${"x".repeat(40)}`)).toBe(false);
  });
});

describe("execution request validation", () => {
  it("applies the file-name rule", () => {
    for (const name of ["main.cpp", "include/shapes/area_v2.test-1.h", "Main.java", "_private.h", "a/b/c/d/e/f.cpp"]) {
      expect(isValidCodeFileName(name)).toBe(true);
    }
    for (const name of ["", "../x.cpp", "/x.cpp", "a/../x.cpp", "a//x.cpp", "a/", ".hidden", "-o", "a b.cpp", "ملف.cpp", "a\\b.cpp", "x\0.cpp", "a/b/c/d/e/f/g.cpp", "x".repeat(201), 5, null]) {
      expect(isValidCodeFileName(name)).toBe(false);
    }
  });

  it("keeps only the contract's fields", () => {
    const outcome = validateExecutionRequest({ ...program(HELLO, { stdin: "in" }), admin: true, files: [{ name: "main.cpp", content: HELLO, secret: 1 }] });
    expect(outcome).toEqual({
      ok: true,
      request: {
        projectId: "project-api",
        revision: 4,
        track: "cpp",
        stdin: "in",
        files: [{ id: "file-0", name: "main.cpp", language: "cpp", content: HELLO, order: 0 }],
      },
    });
    expect(validateExecutionRequest(program(HELLO, { files: [{ name: "Main.cpp", content: "" }, { name: "main.cpp", content: "" }] })).ok).toBe(false);
  });
});
