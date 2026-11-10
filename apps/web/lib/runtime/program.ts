// Runs one console program (JavaScript, emitted TypeScript, Python) in a worker inside a hidden
// sandbox frame, and turns what the sandbox reports into the run's result.
import type { CodeDiagnostic, UnavailableReason } from "@ytl/contracts";
import { createProgramSession } from "./program-session";
import type { RunControl } from "./run";
import { newNonce, openSandbox, sandboxDocument } from "./sandbox-frame";
import { workerFrameBootstrap } from "./sandbox-sources";
import type { FrameMapper } from "./stack";
import type { RunContext, RuntimeLimits } from "./types";

export interface SandboxedProgram {
  control: RunControl;
  context?: RunContext;
  limits: RuntimeLimits;
  /** Content-Security-Policy of the frame; the worker inherits it. */
  csp: string;
  workerSource: string;
  workerType: "module" | "classic";
  /** Posted to the worker; `executionId` is added. */
  init: Record<string, unknown>;
  title: string;
  /** What the compile step (type check, linking) produced, carried into the final result. */
  compile?: { ms: number; output: string; diagnostics: CodeDiagnostic[] };
  /** Maps a stack frame of the code that ran to the code the learner wrote (TypeScript). */
  mapFrame?: FrameMapper;
  /** Reads a diagnostic out of the program's stderr after a failed exit (Python tracebacks). */
  diagnoseStderr?: (stderr: string) => CodeDiagnostic | null;
  /** Longest wait for the worker to report that the program is starting (runtime download included). */
  startTimeoutMs: number;
  /** Reason given when the worker fails before the program starts. */
  startFailureReason: UnavailableReason;
}

export function runInSandbox(program: SandboxedProgram): void {
  const { control, context, limits } = program;
  const session = createProgramSession({
    maxOutputBytes: limits.maxOutputBytes,
    onOutput: context?.onOutput,
    initialDiagnostics: program.compile?.diagnostics,
    mapFrame: program.mapFrame,
    diagnoseStderr: program.diagnoseStderr,
  });
  const { output, diagnostics } = session;
  let startedAt: number | null = null;
  let loading = false;
  let runTimer: ReturnType<typeof setTimeout> | undefined;

  const setLoading = (next: boolean) => {
    if (loading === next) return;
    loading = next;
    try {
      context?.onRuntimeLoading?.(next);
    } catch (error) {
      console.error(error);
    }
  };

  const finish = (fields: { status: "success" | "error" | "timeout" | "output_limit" | "cancelled"; exitCode?: number }) => {
    control.finish({
      ...fields,
      phase: "run",
      output,
      compilerOutput: program.compile?.output,
      diagnostics,
      compileMs: program.compile?.ms,
      runMs: startedAt === null ? 0 : performance.now() - startedAt,
    });
  };

  const startTimer = setTimeout(() => {
    control.finish({
      status: "runner_unavailable",
      phase: null,
      unavailableReason: program.startFailureReason,
      message: "The program's runtime did not start in time.",
    });
  }, program.startTimeoutMs);

  const nonce = newNonce();
  const sandbox = openSandbox({
    executionId: control.executionId,
    title: program.title,
    nonce,
    srcdoc: sandboxDocument(program.csp, workerFrameBootstrap(nonce)),
    connect: {
      workerSource: program.workerSource,
      workerType: program.workerType,
      init: { ...program.init, executionId: control.executionId },
    },
    onNavigated: () => {
      control.finish({ status: "runner_unavailable", phase: null, unavailableReason: "internal_error", message: "The sandbox frame was replaced." });
    },
    onMessage: (message) => {
      if (control.finished()) return;
      const event = session.handle(message);
      if (event === null) return;
      switch (event.kind) {
        case "loading":
          setLoading(event.loading);
          break;
        case "started":
          clearTimeout(startTimer);
          setLoading(false);
          startedAt = performance.now();
          control.setStatus("running");
          if (limits.timeoutMs > 0) runTimer = setTimeout(() => finish({ status: "timeout" }), limits.timeoutMs);
          break;
        case "ended":
          finish({ status: event.status, exitCode: event.exitCode });
          break;
        case "start_failed":
          control.finish({ status: "runner_unavailable", phase: null, unavailableReason: program.startFailureReason, message: event.message });
          break;
      }
    },
  });

  control.onEnd(() => {
    clearTimeout(startTimer);
    clearTimeout(runTimer);
    setLoading(false);
    // Removing the frame is what stops the program: its worker dies with it, even in an endless loop.
    sandbox.dispose();
  });
  control.onStop(() => {
    if (startedAt === null) control.finish({ status: "cancelled", phase: null });
    else finish({ status: "cancelled" });
  });
}
