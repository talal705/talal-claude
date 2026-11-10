// The server tracks (C++, Java, C#) behind the same interface as the browser adapters: this adapter
// calls the site's own /api/execute routes, which talk to the runner service.
import type { ExecutionResult, JobSnapshot, UnavailableReason } from "@ytl/contracts";
import { unavailableResult } from "./result";
import { createRun } from "./run";
import type { RunAdapter } from "./types";

export interface ServerAdapterOptions {
  /** Default `/api/execute`. */
  basePath?: string;
  fetch?: typeof fetch;
}

interface ApiError {
  error?: { code?: unknown; message?: unknown };
}

/** Refusals of the execution API, reported as `runner_unavailable` with the API's code as the reason. */
const REFUSAL_REASONS = ["rate_limited", "concurrent_limit", "queue_full", "invalid_request"] as const satisfies readonly UnavailableReason[];

function reasonFor(code: unknown): UnavailableReason {
  return REFUSAL_REASONS.find((reason) => reason === code) ?? "internal_error";
}

export function createServerAdapter(options: ServerAdapterOptions = {}): RunAdapter {
  const basePath = options.basePath ?? "/api/execute";
  // Looked up per call so a test or a late polyfill can replace it.
  const call = (input: string, init?: RequestInit) => (options.fetch ?? fetch)(input, { ...init, credentials: "same-origin", cache: "no-store" });

  return (request) =>
    createRun(request, async (control) => {
      const abort = new AbortController();
      let serverId: string | null = null;
      // The handle's ID was given out before the server chose its own; results carry the handle's.
      const adopt = (result: ExecutionResult): ExecutionResult => ({ ...result, executionId: control.executionId });
      const unavailable = (reason: UnavailableReason, message: string) =>
        control.finishWith(unavailableResult(request, control.executionId, reason, message));

      control.onStop(() => {
        abort.abort();
        const id = serverId;
        if (id === null) {
          control.finish({ status: "cancelled", phase: null });
          return;
        }
        // Ask the server to kill the job; its answer is the final result. If that fails the run still ends here.
        call(`${basePath}/${id}`, { method: "DELETE" })
          .then(async (response) => (response.ok ? ((await response.json()) as JobSnapshot) : null))
          .then(
            (snapshot) => {
              if (snapshot?.result) control.finishWith(adopt(snapshot.result));
              else control.finish({ status: "cancelled", phase: null });
            },
            () => control.finish({ status: "cancelled", phase: null }),
          );
      });

      const apply = (snapshot: JobSnapshot): boolean => {
        if (snapshot.result) {
          control.finishWith(adopt(snapshot.result));
          return true;
        }
        if (snapshot.status === "queued" || snapshot.status === "compiling" || snapshot.status === "running") control.setStatus(snapshot.status);
        return false;
      };

      try {
        const submitted = await call(basePath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: abort.signal,
        });
        if (!submitted.ok) {
          const body = (await submitted.json().catch(() => null)) as ApiError | null;
          const message = typeof body?.error?.message === "string" ? body.error.message : `The server answered ${submitted.status}.`;
          unavailable(reasonFor(body?.error?.code), message);
          return;
        }
        let snapshot = (await submitted.json()) as JobSnapshot;
        serverId = snapshot.executionId;
        while (!apply(snapshot)) {
          // Held by the server until the job ends, or about 25 s; then asked again.
          const polled = await call(`${basePath}/${serverId}?wait=1`, { signal: abort.signal });
          if (control.finished()) return;
          if (polled.status === 404) {
            unavailable("internal_error", "The server no longer knows this run; it was probably restarted.");
            return;
          }
          if (!polled.ok) {
            unavailable("internal_error", `The server answered ${polled.status}.`);
            return;
          }
          snapshot = (await polled.json()) as JobSnapshot;
        }
      } catch (error) {
        // Stop aborts the request in flight; the stop handler finishes the run.
        if (abort.signal.aborted || control.finished()) return;
        unavailable("runner_unreachable", `The site's execution service could not be reached: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}
