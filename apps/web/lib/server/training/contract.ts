// The training API of the "How websites work" track: what the learner's page sends, what comes
// back, and the trace of what happened on the way. Types and constants only: client code may
// `import type` from this file.

/** One request from the learner's page, as it leaves the preview. */
export interface TrainingRequest {
  /** The learner's project; its training store is separate from every other project's. */
  projectId: string;
  /** One preview run. Events are tagged with it. */
  runId: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path inside the training API, e.g. `/api/tasks` or `/api/tasks/3`. Never a URL. */
  path: string;
  /** The request body exactly as the page sent it (text), or null. */
  body: string | null;
}

export interface TrainingResponse {
  status: number;
  /** JSON text. */
  body: string;
}

export type TrainingLayer = "frontend" | "request" | "server" | "storage";

export interface TrainingProblem {
  field: string;
  rule: "required" | "too_long" | "duplicate" | "invalid_type";
  /** English text for logs; the view localizes from `field` and `rule`. */
  message: string;
}

export interface TrainingTask {
  id: number;
  title: string;
  done: boolean;
  createdAt: string;
}

/**
 * One thing that happened while a request was handled, in the order it happened. Each is written
 * by the code at the moment it does the thing, so the view can replay the journey as it occurred.
 * `seq` counts from 1 within one request.
 */
export type TrainingEvent = { seq: number; runId: string; layer: TrainingLayer } & (
  // ---- frontend: written in the learner's browser (the workspace), not by the server ----
  /** The page called fetch() for a training path. */
  | { layer: "frontend"; kind: "request_sent"; method: string; path: string; body: string | null }
  /** The page called fetch() for something else; it was not sent anywhere. */
  | { layer: "frontend"; kind: "request_blocked"; url: string }
  /** The page received the response. */
  | { layer: "frontend"; kind: "response_received"; status: number; body: string }
  /** The training API could not be reached (the site's server is down or refused the forwarding); fetch() failed in the page. */
  | { layer: "frontend"; kind: "request_failed"; reason: string }
  // ---- request: the training API received it and read it ----
  | { layer: "request"; kind: "request_received"; method: string; path: string; body: string | null }
  /** The body is not JSON, or not the expected kind of value. Handling stops here. */
  | { layer: "request"; kind: "body_rejected"; reason: "invalid_json" | "not_an_object" | "too_large" }
  // ---- server: routing, rules, the response ----
  | { layer: "server"; kind: "route_matched"; route: string }
  | { layer: "server"; kind: "route_not_found" }
  | { layer: "server"; kind: "validation"; ok: boolean; problems: TrainingProblem[] }
  | { layer: "server"; kind: "response_sent"; status: number; body: string }
  // ---- storage: the training store ----
  | {
      layer: "storage";
      kind: "query";
      operation: "select" | "insert" | "update" | "delete";
      table: "tasks";
      /** What was looked for or written, as shown to the learner. */
      detail: string;
      ok: boolean;
      /** Records read or written by this query. */
      records: TrainingTask[];
      /** Why the store refused, when it did. */
      error?: "store_full" | "not_found";
    }
);

/** An event before it is numbered: what a layer writes when something happens. */
export type TrainingEventBody = TrainingEvent extends infer E ? (E extends unknown ? Omit<E, "seq" | "runId"> : never) : never;

/** What `POST /api/training/request` returns to the workspace. */
export interface TrainingResult {
  response: TrainingResponse;
  /** The request, server and storage events, in order. The workspace adds the frontend ones. */
  events: TrainingEvent[];
}

export const TRAINING_LIMITS = {
  /** Tasks in one project's store. Past this, an insert is refused by the store itself. */
  maxTasks: 50,
  maxTitleLength: 80,
  /** Request body accepted by the training API. */
  maxBodyBytes: 4 * 1024,
  /** Stores kept in memory over all sessions; the least recently used is dropped first. */
  maxStores: 2_000,
  /** A store unused this long is dropped. */
  storeIdleMs: 2 * 60 * 60 * 1000,
  /** Requests per minute for one guest session. */
  requestsPerMinute: 120,
} as const;

/** The whole journey of one request, as the workspace reports it: frontend events around the server's. */
export interface TrainingJourney {
  runId: string;
  /** Counts the page's training requests within the run, from 1. */
  requestNumber: number;
  events: TrainingEvent[];
}

/** Paths the learner's page may request. The same rule on both ends of the channel. */
export const TRAINING_PATH_PATTERN = /^\/api\/[A-Za-z0-9/_-]{0,200}$/;
