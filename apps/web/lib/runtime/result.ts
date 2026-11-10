// Builds the frozen ExecutionResult for browser adapters, so every adapter reports the same way.
import type { CodeDiagnostic, ExecutionRequest, ExecutionResult, UnavailableReason } from "@ytl/contracts";
import type { OutputCollector } from "./output";

export interface ResultFields {
  status: ExecutionResult["status"];
  phase: ExecutionResult["phase"];
  output?: OutputCollector;
  compilerOutput?: string;
  diagnostics?: CodeDiagnostic[];
  elapsedMs: number;
  compileMs?: number;
  runMs?: number;
  exitCode?: number;
  unavailableReason?: UnavailableReason;
  message?: string;
}

export function buildResult(request: ExecutionRequest, executionId: string, fields: ResultFields): ExecutionResult {
  const { output } = fields;
  const result: ExecutionResult = {
    executionId,
    projectId: request.projectId,
    revision: request.revision,
    track: request.track,
    status: fields.status,
    phase: fields.phase,
    // Only what the program itself wrote. Empty when it did not run.
    stdout: output?.text("stdout") ?? "",
    stderr: output?.text("stderr") ?? "",
    stdoutTruncated: output?.truncated.stdout ?? false,
    stderrTruncated: output?.truncated.stderr ?? false,
    compilerOutput: fields.compilerOutput ?? "",
    compilerOutputTruncated: false,
    diagnostics: fields.diagnostics ?? [],
    elapsedMs: Math.round(fields.elapsedMs),
  };
  if (fields.compileMs !== undefined) result.compileMs = Math.round(fields.compileMs);
  if (fields.runMs !== undefined) result.runMs = Math.round(fields.runMs);
  if (fields.exitCode !== undefined) result.exitCode = fields.exitCode;
  if (fields.unavailableReason !== undefined) result.unavailableReason = fields.unavailableReason;
  if (fields.message !== undefined) result.message = fields.message;
  return result;
}

/** A finished `runner_unavailable` result: nothing ran and nothing is printed. */
export function unavailableResult(
  request: ExecutionRequest,
  executionId: string,
  unavailableReason: UnavailableReason,
  message: string,
): ExecutionResult {
  return buildResult(request, executionId, { status: "runner_unavailable", phase: null, elapsedMs: 0, unavailableReason, message });
}

/** One line per diagnostic in the compiler's usual form, for `compilerOutput`. */
export function formatDiagnostics(diagnostics: readonly CodeDiagnostic[]): string {
  return diagnostics
    .map((diagnostic) => {
      const where = diagnostic.file === undefined ? "" : `${diagnostic.file}${diagnostic.line === undefined ? "" : `:${diagnostic.line}:${diagnostic.column ?? 1}`}: `;
      return `${where}${diagnostic.severity}: ${diagnostic.message}`;
    })
    .join("\n");
}
