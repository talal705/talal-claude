// The life cycle shared by all adapters: status changes, the single final result, Stop.
import type { ExecutionRequest, ExecutionResult, ExecutionStatus } from "@ytl/contracts";
import { buildResult, type ResultFields } from "./result";
import type { RunHandle } from "./types";

export interface RunControl {
  readonly executionId: string;
  readonly request: ExecutionRequest;
  /** Milliseconds since the run was created. */
  elapsed(): number;
  finished(): boolean;
  setStatus(status: "queued" | "compiling" | "running"): void;
  /** Ends the run. Only the first call counts; cleanup registered with `onEnd` runs once. */
  finish(fields: Omit<ResultFields, "elapsedMs">): void;
  /** Ends the run with a result that was produced elsewhere (the server runner). */
  finishWith(result: ExecutionResult): void;
  /** What Stop does for this run. It must call `finish` with status `cancelled`. */
  onStop(stop: () => void): void;
  /** Runs when the run ends for any reason: remove frames, terminate workers, clear timers. */
  onEnd(cleanup: () => void): void;
}

function newExecutionId(): string {
  // randomUUID needs a secure context; plain-HTTP LAN addresses fall back to getRandomValues.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Creates the handle and hands control to `body`. If `body` throws or rejects, the run ends as
 * `runner_unavailable` / `internal_error`: an adapter fault is never shown as program output.
 */
export function createRun(request: ExecutionRequest, body: (control: RunControl) => void | Promise<void>): RunHandle {
  const executionId = newExecutionId();
  const startedAt = performance.now();
  const listeners = new Set<(status: ExecutionStatus) => void>();
  const cleanups: (() => void)[] = [];
  let status: ExecutionStatus = "queued";
  let stopHandler: (() => void) | null = null;
  let stopRequested = false;
  let done = false;
  let resolve!: (result: ExecutionResult) => void;
  const result = new Promise<ExecutionResult>((res) => {
    resolve = res;
  });

  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener(status);
      } catch (error) {
        console.error(error);
      }
    }
  };

  const end = (final: ExecutionResult) => {
    if (done) return;
    done = true;
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup();
      } catch (error) {
        console.error(error);
      }
    }
    status = final.status;
    notify();
    listeners.clear();
    resolve(final);
  };

  const control: RunControl = {
    executionId,
    request,
    elapsed: () => performance.now() - startedAt,
    finished: () => done,
    setStatus(next) {
      if (done || status === next) return;
      status = next;
      notify();
    },
    finish(fields) {
      end(buildResult(request, executionId, { ...fields, elapsedMs: performance.now() - startedAt }));
    },
    finishWith: end,
    onStop(stop) {
      stopHandler = stop;
      // Stop was pressed before the adapter was ready for it.
      if (stopRequested && !done) stop();
    },
    onEnd(cleanup) {
      if (done) cleanup();
      else cleanups.push(cleanup);
    },
  };

  const fault = (error: unknown) => {
    console.error("runtime: adapter fault", error);
    control.finish({
      status: "runner_unavailable",
      phase: null,
      unavailableReason: "internal_error",
      message: error instanceof Error ? error.message : String(error),
    });
  };

  // Not synchronously: the caller gets the handle (and can subscribe) before the first status change.
  queueMicrotask(() => {
    if (done) return;
    try {
      const pending = body(control);
      if (pending) pending.catch(fault);
    } catch (error) {
      fault(error);
    }
  });

  return {
    executionId,
    status: () => status,
    subscribe(listener) {
      if (done) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    result,
    stop() {
      if (done) return;
      stopRequested = true;
      if (stopHandler) stopHandler();
      // An adapter that has not registered a stop action yet ends here; nothing has run.
      else control.finish({ status: "cancelled", phase: null });
    },
  };
}
