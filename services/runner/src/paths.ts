// Validation of a submitted job: track, sizes, and above all file paths.
import { resolve, sep } from "node:path";
import type { RunnerConfig } from "./config.ts";
import { RunnerRequestError, SERVER_TRACKS, type ExecutionRequest, type ServerTrack } from "./contract.ts";

export interface WorkspaceFile {
  /** Normalized relative path with `/` separators. */
  path: string;
  content: string;
}

export interface ValidatedRequest {
  projectId: string;
  revision: number;
  track: ServerTrack;
  files: WorkspaceFile[];
  stdin: string;
}

// The rule is defined in @ytl/contracts (isValidCodeFileName, CODE_FILE_NAME_*). The runner keeps its
// own copy because Node runs these sources directly and cannot load that package at runtime;
// runner.test.ts checks that the two agree.
export const MAX_PATH_LENGTH = 200;
export const MAX_DEPTH = 6;
// A segment starts with a letter, digit or underscore, so it is never `.`, `..`, hidden, or an
// option such as `-o` when it reaches a compiler's argument list.
export const SEGMENT_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

function invalid(message: string): never {
  throw new RunnerRequestError("invalid_request", message);
}

/**
 * Returns the normalized relative path, or throws. Rejects absolute paths, `..` and `.` segments,
 * backslashes, empty segments, NUL and any character outside a conservative ASCII set.
 */
export function normalizeFilePath(name: unknown): string {
  if (typeof name !== "string" || name.length === 0) invalid("file name must be a non-empty string");
  if (name.length > MAX_PATH_LENGTH) invalid(`file name is longer than ${MAX_PATH_LENGTH} characters`);
  const segments = name.split("/");
  if (segments.length > MAX_DEPTH) invalid(`file "${name}" is nested deeper than ${MAX_DEPTH} levels`);
  for (const segment of segments) {
    if (!SEGMENT_PATTERN.test(segment)) {
      invalid(
        `file name ${JSON.stringify(name)} is not allowed: use relative paths made of letters, digits, "_", "-" and "." ` +
          'separated by "/", with no "..", no leading "/" and no segment starting with "." or "-"',
      );
    }
  }
  return segments.join("/");
}

/** Absolute location of a validated relative path, checked once more to lie inside `root`. */
export function resolveInside(root: string, relativePath: string): string {
  const absolute = resolve(root, relativePath);
  if (!absolute.startsWith(root + sep)) invalid(`file "${relativePath}" resolves outside the job workspace`);
  return absolute;
}

export function validateRequest(input: unknown, config: RunnerConfig): ValidatedRequest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) invalid("request must be a JSON object");
  const request = input as Partial<ExecutionRequest>;

  if (typeof request.projectId !== "string" || request.projectId.length === 0 || request.projectId.length > 100) {
    invalid("projectId must be a string of 1 to 100 characters");
  }
  if (typeof request.revision !== "number" || !Number.isInteger(request.revision) || request.revision < 1) {
    invalid("revision must be an integer >= 1");
  }
  if (!(SERVER_TRACKS as readonly unknown[]).includes(request.track)) {
    invalid(`track must be one of ${SERVER_TRACKS.join(", ")}; other tracks run in the browser`);
  }
  const stdin = request.stdin ?? "";
  if (typeof stdin !== "string") invalid("stdin must be a string");
  if (Buffer.byteLength(stdin) > config.maxStdinBytes) invalid(`stdin is larger than ${config.maxStdinBytes} bytes`);

  if (!Array.isArray(request.files) || request.files.length === 0) invalid("files must be a non-empty array");
  if (request.files.length > config.maxFiles) invalid(`at most ${config.maxFiles} files are accepted`);

  const files: WorkspaceFile[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of request.files as unknown[]) {
    if (typeof file !== "object" || file === null) invalid("each file must be an object");
    const { name, content } = file as { name?: unknown; content?: unknown };
    const path = normalizeFilePath(name);
    if (typeof content !== "string") invalid(`file "${path}" has no string content`);
    if (content.includes("\0")) invalid(`file "${path}" contains a NUL character`);
    // The host file system may be case-insensitive: Main.cpp and main.cpp would be one file.
    const key = path.toLowerCase();
    if (seen.has(key)) invalid(`file "${path}" is submitted twice`);
    seen.add(key);
    totalBytes += Buffer.byteLength(content);
    if (totalBytes > config.maxSourceBytes) invalid(`files are larger than ${config.maxSourceBytes} bytes in total`);
    files.push({ path, content });
  }
  // A path cannot be both a file and a directory of another file.
  for (const key of seen) {
    for (const other of seen) {
      if (other.startsWith(`${key}/`)) invalid(`"${key}" is used both as a file and as a directory`);
    }
  }

  return {
    projectId: request.projectId,
    revision: request.revision,
    track: request.track as ServerTrack,
    files,
    stdin,
  };
}
