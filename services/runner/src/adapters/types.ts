import { execFile } from "node:child_process";
import type { CodeDiagnostic, ServerTrack, ToolchainStatus } from "../contract.ts";
import type { WorkspaceFile } from "../paths.ts";

/** Real (symlink-free) directories of one job. */
export interface JobPaths {
  workspace: string;
  /** The learner's files; working directory of both phases. */
  src: string;
  /** Build products. */
  out: string;
  tmp: string;
}

export interface AdapterCommand {
  /** Program and arguments. Built from validated file paths only, never from file contents. */
  argv: string[];
  /** Added to the job's base environment. */
  env?: Record<string, string>;
}

export interface LanguageAdapter {
  readonly track: ServerTrack;
  /** Probes the host once at startup by really running the toolchain. */
  detect(): Promise<ToolchainStatus>;
  /** Track-specific checks at submit time; throws RunnerRequestError("invalid_request"). */
  checkFiles(files: WorkspaceFile[]): void;
  /**
   * Real paths of the toolchain's own installation (a JDK, the .NET SDK). Jobs of this track may
   * read and execute files under them; that is the only widening of the sandbox a track gets.
   * Empty for a toolchain in the system locations the sandbox already allows.
   */
  runtimeRoots(): string[];
  /** Problems found by reading the files, before anything is compiled (e.g. no entry point). Errors end the job. */
  preflight?(files: WorkspaceFile[]): CodeDiagnostic[];
  /** Writes files the build needs next to the learner's (never among them): response files, runtime settings. */
  prepare?(files: WorkspaceFile[], paths: JobPaths): Promise<void>;
  /** `null` for a track without a compile step. */
  compileCommand(files: WorkspaceFile[], paths: JobPaths): AdapterCommand | null;
  runCommand(files: WorkspaceFile[], paths: JobPaths): AdapterCommand;
  parseDiagnostics(compilerOutput: string): CodeDiagnostic[];
  /** Reads an uncaught exception out of the program's stderr after a failed run. */
  parseRuntimeDiagnostics?(stderr: string, files: WorkspaceFile[]): CodeDiagnostic[];
}

export interface ProbeResult {
  ok: boolean;
  /** stdout and stderr together; tools disagree on where they print their version. */
  output: string;
  /** The program does not exist (ENOENT), as opposed to existing and failing. */
  missing: boolean;
}

/** Runs a toolchain probe such as `javac -version`. Never throws. */
export function probe(command: string, args: string[]): Promise<ProbeResult> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 10_000 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        output: `${stdout}${stderr}`.trim(),
        missing: (error as NodeJS.ErrnoException | null)?.code === "ENOENT",
      });
    });
  });
}

/** The project file a compiler or stack trace means by a bare file name, when exactly one file has that name. */
export function fileByBaseName(files: readonly WorkspaceFile[], baseName: string): string | undefined {
  const matches = files.filter((file) => file.path === baseName || file.path.endsWith(`/${baseName}`));
  return matches.length === 1 ? matches[0].path : undefined;
}

export function firstLine(text: string): string {
  return text.split("\n", 1)[0].trim();
}
