// Validation of an execution request body before it is forwarded. The runner validates again and is
// the authority; checking here gives the learner an answer without a round trip and keeps junk off the runner.
import { SERVER_TRACKS, isValidCodeFileName, type CodeFile, type ExecutionRequest, type ServerTrack } from "@ytl/contracts";

export const EXECUTION_LIMITS = {
  maxFiles: 32,
  /** All file contents together, in bytes. */
  maxSourceBytes: 1024 * 1024,
  maxStdinBytes: 256 * 1024,
  /** Request body. Above the limits above plus JSON escaping overhead. */
  maxBodyBytes: 4 * 1024 * 1024,
} as const;

export interface ValidExecutionRequest extends ExecutionRequest {
  track: ServerTrack;
}

export type ValidationOutcome = { ok: true; request: ValidExecutionRequest } | { ok: false; message: string };

function fail(message: string): ValidationOutcome {
  return { ok: false, message };
}

/** Returns a copy holding only the contract's fields; anything else in the body is dropped. */
export function validateExecutionRequest(body: unknown): ValidationOutcome {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return fail("the request body must be a JSON object");
  const input = body as Record<string, unknown>;

  if (typeof input.projectId !== "string" || input.projectId.length === 0 || input.projectId.length > 100) {
    return fail("projectId must be a string of 1 to 100 characters");
  }
  if (typeof input.revision !== "number" || !Number.isInteger(input.revision) || input.revision < 1) {
    return fail("revision must be an integer >= 1");
  }
  if (!(SERVER_TRACKS as readonly unknown[]).includes(input.track)) {
    return fail(`track must be one of ${SERVER_TRACKS.join(", ")}; the other tracks run in the browser`);
  }
  if (input.stdin !== undefined && typeof input.stdin !== "string") return fail("stdin must be a string");
  if (typeof input.stdin === "string" && Buffer.byteLength(input.stdin) > EXECUTION_LIMITS.maxStdinBytes) {
    return fail(`stdin is larger than ${EXECUTION_LIMITS.maxStdinBytes} bytes`);
  }
  if (!Array.isArray(input.files) || input.files.length === 0) return fail("files must be a non-empty array");
  if (input.files.length > EXECUTION_LIMITS.maxFiles) return fail(`at most ${EXECUTION_LIMITS.maxFiles} files are accepted`);

  const files: CodeFile[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const [index, entry] of input.files.entries()) {
    if (typeof entry !== "object" || entry === null) return fail("each file must be an object");
    const file = entry as Record<string, unknown>;
    if (!isValidCodeFileName(file.name)) {
      return fail(
        `file name ${JSON.stringify(file.name)} is not allowed: use a relative path of letters, digits, "_", "-" and "." ` +
          'separated by "/", with no "..", no leading "/" and no segment starting with "." or "-"',
      );
    }
    if (typeof file.content !== "string") return fail(`file "${file.name}" has no string content`);
    const key = file.name.toLowerCase();
    if (seen.has(key)) return fail(`file "${file.name}" is submitted twice`);
    seen.add(key);
    totalBytes += Buffer.byteLength(file.content);
    if (totalBytes > EXECUTION_LIMITS.maxSourceBytes) {
      return fail(`files are larger than ${EXECUTION_LIMITS.maxSourceBytes} bytes in total`);
    }
    files.push({
      id: typeof file.id === "string" ? file.id.slice(0, 100) : `file-${index}`,
      name: file.name,
      language: input.track as ServerTrack,
      content: file.content,
      order: typeof file.order === "number" && Number.isFinite(file.order) ? file.order : index,
    });
  }

  return {
    ok: true,
    request: {
      projectId: input.projectId,
      revision: input.revision,
      track: input.track as ServerTrack,
      files,
      ...(typeof input.stdin === "string" ? { stdin: input.stdin } : {}),
    },
  };
}
