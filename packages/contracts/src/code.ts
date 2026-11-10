import type { Localized } from "./common";

export type CodeTrack =
  | "html_css"
  | "javascript"
  | "typescript"
  | "python"
  | "cpp"
  | "csharp"
  | "java";

export interface CodeFile {
  id: string;
  /** Relative path inside the project, e.g. `main.cpp` or `include/shape.h`. ASCII letters, digits, `_ - .`; at most 6 segments. */
  name: string;
  language: CodeTrack;
  content: string;
  order: number;
}

export interface CodeProject {
  id: string;
  track: CodeTrack;
  title: string;
  files: CodeFile[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CodeDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  file?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  source: "compiler" | "runtime" | "type-checker" | "linter";
}

// ---------- Execution (code contracts v1, frozen 2026-10-10) ----------
// Produced by services/runner for server tracks; browser adapters produce the same ExecutionResult.

/** Tracks that run as server jobs. The other tracks run in the browser and are rejected here. */
export type ServerTrack = "cpp" | "java" | "csharp";

export const SERVER_TRACKS: readonly ServerTrack[] = ["cpp", "java", "csharp"];

/** `CodeFile.name` is the path inside the job workspace, e.g. `main.cpp` or `include/shape.h`. */
export interface ExecutionRequest {
  projectId: string;
  track: CodeTrack;
  files: CodeFile[];
  stdin?: string;
  revision: number;
}

export type ExecutionPhase = "compile" | "run";

export type ExecutionStatus =
  // Not finished yet.
  | "queued"
  | "compiling"
  | "running"
  // Finished. `phase` says where: `error` in `compile` is a compile error, in `run` a non-zero exit or a signal.
  | "success"
  | "error"
  | "timeout"
  /** Killed because stdout or stderr passed the byte cap. */
  | "output_limit"
  /** Killed by the memory watchdog (best effort, see services/runner/README.md). */
  | "memory_limit"
  | "cancelled"
  /** Nothing was executed. `unavailableReason` says why. */
  | "runner_unavailable";

export type FinalExecutionStatus = Exclude<ExecutionStatus, "queued" | "compiling" | "running">;

export type UnavailableReason =
  /** The compiler or runtime for this track is not installed on the runner host. */
  | "toolchain_not_installed"
  /** The toolchain exists but the runner has no adapter for it yet. */
  | "adapter_not_implemented"
  /** The runner refuses to execute without its process sandbox. */
  | "sandbox_unavailable"
  /** The runner failed internally (could not create a workspace or start a process). */
  | "internal_error"
  /** The web app could not reach the runner service. */
  | "runner_unreachable"
  /** The web app's execution API refused the submission; nothing was sent to the runner. */
  | "rate_limited"
  | "concurrent_limit"
  | "queue_full"
  | "invalid_request";

export interface ExecutionResult {
  executionId: string;
  projectId: string;
  revision: number;
  track: CodeTrack;
  status: FinalExecutionStatus;
  /** Phase in which the job ended; `null` when it never started (unavailable, cancelled while queued). */
  phase: ExecutionPhase | null;
  /** Program output only. Never synthesized: empty when the program did not run. */
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  /** Raw compiler output (errors and warnings), also parsed into `diagnostics`. */
  compilerOutput: string;
  compilerOutputTruncated: boolean;
  diagnostics: CodeDiagnostic[];
  /** Wall time from leaving the queue to the end, and per phase when the phase ran. */
  elapsedMs: number;
  compileMs?: number;
  runMs?: number;
  /** Exit code of the program (run phase) or of the compiler (compile phase), when it exited by itself. */
  exitCode?: number;
  /** Signal that ended the process, e.g. `SIGSEGV`. */
  signal?: string;
  unavailableReason?: UnavailableReason;
  /** English detail for logs and developers; the UI localizes from `status`, `phase` and the reason. */
  message?: string;
}

/** What `GET /jobs/:id` returns: the live status, and the result once finished. */
export interface JobSnapshot {
  executionId: string;
  projectId: string;
  revision: number;
  track: CodeTrack;
  status: ExecutionStatus;
  result?: ExecutionResult;
}

export interface ToolchainStatus {
  available: boolean;
  /** First line of the tool's version output, when available. */
  version?: string;
  reason?: UnavailableReason;
  detail?: string;
}

export interface HealthReport {
  status: "ok";
  toolchains: Record<ServerTrack, ToolchainStatus>;
  sandbox: { kind: "macos-seatbelt" | "none"; available: boolean; required: boolean; detail?: string };
  queue: { running: number; queued: number; maxConcurrent: number; maxQueued: number };
  limits: {
    compileWallMs: number;
    runWallMs: number;
    cpuSeconds: number;
    maxOutputBytes: number;
    maxFileBytes: number;
    /** Watchdog threshold, not a hard ceiling. */
    memoryWatchdogBytes: number;
    maxFiles: number;
    maxSourceBytes: number;
    maxStdinBytes: number;
  };
}

export type RunnerRequestErrorCode = "invalid_request" | "queue_full" | "not_found";

export type RuntimeAdapter =
  | "html_preview"
  | "js_worker"
  | "js_preview"
  | "ts_typecheck_then_js"
  | "pyodide_worker"
  | "server_cpp"
  | "server_java"
  | "server_csharp";

export interface RuntimeConfig {
  track: CodeTrack;
  adapter: RuntimeAdapter;
  timeoutMs: number;
  maxOutputBytes: number;
  supportedLibraries: string[];
}

export const RUNTIME_CONFIGS: Record<CodeTrack, RuntimeConfig> = {
  html_css: {
    track: "html_css",
    adapter: "html_preview",
    timeoutMs: 0,
    maxOutputBytes: 0,
    supportedLibraries: [],
  },
  javascript: {
    track: "javascript",
    adapter: "js_worker",
    timeoutMs: 10000,
    maxOutputBytes: 1048576,
    supportedLibraries: [],
  },
  typescript: {
    track: "typescript",
    adapter: "ts_typecheck_then_js",
    timeoutMs: 15000,
    maxOutputBytes: 1048576,
    supportedLibraries: [],
  },
  python: {
    track: "python",
    adapter: "pyodide_worker",
    timeoutMs: 30000,
    maxOutputBytes: 1048576,
    supportedLibraries: [], // standard library only until package wheels are vendored locally
  },
  cpp: {
    track: "cpp",
    adapter: "server_cpp",
    timeoutMs: 10000,
    maxOutputBytes: 1048576,
    supportedLibraries: [],
  },
  csharp: {
    track: "csharp",
    adapter: "server_csharp",
    timeoutMs: 10000,
    maxOutputBytes: 1048576,
    supportedLibraries: [],
  },
  java: {
    track: "java",
    adapter: "server_java",
    timeoutMs: 10000,
    maxOutputBytes: 1048576,
    supportedLibraries: [],
  },
};

// ---------- File names (one rule for the editor, the web API and the runner) ----------

export const CODE_FILE_NAME_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
export const CODE_FILE_NAME_MAX_DEPTH = 6;
export const CODE_FILE_NAME_MAX_LENGTH = 200;

/** A relative path such as `main.cpp` or `include/shape.h`: `/`-separated segments, no `.`/`..`, no spaces. */
export function isValidCodeFileName(name: unknown): name is string {
  if (typeof name !== "string" || name.length === 0 || name.length > CODE_FILE_NAME_MAX_LENGTH) return false;
  const segments = name.split("/");
  return (
    segments.length <= CODE_FILE_NAME_MAX_DEPTH &&
    segments.every((segment) => CODE_FILE_NAME_SEGMENT.test(segment) && segment !== "." && segment !== "..")
  );
}
