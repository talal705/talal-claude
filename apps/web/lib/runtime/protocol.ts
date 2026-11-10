// Messages a sandbox (frame or worker) sends to the page. Everything arriving from a sandbox is
// produced next to learner code, so it is untrusted: a message is used only if it has exactly the
// expected shape and carries the execution ID of the run it was opened for.

export const PROTOCOL_VERSION = 1;

/** Upper bound for one message's text; larger messages are dropped rather than buffered. */
export const MAX_MESSAGE_TEXT = 1024 * 1024;

export type SandboxMessage =
  /** The program is about to start. */
  | { type: "ready" }
  | { type: "output"; stream: "stdout" | "stderr"; text: string }
  /** An uncaught error. `stack` uses project file names where the sandbox could map them. */
  | { type: "error"; name: string; message: string; stack: string }
  /** A runtime is being downloaded and started inside the sandbox. */
  | { type: "loading"; loading: boolean }
  /** The program ended by itself. */
  | { type: "done"; exitCode: number }
  /** A page preview called fetch() for a training API path ("How websites work" track). */
  | { type: "api_request"; requestId: number; method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; body: string | null }
  /** A page preview called fetch() for anything else. Nothing was sent. */
  | { type: "api_blocked"; url: string };

const API_METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;
/** The largest request body a preview may hand to the training channel. */
export const MAX_API_BODY = 4 * 1024;

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_MESSAGE_TEXT;
}

/** The message, or null if it is not a valid message for this execution. */
export function parseSandboxMessage(data: unknown, executionId: string): SandboxMessage | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const message = data as Record<string, unknown>;
  if (message.ytl !== PROTOCOL_VERSION || message.executionId !== executionId) return null;
  switch (message.type) {
    case "ready":
      return { type: "ready" };
    case "output":
      if ((message.stream !== "stdout" && message.stream !== "stderr") || !isText(message.text)) return null;
      return { type: "output", stream: message.stream, text: message.text };
    case "error":
      if (!isText(message.name) || !isText(message.message) || !isText(message.stack)) return null;
      return { type: "error", name: message.name, message: message.message, stack: message.stack };
    case "loading":
      if (typeof message.loading !== "boolean") return null;
      return { type: "loading", loading: message.loading };
    case "done":
      if (typeof message.exitCode !== "number" || !Number.isInteger(message.exitCode)) return null;
      return { type: "done", exitCode: message.exitCode };
    case "api_request":
      if (typeof message.requestId !== "number" || !Number.isInteger(message.requestId) || message.requestId < 1) return null;
      if (!(API_METHODS as readonly unknown[]).includes(message.method) || typeof message.path !== "string" || message.path.length > 300) return null;
      if (message.body !== null && (typeof message.body !== "string" || message.body.length > MAX_API_BODY)) return null;
      return { type: "api_request", requestId: message.requestId, method: message.method as (typeof API_METHODS)[number], path: message.path, body: message.body as string | null };
    case "api_blocked":
      if (typeof message.url !== "string") return null;
      return { type: "api_blocked", url: message.url.slice(0, 500) };
    default:
      return null;
  }
}
