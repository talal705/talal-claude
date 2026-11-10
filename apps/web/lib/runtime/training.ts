// The workspace end of the training channel: a page preview's fetch() of a training path arrives
// here over the preview's private port, is forwarded to the site's /api/training/request, and the
// response goes back to the page. The page itself never talks to the network.
import { TRAINING_PATH_PATTERN, type TrainingEvent, type TrainingEventBody, type TrainingJourney, type TrainingResult } from "../server/training/contract";

export interface TrainingForward {
  projectId: string;
  runId: string;
  requestNumber: number;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body: string | null;
}

export type TrainingOutcome =
  | { ok: true; status: number; body: string; journey: TrainingJourney }
  | { ok: false; message: string; journey: TrainingJourney };

/** Numbers the events of one journey from 1, in the order given. */
function numbered(runId: string, events: TrainingEventBody[]): TrainingEvent[] {
  return events.map((event, index) => ({ ...event, seq: index + 1, runId }) as TrainingEvent);
}

/**
 * The journey as the view shows it: the page's request, then everything the training API reports
 * it did, then the page receiving the answer. The server's events keep their order.
 */
export function composeJourney(forward: TrainingForward, result: TrainingResult | null, failure?: string): TrainingJourney {
  const sent = { layer: "frontend" as const, kind: "request_sent" as const, method: forward.method, path: forward.path, body: forward.body };
  const middle = (result?.events ?? []).map(({ seq: _seq, runId: _runId, ...event }) => event as TrainingEventBody);
  const end = result
    ? { layer: "frontend" as const, kind: "response_received" as const, status: result.response.status, body: result.response.body }
    : { layer: "frontend" as const, kind: "request_failed" as const, reason: failure ?? "unknown" };
  return { runId: forward.runId, requestNumber: forward.requestNumber, events: numbered(forward.runId, [sent, ...middle, end]) };
}

/** A journey for a fetch() the workspace refused to forward. */
export function blockedJourney(runId: string, requestNumber: number, url: string): TrainingJourney {
  return { runId, requestNumber, events: numbered(runId, [{ layer: "frontend", kind: "request_blocked", url }]) };
}

export function isTrainingPath(path: string): boolean {
  return TRAINING_PATH_PATTERN.test(path) && !path.includes("//");
}

function isResult(value: unknown): value is TrainingResult {
  const result = value as TrainingResult | null;
  return (
    typeof result === "object" &&
    result !== null &&
    typeof result.response?.status === "number" &&
    typeof result.response?.body === "string" &&
    Array.isArray(result.events)
  );
}

/** Sends one page request to the site's training API. Never throws. */
export async function forwardTrainingRequest(forward: TrainingForward, fetchImpl: typeof fetch = fetch): Promise<TrainingOutcome> {
  let response: Response;
  try {
    response = await fetchImpl("/api/training/request", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: forward.projectId, runId: forward.runId, method: forward.method, path: forward.path, body: forward.body }),
    });
  } catch {
    const message = "The training API could not be reached.";
    return { ok: false, message, journey: composeJourney(forward, null, "unreachable") };
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isResult(payload)) {
    const code = (payload as { error?: { code?: unknown } } | null)?.error?.code;
    const reason = typeof code === "string" ? code : `http_${response.status}`;
    return { ok: false, message: `The training API refused the request (${reason}).`, journey: composeJourney(forward, null, reason) };
  }
  return { ok: true, status: payload.response.status, body: payload.response.body, journey: composeJourney(forward, payload) };
}
