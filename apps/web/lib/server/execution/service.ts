// The execution API behind app/api/execute: guest session, ownership of jobs, limits, same-origin
// check, and the translation of every runner failure into a normal result. Server-only.
//
// Ownership and limits are kept in this process's memory. That fits one web server next to one
// runner; several web instances would need a shared store.
import { randomUUID } from "node:crypto";
import type { ExecutionResult, HealthReport, JobSnapshot, ServerTrack, ToolchainStatus, UnavailableReason } from "@ytl/contracts";
import { isJsonRequest, isSameOrigin, isSecureRequest, json, originOf, readBody } from "../http";
import { RunnerRefusalError, RunnerUnreachableError, createRunnerClient, type RunnerClient } from "./runner-client";
import { createSession, readSession, resolveSessionSecret } from "./session";
import { EXECUTION_LIMITS, validateExecutionRequest } from "./validate";

export type ExecutionApiErrorCode =
  | "invalid_request"
  | "unsupported_media_type"
  | "payload_too_large"
  /** A state-changing request that did not come from this site's own pages. */
  | "forbidden_origin"
  /** Too many submissions from this session in the time window. See `retryAfterSeconds`. */
  | "rate_limited"
  /** This session already has the allowed number of unfinished jobs. */
  | "concurrent_limit"
  /** The runner's queue is full for everyone. */
  | "queue_full"
  /** No such job for this session. Also the answer for another session's job. */
  | "not_found"
  | "server_misconfigured";

export interface ExecutionApiError {
  error: { code: ExecutionApiErrorCode; message: string; retryAfterSeconds?: number };
}

/** `GET /api/execute/health`. */
export type ExecutionHealth =
  | {
      reachable: true;
      toolchains: Record<ServerTrack, Pick<ToolchainStatus, "available" | "version" | "reason">>;
      limits: HealthReport["limits"];
    }
  | { reachable: false };

export interface ExecutionServiceConfig {
  runner: RunnerClient;
  sessionSecret: string;
  /** Origin of the site as browsers see it (NEXT_PUBLIC_APP_URL), accepted in addition to the request's own host. */
  appOrigin?: string;
  rateLimit: { max: number; windowMs: number };
  maxActiveJobsPerSession: number;
  /** Longest a `?wait=1` request is held before answering with the current status. */
  longPollMs: number;
  now?: () => number;
}

export const DEFAULT_RATE_LIMIT = { max: 20, windowMs: 60_000 } as const;
export const DEFAULT_MAX_ACTIVE_JOBS = 2;
export const DEFAULT_LONG_POLL_MS = 25_000;

interface OwnedJob {
  sessionId: string;
  createdAt: number;
  /** Last snapshot seen; authoritative once `final`. */
  snapshot: JobSnapshot;
  final: boolean;
}

const JOB_RETENTION_MS = 60 * 60 * 1000;
const MAX_TRACKED_JOBS = 5_000;
const EXECUTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function apiError(
  status: number,
  code: ExecutionApiErrorCode,
  message: string,
  extra: { retryAfterSeconds?: number } = {},
): Response {
  const body: ExecutionApiError = { error: { code, message, ...extra } };
  return json(status, body, extra.retryAfterSeconds === undefined ? {} : { "retry-after": String(extra.retryAfterSeconds) });
}

function isFinal(snapshot: JobSnapshot): boolean {
  return snapshot.result !== undefined;
}

export interface ExecutionService {
  submit(request: Request): Promise<Response>;
  get(request: Request, executionId: string): Promise<Response>;
  stop(request: Request, executionId: string): Promise<Response>;
  health(): Promise<Response>;
  /**
   * What this server knows about an execution, for other services that are shown an execution ID:
   * the revision it ran, `foreign` when it belongs to another session, or `unknown` (a run in the
   * browser, or a job this server has forgotten).
   */
  describe(sessionId: string, executionId: string): { revision: number } | "foreign" | "unknown";
}

export function createExecutionService(config: ExecutionServiceConfig): ExecutionService {
  const now = config.now ?? Date.now;
  const jobs = new Map<string, OwnedJob>();
  const submissions = new Map<string, number[]>();

  /** A finished `runner_unavailable` result. Output fields are empty: nothing ran. */
  function unavailable(
    job: Pick<JobSnapshot, "executionId" | "projectId" | "revision" | "track">,
    reason: UnavailableReason,
    message: string,
  ): JobSnapshot {
    const base = { executionId: job.executionId, projectId: job.projectId, revision: job.revision, track: job.track };
    const result: ExecutionResult = {
      ...base,
      status: "runner_unavailable",
      phase: null,
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      compilerOutput: "",
      compilerOutputTruncated: false,
      diagnostics: [],
      elapsedMs: 0,
      unavailableReason: reason,
      message,
    };
    return { ...base, status: "runner_unavailable", result };
  }

  function remember(sessionId: string, snapshot: JobSnapshot): OwnedJob {
    const job: OwnedJob = { sessionId, createdAt: now(), snapshot, final: isFinal(snapshot) };
    jobs.set(snapshot.executionId, job);
    return job;
  }

  function update(job: OwnedJob, snapshot: JobSnapshot): JobSnapshot {
    job.snapshot = snapshot;
    job.final = isFinal(snapshot);
    return snapshot;
  }

  function prune(): void {
    const cutoff = now() - JOB_RETENTION_MS;
    for (const [id, job] of jobs) {
      if (job.createdAt < cutoff || jobs.size > MAX_TRACKED_JOBS) jobs.delete(id);
      else break; // Insertion order is creation order.
    }
    const windowStart = now() - config.rateLimit.windowMs;
    for (const [sessionId, times] of submissions) {
      if (times.every((time) => time <= windowStart)) submissions.delete(sessionId);
    }
  }

  /** The job, only if it belongs to the session in the request's cookie. */
  function ownedJob(request: Request, executionId: string): OwnedJob | null {
    if (!EXECUTION_ID_PATTERN.test(executionId)) return null;
    const sessionId = readSession(request, config.sessionSecret);
    const job = jobs.get(executionId);
    return sessionId !== null && job !== undefined && job.sessionId === sessionId ? job : null;
  }

  /** Turns a failed runner call for an existing job into that job's final result. */
  function lost(job: OwnedJob, error: unknown): JobSnapshot {
    if (error instanceof RunnerRefusalError && error.code === "not_found") {
      return update(job, unavailable(job.snapshot, "internal_error", "The runner no longer has this job; it was probably restarted."));
    }
    if (error instanceof RunnerRefusalError) {
      return update(job, unavailable(job.snapshot, "internal_error", `The runner refused the request (${error.code}).`));
    }
    return update(job, unavailable(job.snapshot, "runner_unreachable", "The runner service could not be reached."));
  }

  const notFound = () => apiError(404, "not_found", "No such execution for this session.");

  return {
    async submit(request) {
      if (!isSameOrigin(request, config.appOrigin)) return apiError(403, "forbidden_origin", "This request did not come from the site itself.");
      if (!isJsonRequest(request)) {
        return apiError(415, "unsupported_media_type", "Send the request as application/json.");
      }
      const text = await readBody(request, EXECUTION_LIMITS.maxBodyBytes);
      if (text === null) return apiError(413, "payload_too_large", `The request is larger than ${EXECUTION_LIMITS.maxBodyBytes} bytes.`);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return apiError(400, "invalid_request", "The request body is not valid JSON.");
      }
      const validated = validateExecutionRequest(body);
      if (!validated.ok) return apiError(400, "invalid_request", validated.message);

      prune();
      let sessionId = readSession(request, config.sessionSecret);
      const headers: Record<string, string> = {};
      if (sessionId === null) {
        const session = createSession(config.sessionSecret, isSecureRequest(request));
        sessionId = session.id;
        headers["set-cookie"] = session.setCookie;
      }

      const windowStart = now() - config.rateLimit.windowMs;
      const recent = (submissions.get(sessionId) ?? []).filter((time) => time > windowStart);
      if (recent.length >= config.rateLimit.max) {
        const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + config.rateLimit.windowMs - now()) / 1000));
        return apiError(429, "rate_limited", `At most ${config.rateLimit.max} runs per ${Math.round(config.rateLimit.windowMs / 1000)} seconds.`, {
          retryAfterSeconds,
        });
      }

      const active = () => [...jobs.values()].filter((job) => job.sessionId === sessionId && !job.final);
      if (active().length >= config.maxActiveJobsPerSession) {
        // The client may not have polled a job that has finished meanwhile; ask the runner before refusing.
        await Promise.all(
          active().map(async (job) => {
            try {
              update(job, await config.runner.get(job.snapshot.executionId));
            } catch (error) {
              lost(job, error);
            }
          }),
        );
        if (active().length >= config.maxActiveJobsPerSession) {
          return apiError(429, "concurrent_limit", `At most ${config.maxActiveJobsPerSession} programs can run at once. Stop one or wait for it to finish.`);
        }
      }

      recent.push(now());
      submissions.set(sessionId, recent);

      let snapshot: JobSnapshot;
      try {
        snapshot = await config.runner.submit(validated.request);
      } catch (error) {
        if (error instanceof RunnerRefusalError && error.code === "invalid_request") {
          return apiError(400, "invalid_request", error.message);
        }
        if (error instanceof RunnerRefusalError && error.code === "queue_full") {
          return apiError(429, "queue_full", "The runner is busy. Try again in a moment.", { retryAfterSeconds: 5 });
        }
        const job = { ...validated.request, executionId: randomUUID() };
        snapshot =
          error instanceof RunnerUnreachableError
            ? unavailable(job, "runner_unreachable", "The runner service could not be reached.")
            : unavailable(job, "internal_error", "The runner refused the request.");
        if (!(error instanceof RunnerUnreachableError)) console.error("execution: runner refused a submission:", error);
      }
      remember(sessionId, snapshot);
      return json(202, snapshot, headers);
    },

    async get(request, executionId) {
      const job = ownedJob(request, executionId);
      if (!job) return notFound();
      if (job.final) return json(200, job.snapshot);
      const wait = new URL(request.url).searchParams.get("wait") === "1";
      try {
        const snapshot = await config.runner.get(executionId, wait ? { waitMs: config.longPollMs, signal: request.signal } : {});
        return json(200, update(job, snapshot));
      } catch (error) {
        // The browser went away while waiting: nothing was learned about the job.
        if (request.signal.aborted) return json(200, job.snapshot);
        return json(200, lost(job, error));
      }
    },

    async stop(request, executionId) {
      if (!isSameOrigin(request, config.appOrigin)) return apiError(403, "forbidden_origin", "This request did not come from the site itself.");
      const job = ownedJob(request, executionId);
      if (!job) return notFound();
      if (job.final) return json(200, job.snapshot);
      try {
        return json(200, update(job, await config.runner.cancel(executionId)));
      } catch (error) {
        return json(200, lost(job, error));
      }
    },

    describe(sessionId, executionId) {
      const job = jobs.get(executionId);
      if (!job) return "unknown";
      return job.sessionId === sessionId ? { revision: job.snapshot.revision } : "foreign";
    },

    async health() {
      let body: ExecutionHealth;
      try {
        const report = await config.runner.health();
        const toolchains = {} as Extract<ExecutionHealth, { reachable: true }>["toolchains"];
        for (const [track, status] of Object.entries(report.toolchains) as [ServerTrack, ToolchainStatus][]) {
          // `detail` describes the runner host and stays on the server.
          toolchains[track] = { available: status.available, version: status.version, reason: status.reason };
        }
        body = { reachable: true, toolchains, limits: report.limits };
      } catch {
        body = { reachable: false };
      }
      return json(200, body);
    },
  };
}

// ---------- The application's instance ----------

// Kept on globalThis so hot reloading in development does not forget who owns which job.
const globalForExecution = globalThis as typeof globalThis & { __ytlExecution?: ExecutionService | null };

/** Built on first use from RUNNER_URL, RUNNER_TOKEN, SESSION_SECRET and NEXT_PUBLIC_APP_URL. Null when misconfigured. */
export function getExecutionService(): ExecutionService | null {
  if (globalForExecution.__ytlExecution !== undefined) return globalForExecution.__ytlExecution;

  const sessionSecret = resolveSessionSecret();
  if (sessionSecret === null) return (globalForExecution.__ytlExecution = null);

  return (globalForExecution.__ytlExecution = createExecutionService({
    runner: createRunnerClient({
      url: process.env.RUNNER_URL || "http://localhost:4000",
      token: process.env.RUNNER_TOKEN || undefined,
      timeoutMs: 5_000,
    }),
    sessionSecret,
    appOrigin: originOf(process.env.NEXT_PUBLIC_APP_URL),
    rateLimit: DEFAULT_RATE_LIMIT,
    maxActiveJobsPerSession: DEFAULT_MAX_ACTIVE_JOBS,
    longPollMs: DEFAULT_LONG_POLL_MS,
  }));
}

/** Runs a route against the application's service, or answers 500 when it is misconfigured. */
export function withExecutionService(handler: (service: ExecutionService) => Promise<Response>): Promise<Response> {
  const service = getExecutionService();
  if (!service) return Promise.resolve(apiError(500, "server_misconfigured", "The execution service is not configured on this server."));
  return handler(service).catch((error: unknown) => {
    console.error("execution: unexpected error", error);
    return apiError(500, "server_misconfigured", "The execution service failed unexpectedly.");
  });
}
