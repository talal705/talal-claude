// HTTP client for the runner service (services/runner). Server-only: the browser never calls the
// runner, and the runner's URL and token never leave this process.
import type { ExecutionRequest, HealthReport, JobSnapshot } from "@ytl/contracts";

export interface RunnerClientOptions {
  /** e.g. http://localhost:4000 */
  url: string;
  token?: string;
  /** Limit for ordinary calls. A waiting call uses its own, longer limit. */
  timeoutMs: number;
}

/** The runner did not answer: connection refused, timeout, or an answer that is not its protocol. */
export class RunnerUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunnerUnreachableError";
  }
}

/** The runner answered with one of its documented refusals. */
export class RunnerRefusalError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RunnerRefusalError";
    this.status = status;
    this.code = code;
  }
}

export interface RunnerClient {
  submit(request: ExecutionRequest): Promise<JobSnapshot>;
  /** With `waitMs`, holds until the job finishes or that time passes, then returns the current snapshot. */
  get(executionId: string, options?: { waitMs?: number; signal?: AbortSignal }): Promise<JobSnapshot>;
  cancel(executionId: string): Promise<JobSnapshot>;
  health(): Promise<HealthReport>;
}

export function createRunnerClient(options: RunnerClientOptions): RunnerClient {
  const base = options.url.replace(/\/+$/, "");

  async function call<T>(method: string, path: string, init: { body?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const timeout = AbortSignal.timeout(init.timeoutMs ?? options.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: init.signal ? AbortSignal.any([timeout, init.signal]) : timeout,
        cache: "no-store",
        redirect: "error",
      });
    } catch (error) {
      throw new RunnerUnreachableError(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new RunnerUnreachableError(`the runner answered ${response.status} without JSON`);
    }
    if (response.ok) return payload as T;

    const error = (payload as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    if (typeof error?.code === "string") {
      throw new RunnerRefusalError(response.status, error.code, typeof error.message === "string" ? error.message : error.code);
    }
    throw new RunnerUnreachableError(`the runner answered ${response.status} with an unknown body`);
  }

  return {
    submit: (request) => call<JobSnapshot>("POST", "/jobs", { body: request }),

    async get(executionId, { waitMs, signal } = {}) {
      const path = `/jobs/${encodeURIComponent(executionId)}`;
      if (waitMs === undefined) return call<JobSnapshot>("GET", path, { signal });
      try {
        return await call<JobSnapshot>("GET", `${path}?wait=1`, { timeoutMs: waitMs, signal });
      } catch (error) {
        // Still running when the wait ran out (or the runner is gone): the plain call tells which.
        if (error instanceof RunnerUnreachableError && !signal?.aborted) return call<JobSnapshot>("GET", path);
        throw error;
      }
    },

    cancel: (executionId) => call<JobSnapshot>("DELETE", `/jobs/${encodeURIComponent(executionId)}`, { timeoutMs: 15_000 }),

    health: () => call<HealthReport>("GET", "/health"),
  };
}
