// HTTP API of the runner. Meant to be called by the web app's server, not by browsers:
//   GET    /health            toolchains, sandbox, queue and limits
//   POST   /jobs              submit an ExecutionRequest -> 202 JobSnapshot
//   GET    /jobs/:id          JobSnapshot; add ?wait=1 to hold the response until the job has finished
//   DELETE /jobs/:id          Stop: cancel the job, wait for its processes to die -> final JobSnapshot
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { RunnerRequestError } from "./contract.ts";
import type { Runner } from "./runner.ts";

export interface HttpOptions {
  /** When set, every /jobs request must send `Authorization: Bearer <token>`. */
  token?: string;
  /** Accepted Host header names (without port). Guards against DNS rebinding from a web page. */
  allowedHosts?: string[];
  /** Largest request body; must exceed the runner's source and stdin limits plus JSON overhead. */
  maxBodyBytes?: number;
}

const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(text);
}

function readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new HttpError(413, "payload_too_large", `request body is larger than ${maxBytes} bytes`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "invalid_request", "request body is not valid JSON"));
      }
    });
  });
}

function hostName(header: string | undefined): string {
  if (!header) return "";
  // Strip the port; an IPv6 literal keeps its brackets.
  return header.replace(/:\d+$/, "").toLowerCase();
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const REQUEST_ERROR_STATUS = { invalid_request: 400, queue_full: 429, not_found: 404 } as const;

export function createRunnerServer(runner: Runner, options: HttpOptions = {}): Server {
  const allowedHosts = options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!allowedHosts.includes(hostName(request.headers.host))) {
      throw new HttpError(403, "forbidden_host", "this Host header is not accepted");
    }
    // No CORS headers are ever sent, and a browser page is refused outright.
    if (request.headers.origin !== undefined) {
      throw new HttpError(403, "forbidden_origin", "the runner does not accept requests from browsers");
    }
    const url = new URL(request.url ?? "/", "http://runner.invalid");
    const method = request.method ?? "GET";

    if (url.pathname === "/health") {
      if (method !== "GET") throw new HttpError(405, "method_not_allowed", "use GET");
      send(response, 200, runner.health());
      return;
    }

    const match = /^\/jobs(?:\/([0-9a-f-]{36}))?$/.exec(url.pathname);
    if (!match) throw new HttpError(404, "not_found", "no such endpoint");
    if (options.token && !tokenMatches(request.headers.authorization, options.token)) {
      throw new HttpError(401, "unauthorized", "a valid bearer token is required");
    }
    const id = match[1];

    if (id === undefined) {
      if (method !== "POST") throw new HttpError(405, "method_not_allowed", "use POST");
      if (!/^application\/json\b/i.test(request.headers["content-type"] ?? "")) {
        throw new HttpError(415, "unsupported_media_type", "send application/json");
      }
      send(response, 202, runner.submit(await readJson(request, maxBodyBytes)));
      return;
    }

    if (method === "GET") {
      if (url.searchParams.get("wait") === "1") await runner.wait(id);
      const snapshot = runner.get(id);
      if (!snapshot) throw new RunnerRequestError("not_found", `no job ${id}`);
      send(response, 200, snapshot);
      return;
    }
    if (method === "DELETE") {
      if (!runner.cancel(id)) throw new RunnerRequestError("not_found", `no job ${id}`);
      await runner.wait(id);
      send(response, 200, runner.get(id));
      return;
    }
    throw new HttpError(405, "method_not_allowed", "use GET or DELETE");
  }

  return createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof HttpError) {
        send(response, error.status, { error: { code: error.code, message: error.message } });
      } else if (error instanceof RunnerRequestError) {
        send(response, REQUEST_ERROR_STATUS[error.code], { error: { code: error.code, message: error.message } });
      } else {
        console.error("runner: unexpected error", error);
        send(response, 500, { error: { code: "internal_error", message: "unexpected runner error" } });
      }
    });
  });
}
