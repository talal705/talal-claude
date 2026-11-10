// Job queue and job lifecycle: workspace, compile, run, cancel, cleanup, normalized result.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CppAdapter } from "./adapters/cpp.ts";
import { CsharpAdapter } from "./adapters/csharp.ts";
import { JavaAdapter } from "./adapters/java.ts";
import type { JobPaths, LanguageAdapter } from "./adapters/types.ts";
import { DEFAULT_CONFIG, type RunnerConfig } from "./config.ts";
import {
  RunnerRequestError,
  SERVER_TRACKS,
  type CodeDiagnostic,
  type ExecutionPhase,
  type ExecutionResult,
  type ExecutionStatus,
  type FinalExecutionStatus,
  type HealthReport,
  type JobSnapshot,
  type ServerTrack,
  type ToolchainStatus,
} from "./contract.ts";
import { resolveInside, validateRequest, type ValidatedRequest } from "./paths.ts";
import { runProcess, withResourceLimits, type ProcessLimits, type ProcessOutcome } from "./process.ts";
import { detectSandbox, type Sandbox } from "./sandbox.ts";

export interface RunnerOptions {
  /** Replace the built-in adapters or the detected sandbox. Used by tests of the unavailable paths. */
  adapters?: LanguageAdapter[];
  sandbox?: Sandbox;
}

interface Job {
  id: string;
  request: ValidatedRequest;
  status: ExecutionStatus;
  result?: ExecutionResult;
  abort: AbortController;
  done: Promise<ExecutionResult>;
  settle: (result: ExecutionResult) => void;
}

// The compiler is trusted more than the learner's program, but a template bomb must not take the host down.
const COMPILE_MEMORY_WATCHDOG_BYTES = 2 * 1024 * 1024 * 1024;

const EMPTY_RESULT = {
  stdout: "",
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
  compilerOutput: "",
  compilerOutputTruncated: false,
  diagnostics: [] as CodeDiagnostic[],
  elapsedMs: 0,
};

/** Statuses a killed or failed process maps to directly, in either phase. */
const TERMINATION_STATUS = {
  timeout: "timeout",
  output_limit: "output_limit",
  memory_limit: "memory_limit",
  cancelled: "cancelled",
} as const;

export class Runner {
  private readonly config: RunnerConfig;
  private readonly adapters: Map<ServerTrack, LanguageAdapter>;
  private readonly toolchains: Record<ServerTrack, ToolchainStatus>;
  private readonly sandbox: Sandbox;
  private readonly jobs = new Map<string, Job>();
  private readonly queue: Job[] = [];
  private running = 0;
  private closed = false;

  private constructor(
    config: RunnerConfig,
    adapters: Map<ServerTrack, LanguageAdapter>,
    toolchains: Record<ServerTrack, ToolchainStatus>,
    sandbox: Sandbox,
  ) {
    this.config = config;
    this.adapters = adapters;
    this.toolchains = toolchains;
    this.sandbox = sandbox;
  }

  /** Probes the host (toolchains, sandbox, rlimit wrapper) and returns a ready runner. */
  static async create(overrides: Partial<RunnerConfig> = {}, options: RunnerOptions = {}): Promise<Runner> {
    const config = { ...DEFAULT_CONFIG, ...overrides };
    await mkdir(config.workRoot, { recursive: true });
    // The sandbox profile matches real paths; on macOS the temp directory is behind a symlink.
    config.workRoot = await realpath(config.workRoot);

    const sandbox = options.sandbox ?? (await detectSandbox());
    const adapterList = options.adapters ?? [
      new CppAdapter(),
      new JavaAdapter({ javaHome: config.javaHome, heapBytes: config.managedHeapBytes }),
      new CsharpAdapter({ dotnetRoot: config.dotnetRoot, heapBytes: config.managedHeapBytes }),
    ];
    const adapters = new Map(adapterList.map((adapter) => [adapter.track, adapter]));

    const limitsWork = await runProcess(
      { argv: withResourceLimits(["/usr/bin/true"], Runner.limits(config, "run")), cwd: config.workRoot, env: {} },
      Runner.limits(config, "run"),
      new AbortController().signal,
    );
    const limitsOk = limitsWork.termination === "exit" && limitsWork.exitCode === 0;

    const toolchains = {} as Record<ServerTrack, ToolchainStatus>;
    for (const track of SERVER_TRACKS) {
      const adapter = adapters.get(track);
      let status: ToolchainStatus = adapter
        ? await adapter.detect()
        : { available: false, reason: "adapter_not_implemented", detail: `no adapter is registered for ${track}` };
      if (status.available && config.sandbox === "required" && !sandbox.available) {
        status = { ...status, available: false, reason: "sandbox_unavailable", detail: sandbox.detail };
      } else if (status.available && !limitsOk) {
        status = { ...status, available: false, reason: "internal_error", detail: "resource limits could not be applied on this host" };
      }
      toolchains[track] = status;
    }
    return new Runner(config, adapters, toolchains, sandbox);
  }

  private static limits(config: RunnerConfig, phase: ExecutionPhase): ProcessLimits {
    return {
      wallMs: phase === "compile" ? config.compileWallMs : config.runWallMs,
      // Compiling is single-process CPU work bounded by its wall clock.
      cpuSeconds: phase === "compile" ? Math.ceil(config.compileWallMs / 1000) : config.cpuSeconds,
      maxOutputBytes: config.maxOutputBytes,
      maxFileBytes: phase === "compile" ? Math.max(config.maxFileBytes, 256 * 1024 * 1024) : config.maxFileBytes,
      maxOpenFiles: config.maxOpenFiles,
      memoryWatchdogBytes: phase === "compile" ? COMPILE_MEMORY_WATCHDOG_BYTES : config.memoryWatchdogBytes,
      memorySampleMs: config.memorySampleMs,
    };
  }

  health(): HealthReport {
    const { config } = this;
    return {
      status: "ok",
      toolchains: { ...this.toolchains },
      sandbox: {
        kind: this.sandbox.kind,
        available: this.sandbox.available,
        required: config.sandbox === "required",
        detail: this.sandbox.detail,
      },
      queue: {
        running: this.running,
        queued: this.queue.length,
        maxConcurrent: config.maxConcurrent,
        maxQueued: config.maxQueued,
      },
      limits: {
        compileWallMs: config.compileWallMs,
        runWallMs: config.runWallMs,
        cpuSeconds: config.cpuSeconds,
        maxOutputBytes: config.maxOutputBytes,
        maxFileBytes: config.maxFileBytes,
        memoryWatchdogBytes: config.memoryWatchdogBytes,
        maxFiles: config.maxFiles,
        maxSourceBytes: config.maxSourceBytes,
        maxStdinBytes: config.maxStdinBytes,
      },
    };
  }

  /**
   * Validates and enqueues a job. Throws RunnerRequestError for a request that is refused outright
   * (`invalid_request`, `queue_full`). A track whose toolchain is unavailable is accepted and ends
   * immediately as `runner_unavailable`.
   */
  submit(input: unknown): JobSnapshot {
    const request = validateRequest(input, this.config);
    if (this.closed) throw new RunnerRequestError("queue_full", "the runner is shutting down");

    const job = this.createJob(request);
    const toolchain = this.toolchains[request.track];
    if (!toolchain.available) {
      this.finish(job, {
        ...this.base(job),
        ...EMPTY_RESULT,
        status: "runner_unavailable",
        phase: null,
        unavailableReason: toolchain.reason ?? "internal_error",
        message: toolchain.detail,
      });
      return this.snapshot(job);
    }

    this.adapters.get(request.track)!.checkFiles(request.files);
    if (this.running >= this.config.maxConcurrent && this.queue.length >= this.config.maxQueued) {
      throw new RunnerRequestError("queue_full", `the runner already has ${this.queue.length} jobs waiting; try again shortly`);
    }
    this.register(job);
    this.queue.push(job);
    this.pump();
    return this.snapshot(job);
  }

  get(executionId: string): JobSnapshot | undefined {
    const job = this.jobs.get(executionId);
    return job && this.snapshot(job);
  }

  /** Resolves with the final result. Rejects with `not_found` for an unknown or expired id. */
  wait(executionId: string): Promise<ExecutionResult> {
    const job = this.jobs.get(executionId);
    if (!job) return Promise.reject(new RunnerRequestError("not_found", `no job ${executionId}`));
    return job.done;
  }

  /**
   * Stops a job: a queued job never starts; a compiling or running job has its whole process group
   * killed. The job then ends as `cancelled`. Returns undefined for an unknown id; a finished job is unchanged.
   */
  cancel(executionId: string): JobSnapshot | undefined {
    const job = this.jobs.get(executionId);
    if (!job) return undefined;
    const queuedAt = this.queue.indexOf(job);
    if (queuedAt !== -1) {
      this.queue.splice(queuedAt, 1);
      this.finish(job, { ...this.base(job), ...EMPTY_RESULT, status: "cancelled", phase: null });
    } else if (!job.result) {
      job.abort.abort();
    }
    return this.snapshot(job);
  }

  /** Cancels everything and waits until every process is gone and every workspace removed. */
  async close(): Promise<void> {
    this.closed = true;
    const pending = [...this.jobs.values()].filter((job) => !job.result);
    for (const job of pending) this.cancel(job.id);
    await Promise.all(pending.map((job) => job.done));
  }

  // ---------- internals ----------

  private createJob(request: ValidatedRequest): Job {
    let settle!: (result: ExecutionResult) => void;
    const done = new Promise<ExecutionResult>((resolve) => {
      settle = resolve;
    });
    const job: Job = { id: randomUUID(), request, status: "queued", abort: new AbortController(), done, settle };
    return job;
  }

  private register(job: Job): void {
    this.jobs.set(job.id, job);
    // Forget the oldest finished results; unfinished jobs are never dropped.
    for (const [id, other] of this.jobs) {
      if (this.jobs.size <= this.config.maxRetainedResults) break;
      if (other.result) this.jobs.delete(id);
    }
  }

  private base(job: Job) {
    return {
      executionId: job.id,
      projectId: job.request.projectId,
      revision: job.request.revision,
      track: job.request.track,
    };
  }

  private snapshot(job: Job): JobSnapshot {
    return { ...this.base(job), status: job.status, result: job.result };
  }

  private finish(job: Job, result: ExecutionResult): void {
    job.status = result.status;
    job.result = result;
    if (!this.jobs.has(job.id)) this.register(job);
    job.settle(result);
  }

  private pump(): void {
    while (this.running < this.config.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.running++;
      void this.execute(job)
        .catch((error: unknown): ExecutionResult => ({
          ...this.base(job),
          ...EMPTY_RESULT,
          status: "runner_unavailable",
          phase: null,
          unavailableReason: "internal_error",
          message: error instanceof Error ? error.message : String(error),
        }))
        .then((result) => {
          this.running--;
          this.finish(job, result);
          this.pump();
        });
    }
  }

  private async execute(job: Job): Promise<ExecutionResult> {
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);
    const { request } = job;
    const adapter = this.adapters.get(request.track)!;
    const base = this.base(job);

    // mkdtemp gives every job its own unpredictable directory with mode 0700.
    const workspace = await mkdtemp(join(this.config.workRoot, "ytl-job-"));
    const paths: JobPaths = { workspace, src: join(workspace, "src"), out: join(workspace, "out"), tmp: join(workspace, "tmp") };
    try {
      await Promise.all([mkdir(paths.src), mkdir(paths.out), mkdir(paths.tmp)]);
      for (const file of request.files) {
        const target = resolveInside(paths.src, file.path);
        await mkdir(dirname(target), { recursive: true });
        // wx: fail rather than follow or overwrite anything already there.
        await writeFile(target, file.content, { flag: "wx" });
      }

      // The whole environment of the job. Nothing from the runner's own environment is passed on.
      const env = { PATH: "/usr/bin:/bin", HOME: paths.tmp, TMPDIR: paths.tmp, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" };
      const start = (phase: ExecutionPhase, command: { argv: string[]; env?: Record<string, string> }, stdin?: string) => {
        const limits = Runner.limits(this.config, phase);
        // Limits first, sandbox second: the rlimits are inherited, and the sandboxed side then only
        // ever executes the job's own command.
        const sandboxed =
          this.config.sandbox === "required"
            ? this.sandbox.wrap(phase, workspace, this.config.workRoot, command.argv, adapter.runtimeRoots())
            : command.argv;
        const argv = withResourceLimits(sandboxed, limits);
        return runProcess({ argv, cwd: paths.src, env: { ...env, ...command.env }, stdin }, limits, job.abort.signal);
      };

      let compileMs: number | undefined;
      let compilerOutput = "";
      let compilerOutputTruncated = false;
      let diagnostics: CodeDiagnostic[] = [];

      // Problems visible in the files themselves end the job before any tool runs.
      const found = adapter.preflight?.(request.files) ?? [];
      if (found.some((diagnostic) => diagnostic.severity === "error")) {
        return {
          ...base,
          ...EMPTY_RESULT,
          status: "error",
          phase: "compile",
          compilerOutput: found.map((diagnostic) => `${diagnostic.severity}: ${diagnostic.message}`).join("\n"),
          diagnostics: found,
          elapsedMs: elapsed(),
        };
      }
      await adapter.prepare?.(request.files, paths);

      const compileCommand = adapter.compileCommand(request.files, paths);
      if (compileCommand) {
        job.status = "compiling";
        const compiled = await start("compile", compileCommand);
        compileMs = compiled.elapsedMs;
        // The compiler names files as the learner did; where it prints an absolute path of the
        // job's workspace (the linker does), show the project-relative form instead.
        compilerOutput = [compiled.stderr, compiled.stdout]
          .filter(Boolean)
          .join("\n")
          .replaceAll(`${paths.src}/`, "")
          .replaceAll(`${workspace}/`, "");
        compilerOutputTruncated = compiled.stderrTruncated || compiled.stdoutTruncated;
        diagnostics = adapter.parseDiagnostics(compilerOutput);

        const failed = this.failure(compiled);
        if (failed) {
          return {
            ...base,
            ...EMPTY_RESULT,
            ...failed,
            phase: "compile",
            compilerOutput,
            compilerOutputTruncated,
            diagnostics,
            elapsedMs: elapsed(),
            compileMs,
          };
        }
      }

      job.status = "running";
      const ran = await start("run", adapter.runCommand(request.files, paths), request.stdin);
      const failed = this.failure(ran);
      if (failed?.status === "error") {
        // The language's own report of an uncaught exception, else the bare fact of a fatal signal.
        const thrown = adapter.parseRuntimeDiagnostics?.(ran.stderr, request.files) ?? [];
        if (thrown.length > 0) diagnostics = [...diagnostics, ...thrown];
        else if (ran.signal) diagnostics = [...diagnostics, { severity: "error", message: `The program was terminated by ${ran.signal}`, source: "runtime" }];
      }
      return {
        ...base,
        status: "success",
        ...failed,
        phase: "run",
        stdout: ran.stdout,
        stderr: ran.stderr,
        stdoutTruncated: ran.stdoutTruncated,
        stderrTruncated: ran.stderrTruncated,
        compilerOutput,
        compilerOutputTruncated,
        diagnostics,
        elapsedMs: elapsed(),
        compileMs,
        runMs: ran.elapsedMs,
        exitCode: ran.exitCode ?? undefined,
        signal: ran.signal ?? undefined,
      };
    } finally {
      await this.removeWorkspace(workspace);
    }
  }

  /** The non-success part of a result for a finished process, or null when it exited with code 0. */
  private failure(outcome: ProcessOutcome): Pick<ExecutionResult, "status" | "exitCode" | "signal" | "unavailableReason" | "message"> | null {
    if (outcome.termination === "spawn_error") {
      return { status: "runner_unavailable", unavailableReason: "internal_error", message: outcome.spawnError };
    }
    if (outcome.termination !== "exit") {
      const status: FinalExecutionStatus = TERMINATION_STATUS[outcome.termination];
      return { status };
    }
    if (outcome.exitCode === 0) return null;
    return { status: "error", exitCode: outcome.exitCode ?? undefined, signal: outcome.signal ?? undefined };
  }

  private async removeWorkspace(workspace: string): Promise<void> {
    try {
      await rm(workspace, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // The program may have removed its own write permission from a directory.
      await new Promise<void>((resolve) => execFile("/bin/chmod", ["-R", "u+rwx", workspace], () => resolve()));
      await rm(workspace, { recursive: true, force: true, maxRetries: 3 }).catch((error: unknown) => {
        console.error(`runner: could not remove workspace ${workspace}:`, error);
      });
    }
  }
}
