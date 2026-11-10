// The interface every run adapter implements. It is structurally the same as RunAdapter / RunHandle
// in components/code/runner.ts, so the workspace can register these adapters without conversion.
import type { ExecutionRequest, ExecutionResult, ExecutionStatus } from "@ytl/contracts";
import type { TrainingJourney } from "../server/training/contract";

export interface RunHandle {
  readonly executionId: string;
  /** Current status; ends on a final status and stays there. */
  status(): ExecutionStatus;
  /** Called on every status change. Returns the unsubscribe function. */
  subscribe(listener: (status: ExecutionStatus) => void): () => void;
  /** Always resolves, also for failures, cancellation and an unavailable runtime. */
  readonly result: Promise<ExecutionResult>;
  /** Asks the run to end; `result` then resolves with status `cancelled`. Safe to call after the end. */
  stop(): void;
}

export interface OutputChunk {
  stream: "stdout" | "stderr";
  text: string;
}

export interface RunContext {
  /** Required for html_css: an empty element in which the adapter creates the sandboxed preview frame. */
  previewContainer?: HTMLElement;
  /** Live output while the program runs. The final result still holds all of it. */
  onOutput?: (chunk: OutputChunk) => void;
  /** True while a runtime is being downloaded and started (Python, the TypeScript checker), then false. */
  onRuntimeLoading?: (loading: boolean) => void;
  /**
   * "How websites work" track: lets a page preview's fetch() reach this project's training API.
   * Without it a preview's fetch() of a training path fails, as any other fetch() does.
   */
  training?: {
    projectId: string;
    /** Called once per request when its journey is complete, with every event in order. */
    onJourney?: (journey: TrainingJourney) => void;
  };
}

export type RunAdapter = (request: ExecutionRequest, context?: RunContext) => RunHandle;

export interface RuntimeLimits {
  /** Wall-clock limit of the run phase. 0 means no limit (a page preview stays open until stopped). */
  timeoutMs: number;
  /** Cap for each of stdout and stderr, in UTF-8 bytes. */
  maxOutputBytes: number;
}
