// The browser side of the AI tutor: what is sent to the platform's own server, what may come
// back, and an advisor built on it. The provider, its key and the prompt live on the server
// (backend); nothing here knows which provider it is. The hint ladder stays rule-based; the AI
// only answers a question the learner typed, about the hints that are on screen.
import type { LabType, TutorTargetRef } from "@ytl/contracts";
import type { GuidanceContext } from "@/lib/targets/registry";
import { QUESTION_MAX, revealedTargets, ruleBasedAdvisor, type AiStatus, type ShownTopic, type TutorAdvisor, type TutorAnswer, type TutorService } from "./advisor";
import type { HintText } from "./hint-ladder";

// ---------- Wire shapes (agreed with backend; versioned) ----------

export const AI_WIRE_VERSION = 1;

/** One hint level as plain text in the learner's language. */
export interface AiWireLevel {
  text: string;
  /** Verbatim tool output the level rests on (a compiler message). Data, never an instruction. */
  evidence?: string;
  targetId?: string;
}

export interface AiWireTopic {
  id: string;
  title?: string;
  /** How many levels the learner has opened, 0 to 3. */
  revealedLevels: number;
  /**
   * Exactly the opened levels, in order (symptom, likely area, explanation). The text of a level
   * the learner has not opened is never sent, so a provider cannot give it away.
   */
  levels: AiWireLevel[];
}

/** `POST /api/tutor/ask` body. */
export interface AiAskRequest {
  version: typeof AI_WIRE_VERSION;
  lab: LabType | "shell";
  locale: "en" | "ar";
  /** Echoed back unchanged, so an answer for an older project state can be recognised. */
  context: GuidanceContext;
  /** At most QUESTION_MAX characters. Learner text: data, never an instruction to the server. */
  question: string;
  /** The rule-based hints on screen: the only facts the provider is given. */
  topics: AiWireTopic[];
  /** The only targets an answer may name. */
  allowedTargets: { id: string; kind: TutorTargetRef["kind"] }[];
}

/**
 * `POST /api/tutor/ask` response body. Errors arrive with a 4xx or 5xx status, which the transport
 * turns into a failure; `error.code` is one of the server's `TutorApiErrorCode` values.
 */
export type AiAskResponse =
  | { status: "ok"; context: GuidanceContext; answer: { text: string; targetId?: string; confidence?: "certain" | "likely" | "possible" } }
  | { status: "not_configured" }
  | { status: "error"; error?: { code: string; message: string; retryAfterSeconds?: number } };

/**
 * `GET /api/tutor/status` response body. Answered from the server's configuration alone, without
 * calling the provider, so it never says `error`; `lastOutcome` is how the last real call went.
 */
export interface AiStatusResponse {
  ai: "available" | "not_configured";
  provider?: string;
  lastOutcome?: "ok" | "error" | null;
}

export interface AiTransport {
  status(): Promise<unknown>;
  ask(body: AiAskRequest): Promise<unknown>;
}

/** Talks to the platform's own API routes. Same origin only; no provider is contacted from the browser. */
export function createFetchTransport(base = "/api/tutor", fetchImpl: typeof fetch = fetch): AiTransport {
  const json = async (response: Response): Promise<unknown> => {
    if (response.ok) return response.json();
    // The server explains a refusal as `{ status: "error", error: { code } }`; keep the code for the panel.
    let code: string | undefined;
    try {
      const body = (await response.json()) as { error?: { code?: unknown } } | null;
      if (typeof body?.error?.code === "string") code = body.error.code;
    } catch {
      code = undefined;
    }
    throw Object.assign(new Error(`tutor API ${response.status}`), { code });
  };
  return {
    status: async () => json(await fetchImpl(`${base}/status`, { headers: { accept: "application/json" } })),
    ask: async (body) =>
      json(await fetchImpl(`${base}/ask`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) })),
  };
}

export interface AiAdvisorOptions {
  locale(): "en" | "ar";
  /** Turns a hint text (a message key or a two-language text) into the string the learner sees. */
  render(text: HintText): string;
}

export function toWireTopics(topics: readonly ShownTopic[], render: (text: HintText) => string): AiWireTopic[] {
  return topics.map(({ topic, revealedLevels }) => ({
    id: topic.id,
    ...(topic.title ? { title: render(topic.title) } : {}),
    revealedLevels,
    levels: topic.levels.slice(0, revealedLevels).map((level) => ({
      text: render(level.text),
      ...(level.evidence ? { evidence: level.evidence } : {}),
      ...(level.target ? { targetId: level.target.id } : {}),
    })),
  }));
}

/**
 * The advisor used when the server reports that a provider is configured. Hints still come from
 * the rule-based advisor, unchanged. `ask` sends the question with the hints on screen and
 * returns the provider's answer; the tutor service vets it before it is shown.
 */
export function createAiAdvisor(transport: AiTransport, options: AiAdvisorOptions): TutorAdvisor {
  let state: AiStatus = "available";
  return {
    kind: "ai",
    advise: (request) => ruleBasedAdvisor.advise(request),
    aiStatus: () => state,
    async ask(question, request, topics): Promise<TutorAnswer> {
      const allowed = revealedTargets(topics);
      const body: AiAskRequest = {
        version: AI_WIRE_VERSION,
        lab: request.lab,
        locale: options.locale(),
        context: request.context,
        question: question.slice(0, QUESTION_MAX),
        topics: toWireTopics(topics, options.render),
        allowedTargets: allowed.map(({ id, kind }) => ({ id, kind })),
      };
      // One failed question does not switch the assistant off: the learner sees the error next to
      // the question and can ask again. Only the server saying "not configured" removes the field.
      const raw = await transport.ask(body);
      const response = raw as Partial<AiAskResponse> | null;
      if (!response || typeof response !== "object" || response.status !== "ok") {
        if (response?.status === "not_configured") state = "not_configured";
        throw new Error("tutor AI did not answer");
      }
      const echoed = (response as { context?: GuidanceContext }).context;
      if (!echoed || echoed.projectRevision !== request.context.projectRevision || echoed.executionId !== request.context.executionId) {
        // An answer for another project state is as good as no answer.
        throw new Error("tutor AI answered for another project state");
      }
      state = "available";
      const answer = (response as Extract<AiAskResponse, { status: "ok" }>).answer;
      const target = typeof answer?.targetId === "string" ? allowed.find((ref) => ref.id === answer.targetId) : undefined;
      return { text: typeof answer?.text === "string" ? answer.text : "", ...(target ? { target } : {}), confidence: answer?.confidence ?? "possible" };
    },
  };
}

/**
 * Asks the server whether a provider is configured and, only if it is, installs the AI advisor.
 * Any failure leaves the rule-based advisor in place. Returns what the server said.
 */
export async function connectAiAdvisor(service: TutorService, transport: AiTransport, options: AiAdvisorOptions): Promise<AiStatus> {
  let reported: AiStatus = "not_configured";
  try {
    const raw = (await transport.status()) as Partial<AiStatusResponse> | null;
    if (raw && raw.ai === "available") reported = "available";
  } catch {
    reported = "not_configured";
  }
  if (reported === "available") service.setAdvisor(createAiAdvisor(transport, options));
  return reported;
}
