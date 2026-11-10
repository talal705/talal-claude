// The AI tutor behind app/api/tutor: session, same-origin check, limits and budget, evidence
// building, the provider call, and validation of what comes back. Server-only.
//
// The hint ladder is rule-based; this service only answers a question the learner typed about the
// hints and evidence on screen. Limits and budgets are kept in this process's memory.
import { createSession, readSession } from "../session";
import { isJsonRequest, isSameOrigin, isSecureRequest, json, readBody } from "../http";
import { TUTOR_LIMITS, type TutorApiErrorCode, type TutorAskResponse, type TutorStatus } from "./contract";
import { buildEvidence, renderEvidence } from "./evidence";
import { validateAnswer } from "./output";
import { ANSWER_SCHEMA, SYSTEM_PROMPT } from "./prompt";
import { TutorProviderError, type TutorProvider } from "./provider";

export interface TutorServiceConfig {
  /** Null when no provider is configured: the routes then answer `not_configured`. */
  provider: TutorProvider | null;
  sessionSecret: string;
  appOrigin?: string;
  /** Requests per window for one session, and for all sessions together. */
  rateLimit: { perSession: number; global: number; windowMs: number };
  /** Tokens (input plus output, as the provider reports them) per UTC day. */
  dailyTokenBudget: { perSession: number; global: number };
  maxOutputTokens: number;
  timeoutMs: number;
  now?: () => number;
}

export const DEFAULT_TUTOR_LIMITS = {
  rateLimit: { perSession: 10, global: 60, windowMs: 60_000 },
  dailyTokenBudget: { perSession: 200_000, global: 5_000_000 },
  maxOutputTokens: 4_000,
  timeoutMs: 30_000,
} as const;

function apiError(status: number, code: TutorApiErrorCode, message: string, retryAfterSeconds?: number): Response {
  const body: TutorAskResponse = { status: "error", error: { code, message, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) } };
  return json(status, body, retryAfterSeconds === undefined ? {} : { "retry-after": String(retryAfterSeconds) });
}

const PROVIDER_ERRORS: Record<TutorProviderError["code"], { status: number; code: TutorApiErrorCode; message: string }> = {
  unavailable: { status: 502, code: "provider_unavailable", message: "The AI tutor could not be reached. The built-in hints still work." },
  timeout: { status: 504, code: "provider_timeout", message: "The AI tutor took too long. The built-in hints still work." },
  rate_limited: { status: 502, code: "provider_unavailable", message: "The AI tutor is busy. The built-in hints still work." },
  // Details of a key or configuration problem stay in the server log.
  auth: { status: 502, code: "provider_unavailable", message: "The AI tutor is not available. The built-in hints still work." },
  bad_request: { status: 502, code: "provider_unavailable", message: "The AI tutor is not available. The built-in hints still work." },
  refused: { status: 422, code: "provider_refused", message: "The AI tutor did not answer this question. The built-in hints still work." },
  invalid_output: { status: 502, code: "invalid_model_output", message: "The AI tutor's answer could not be used. The built-in hints still work." },
};

export interface TutorService {
  ask(request: Request): Promise<Response>;
  status(): Response;
}

export function createTutorService(config: TutorServiceConfig): TutorService {
  const now = config.now ?? Date.now;
  const requests = new Map<string, number[]>();
  let allRequests: number[] = [];
  let budgetDay = "";
  let globalTokens = 0;
  const sessionTokens = new Map<string, number>();
  let lastOutcome: TutorStatus["lastOutcome"] = null;

  /** Token counters restart with each UTC day. */
  function rollDay(): void {
    const day = new Date(now()).toISOString().slice(0, 10);
    if (day === budgetDay) return;
    budgetDay = day;
    globalTokens = 0;
    sessionTokens.clear();
  }

  function retryAfter(times: number[]): number {
    return Math.max(1, Math.ceil((times[0] + config.rateLimit.windowMs - now()) / 1000));
  }

  return {
    async ask(request) {
      if (!isSameOrigin(request, config.appOrigin)) return apiError(403, "forbidden_origin", "This request did not come from the site itself.");
      if (!isJsonRequest(request)) return apiError(415, "unsupported_media_type", "Send the request as application/json.");
      // Before reading the body: without a provider there is nothing to do with it.
      if (config.provider === null) {
        const body: TutorAskResponse = { status: "not_configured" };
        return json(200, body);
      }

      const text = await readBody(request, TUTOR_LIMITS.maxBodyBytes);
      if (text === null) return apiError(413, "payload_too_large", `The request is larger than ${TUTOR_LIMITS.maxBodyBytes} bytes.`);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return apiError(400, "invalid_request", "The request body is not valid JSON.");
      }
      const built = buildEvidence(body);
      if (!built.ok) return apiError(built.code === "stale_evidence" ? 409 : 400, built.code, built.message);
      const { evidence } = built;

      let sessionId = readSession(request, config.sessionSecret);
      const headers: Record<string, string> = {};
      if (sessionId === null) {
        const session = createSession(config.sessionSecret, isSecureRequest(request));
        sessionId = session.id;
        headers["set-cookie"] = session.setCookie;
      }

      const windowStart = now() - config.rateLimit.windowMs;
      const mine = (requests.get(sessionId) ?? []).filter((time) => time > windowStart);
      allRequests = allRequests.filter((time) => time > windowStart);
      if (mine.length >= config.rateLimit.perSession) {
        return apiError(429, "rate_limited", `At most ${config.rateLimit.perSession} tutor requests per minute.`, retryAfter(mine));
      }
      if (allRequests.length >= config.rateLimit.global) {
        return apiError(429, "rate_limited", "The AI tutor is busy for everyone right now. Try again in a moment.", retryAfter(allRequests));
      }
      rollDay();
      if ((sessionTokens.get(sessionId) ?? 0) >= config.dailyTokenBudget.perSession || globalTokens >= config.dailyTokenBudget.global) {
        return apiError(429, "budget_exhausted", "The AI tutor's allowance for today is used up. The built-in hints still work.");
      }
      mine.push(now());
      requests.set(sessionId, mine);
      allRequests.push(now());
      for (const [id, times] of requests) if (times.every((time) => time <= windowStart)) requests.delete(id);

      const timer = new AbortController();
      const timeout = setTimeout(() => timer.abort(), config.timeoutMs);
      try {
        const completion = await config.provider.complete({
          system: SYSTEM_PROMPT,
          user: renderEvidence(evidence),
          schema: ANSWER_SCHEMA,
          maxOutputTokens: config.maxOutputTokens,
          signal: AbortSignal.any([timer.signal, request.signal]),
        });
        // Counted whether or not the answer turns out to be usable: it was paid for.
        const used = Math.max(0, completion.usage.inputTokens) + Math.max(0, completion.usage.outputTokens);
        globalTokens += used;
        sessionTokens.set(sessionId, (sessionTokens.get(sessionId) ?? 0) + used);

        const answer = validateAnswer(completion.json, evidence);
        lastOutcome = "ok";
        const response: TutorAskResponse = { status: "ok", context: evidence.context, answer };
        return json(200, response, headers);
      } catch (error) {
        lastOutcome = "error";
        const code = timer.signal.aborted ? "timeout" : error instanceof TutorProviderError ? error.code : "unavailable";
        // The provider's own message can describe the key or the account; it is logged, not returned.
        console.error(`tutor: provider call failed (${code}):`, error instanceof Error ? error.message : error);
        const mapped = PROVIDER_ERRORS[code];
        return apiError(mapped.status, mapped.code, mapped.message);
      } finally {
        clearTimeout(timeout);
      }
    },

    status() {
      const body: TutorStatus =
        config.provider === null ? { ai: "not_configured", lastOutcome: null } : { ai: "available", provider: config.provider.name, lastOutcome };
      return json(200, body);
    },
  };
}

export function misconfigured(): Response {
  return apiError(500, "server_misconfigured", "The tutor service is not configured on this server.");
}
