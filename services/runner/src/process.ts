// Runs one command of a job under the limits this host can enforce, in its own process group.
import { execFile, spawn } from "node:child_process";

export interface ProcessSpec {
  /** Program and arguments as an array. Never a shell string. */
  argv: string[];
  cwd: string;
  /** The complete environment of the process. Nothing is inherited from the runner. */
  env: Record<string, string>;
  stdin?: string;
}

export interface ProcessLimits {
  wallMs: number;
  cpuSeconds: number;
  /** Cap for each of stdout and stderr. */
  maxOutputBytes: number;
  maxFileBytes: number;
  maxOpenFiles: number;
  /** Watchdog threshold; omit to skip memory sampling. */
  memoryWatchdogBytes?: number;
  memorySampleMs: number;
}

export type Termination =
  | "exit"
  | "timeout"
  | "output_limit"
  | "memory_limit"
  | "cancelled"
  /** The process could not be started. */
  | "spawn_error";

export interface ProcessOutcome {
  termination: Termination;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  elapsedMs: number;
  spawnError?: string;
}

// Fixed text: the limits and the command arrive as positional arguments, never inside the script.
// `exec` replaces the shell, so the job's process is the group leader the runner signals.
const LIMIT_SCRIPT =
  'ulimit -c 0 && ulimit -t "$1" && ulimit -f "$2" && ulimit -n "$3" || exit 125; shift 3; exec "$@"';

/** Prefixes `argv` with the rlimit wrapper. RLIMIT_FSIZE is counted in 512-byte blocks. */
export function withResourceLimits(argv: string[], limits: ProcessLimits): string[] {
  return [
    "/bin/sh",
    "-c",
    LIMIT_SCRIPT,
    "sh",
    String(limits.cpuSeconds),
    String(Math.ceil(limits.maxFileBytes / 512)),
    String(limits.maxOpenFiles),
    ...argv,
  ];
}

/** Sends SIGKILL to every process in the group. Returns false when the group no longer exists. */
function killGroup(pid: number): boolean {
  try {
    process.kill(-pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

/** Resident memory of a whole process group in bytes, or null if it could not be sampled. */
function sampleGroupMemory(pgid: number): Promise<number | null> {
  return new Promise((resolve) => {
    // Only the job's own group: listing every process of the machine ten times a second is costly
    // when several jobs run.
    execFile("/bin/ps", ["-o", "rss=", "-g", String(pgid)], { timeout: 2_000 }, (error, stdout) => {
      // ps exits with 1 when the group has no process left.
      if (error && !stdout) {
        resolve(null);
        return;
      }
      let kilobytes = 0;
      for (const line of stdout.split("\n")) kilobytes += Number(line.trim()) || 0;
      resolve(kilobytes * 1024);
    });
  });
}

class CappedBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  truncated = false;
  private readonly cap: number;

  constructor(cap: number) {
    this.cap = cap;
  }

  /** Returns false once the cap is passed. */
  push(chunk: Buffer): boolean {
    const room = this.cap - this.size;
    if (chunk.length > room) {
      if (room > 0) this.chunks.push(chunk.subarray(0, room));
      this.size = this.cap;
      this.truncated = true;
      return false;
    }
    this.chunks.push(chunk);
    this.size += chunk.length;
    return true;
  }

  text(): string {
    const decoded = new TextDecoder("utf-8").decode(Buffer.concat(this.chunks));
    // A cut can split a multi-byte character; drop the replacement character it leaves behind.
    return this.truncated ? decoded.replace(/�+$/, "") : decoded;
  }
}

/**
 * Starts the command and resolves when it has ended and its output is collected. Never rejects.
 * Aborting `signal`, the wall clock, an output cap or the memory watchdog kills the whole group.
 */
export function runProcess(spec: ProcessSpec, limits: ProcessLimits, signal: AbortSignal): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({
        termination: "cancelled",
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        elapsedMs: 0,
      });
      return;
    }

    const startedAt = performance.now();
    const stdout = new CappedBuffer(limits.maxOutputBytes);
    const stderr = new CappedBuffer(limits.maxOutputBytes);
    let termination: Termination | null = null;
    let settled = false;
    let drainTimer: NodeJS.Timeout | undefined;
    let memoryTimer: NodeJS.Timeout | undefined;

    const [command, ...args] = spec.argv;
    // detached: the child leads a new process group, so one signal reaches it and its descendants.
    const child = spawn(command, args, { cwd: spec.cwd, env: spec.env, detached: true, stdio: ["pipe", "pipe", "pipe"] });

    const stop = (reason: Termination) => {
      if (termination === null) termination = reason;
      if (child.pid !== undefined) killGroup(child.pid);
    };
    const onAbort = () => stop("cancelled");
    signal.addEventListener("abort", onAbort, { once: true });
    const wallTimer = setTimeout(() => stop("timeout"), limits.wallMs);

    const finish = (exitCode: number | null, exitSignal: string | null, spawnError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(wallTimer);
      clearTimeout(drainTimer);
      clearInterval(memoryTimer);
      signal.removeEventListener("abort", onAbort);
      resolve({
        // RLIMIT_CPU ends the process with SIGXCPU: that is a time limit, not a crash.
        termination: termination ?? (exitSignal === "SIGXCPU" ? "timeout" : "exit"),
        exitCode,
        signal: exitSignal,
        stdout: stdout.text(),
        stderr: stderr.text(),
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
        elapsedMs: Math.round(performance.now() - startedAt),
        spawnError,
      });
    };

    const watchdogBytes = limits.memoryWatchdogBytes;
    if (watchdogBytes !== undefined) {
      let sampling = false;
      memoryTimer = setInterval(() => {
        if (sampling || child.pid === undefined) return;
        sampling = true;
        void sampleGroupMemory(child.pid).then((bytes) => {
          sampling = false;
          if (bytes !== null && bytes > watchdogBytes) stop("memory_limit");
        });
      }, limits.memorySampleMs);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      if (!stdout.push(chunk)) stop("output_limit");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (!stderr.push(chunk)) stop("output_limit");
    });

    // The program may exit without reading its input.
    child.stdin.on("error", () => {});
    child.stdin.end(spec.stdin ?? "");

    child.on("error", (error) => {
      termination = "spawn_error";
      finish(null, null, error.message);
    });
    child.on("exit", () => {
      // Background processes the program left in its group die with it.
      if (child.pid !== undefined) killGroup(child.pid);
      // A process that escaped the group could hold the pipes open; do not wait for it.
      drainTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
      }, 500);
    });
    child.on("close", (exitCode, exitSignal) => finish(exitCode, exitSignal));
  });
}
