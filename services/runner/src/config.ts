import { tmpdir } from "node:os";

export interface RunnerConfig {
  /** Directory that holds one temporary workspace per job. */
  workRoot: string;
  maxConcurrent: number;
  maxQueued: number;
  compileWallMs: number;
  runWallMs: number;
  /** CPU seconds per process (RLIMIT_CPU), both phases. */
  cpuSeconds: number;
  /** Cap per stream (stdout, stderr, compiler output). */
  maxOutputBytes: number;
  /** Largest file the program may write (RLIMIT_FSIZE). */
  maxFileBytes: number;
  maxOpenFiles: number;
  /** The watchdog kills a job whose resident memory passes this. Sampled, so not a hard ceiling. */
  memoryWatchdogBytes: number;
  memorySampleMs: number;
  maxFiles: number;
  /** Total size of all submitted files. */
  maxSourceBytes: number;
  maxStdinBytes: number;
  /** Finished results kept in memory for polling clients. */
  maxRetainedResults: number;
  /** Home of the JDK (contains bin/javac). Unset: the runner looks for one itself. */
  javaHome?: string;
  /** Root of the .NET installation (contains the `dotnet` host, sdk/, packs/, shared/). Unset: looked up from `dotnet` on PATH. */
  dotnetRoot?: string;
  /** Heap limit given to the JVM (-Xmx) and the .NET runtime (GC heap hard limit). */
  managedHeapBytes: number;
  /**
   * `required`: refuse to execute when the process sandbox is unavailable.
   * `off`: run without it. Only for debugging the runner itself; never for learner code.
   */
  sandbox: "required" | "off";
}

const MIB = 1024 * 1024;

export const DEFAULT_CONFIG: RunnerConfig = {
  workRoot: tmpdir(),
  maxConcurrent: 2,
  maxQueued: 16,
  compileWallMs: 30_000,
  runWallMs: 10_000,
  cpuSeconds: 10,
  maxOutputBytes: MIB,
  maxFileBytes: 16 * MIB,
  maxOpenFiles: 256,
  memoryWatchdogBytes: 512 * MIB,
  memorySampleMs: 100,
  maxFiles: 32,
  maxSourceBytes: MIB,
  maxStdinBytes: 256 * 1024,
  maxRetainedResults: 200,
  managedHeapBytes: 256 * MIB,
  sandbox: "required",
};

function positiveInteger(name: string, value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer, got "${value}"`);
  return parsed;
}

/** Reads the RUNNER_* variables. Unset variables keep the defaults. */
export function configFromEnv(env: NodeJS.ProcessEnv): RunnerConfig {
  const config = { ...DEFAULT_CONFIG };
  config.runWallMs = positiveInteger("RUNNER_TIMEOUT_MS", env.RUNNER_TIMEOUT_MS) ?? config.runWallMs;
  config.compileWallMs = positiveInteger("RUNNER_COMPILE_TIMEOUT_MS", env.RUNNER_COMPILE_TIMEOUT_MS) ?? config.compileWallMs;
  config.maxOutputBytes = positiveInteger("RUNNER_MAX_OUTPUT_BYTES", env.RUNNER_MAX_OUTPUT_BYTES) ?? config.maxOutputBytes;
  config.maxConcurrent = positiveInteger("RUNNER_MAX_CONCURRENT", env.RUNNER_MAX_CONCURRENT) ?? config.maxConcurrent;
  config.maxQueued = positiveInteger("RUNNER_MAX_QUEUED", env.RUNNER_MAX_QUEUED) ?? config.maxQueued;
  if (env.RUNNER_WORK_ROOT) config.workRoot = env.RUNNER_WORK_ROOT;
  if (env.RUNNER_JAVA_HOME) config.javaHome = env.RUNNER_JAVA_HOME;
  if (env.RUNNER_DOTNET_ROOT) config.dotnetRoot = env.RUNNER_DOTNET_ROOT;
  if (env.RUNNER_SANDBOX === "off") config.sandbox = "off";
  else if (env.RUNNER_SANDBOX && env.RUNNER_SANDBOX !== "required") {
    throw new Error(`RUNNER_SANDBOX must be "required" or "off", got "${env.RUNNER_SANDBOX}"`);
  }
  return config;
}
