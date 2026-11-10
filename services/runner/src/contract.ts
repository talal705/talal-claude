// The execution types are code contracts v1 in @ytl/contracts (frozen). They are re-exported here as
// types only, so Node can run the runner's sources without loading that package. The two runtime
// values the runner needs are defined locally.
import type { RunnerRequestErrorCode, ServerTrack } from "@ytl/contracts";

export type {
  CodeDiagnostic,
  CodeFile,
  CodeTrack,
  ExecutionPhase,
  ExecutionRequest,
  ExecutionResult,
  ExecutionStatus,
  FinalExecutionStatus,
  HealthReport,
  JobSnapshot,
  RunnerRequestErrorCode,
  ServerTrack,
  ToolchainStatus,
  UnavailableReason,
} from "@ytl/contracts";

/** Same list as SERVER_TRACKS in @ytl/contracts; typed against it so they cannot drift apart silently. */
export const SERVER_TRACKS: readonly ServerTrack[] = ["cpp", "java", "csharp"];

/** A request the runner refuses before any job exists. */
export class RunnerRequestError extends Error {
  readonly code: RunnerRequestErrorCode;
  constructor(code: RunnerRequestErrorCode, message: string) {
    super(message);
    this.name = "RunnerRequestError";
    this.code = code;
  }
}
