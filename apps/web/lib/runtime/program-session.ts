// What a sandbox reports about one program, turned into output, diagnostics and an ending.
// Pure: shared by the browser adapters (program.ts) and the Node test helper (testing.ts), so a
// lesson's example code is judged by exactly the rules the learner's run is judged by.
import type { CodeDiagnostic } from "@ytl/contracts";
import { OutputCollector } from "./output";
import type { SandboxMessage } from "./protocol";
import { describeRuntimeError, type FrameMapper } from "./stack";
import type { OutputChunk } from "./types";

export interface ProgramSessionOptions {
  maxOutputBytes: number;
  onOutput?: (chunk: OutputChunk) => void;
  /** Diagnostics from an earlier step (type checking), carried into the result. */
  initialDiagnostics?: readonly CodeDiagnostic[];
  /** Maps a stack frame of the code that ran to the code the learner wrote (TypeScript). */
  mapFrame?: FrameMapper;
  /** Reads a diagnostic out of the program's stderr after a failed exit (Python tracebacks). */
  diagnoseStderr?: (stderr: string) => CodeDiagnostic | null;
}

export type SessionEvent =
  | { kind: "loading"; loading: boolean }
  /** The program is about to start: time limits begin now. */
  | { kind: "started" }
  /** The program ended by itself, or its output passed the cap. */
  | { kind: "ended"; status: "success" | "error" | "output_limit"; exitCode?: number }
  /** The worker gave up before the program began: the runtime is missing or broken. */
  | { kind: "start_failed"; message: string };

export interface ProgramSession {
  readonly output: OutputCollector;
  readonly diagnostics: CodeDiagnostic[];
  started(): boolean;
  /** The event the message causes, or null when it only adds output. */
  handle(message: SandboxMessage): SessionEvent | null;
}

export function createProgramSession(options: ProgramSessionOptions): ProgramSession {
  const output = new OutputCollector(options.maxOutputBytes, options.onOutput);
  const diagnostics: CodeDiagnostic[] = [...(options.initialDiagnostics ?? [])];
  let started = false;
  let startError: string | null = null;

  return {
    output,
    diagnostics,
    started: () => started,
    handle(message) {
      switch (message.type) {
        case "loading":
          return { kind: "loading", loading: message.loading };
        case "ready":
          started = true;
          return { kind: "started" };
        case "output":
          // Anything printed before the program starts is the runtime's own start-up noise.
          if (started && !output.append(message.stream, message.text)) return { kind: "ended", status: "output_limit" };
          return null;
        case "error": {
          if (!started) {
            startError = message.message;
            return null;
          }
          const report = describeRuntimeError(message, options.mapFrame);
          diagnostics.push(report.diagnostic);
          if (!output.append("stderr", report.text)) return { kind: "ended", status: "output_limit" };
          return null;
        }
        case "done": {
          if (!started) return { kind: "start_failed", message: startError ?? "The program's runtime could not be started." };
          if (message.exitCode !== 0) {
            const fromStderr = options.diagnoseStderr?.(output.text("stderr"));
            if (fromStderr) diagnostics.push(fromStderr);
          }
          return { kind: "ended", status: message.exitCode === 0 ? "success" : "error", exitCode: message.exitCode };
        }
        default:
          // Training API messages come only from page previews, which do not use a program session.
          return null;
      }
    },
  };
}
