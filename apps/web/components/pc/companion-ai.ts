// Typed questions to the site's AI tutor (POST /api/tutor/ask), when the server has a provider.
// The provider key stays on the server; the page sends only the question and a plain description of
// the build. Any failure falls back to the companion's built-in answers.
import type { TutorAskRequest, TutorAskResponse, TutorStatus } from "@/lib/server/tutor/contract";

export type AiStatus = "available" | "not_configured" | "unknown";

/** `available` only when the server says a provider is configured; anything else keeps built-in answers. */
export async function fetchTutorStatus(fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<AiStatus> {
  try {
    const response = await fetchImpl("/api/tutor/status", { cache: "no-store", credentials: "same-origin", signal });
    if (!response.ok) return "not_configured";
    const body = (await response.json()) as Partial<TutorStatus>;
    return body.ai === "available" ? "available" : "not_configured";
  } catch {
    return "unknown";
  }
}

/**
 * The question, with the build as the only topic the answer may draw on: what is fitted, connected
 * and next (from `buildContext`), and the companion's own instruction for the next step.
 */
export function companionAskRequest(question: string, locale: "en" | "ar", context: string, nextStep: string): TutorAskRequest {
  return {
    version: 1,
    lab: "shell",
    locale,
    context: {},
    question: question.slice(0, 300),
    topics: [{ id: "pc.simple.build", title: "Build your PC", revealedLevels: 2, levels: [{ text: context.slice(0, 800) }, { text: nextStep.slice(0, 800) }] }],
    allowedTargets: [],
  };
}

export async function askCompanionAi(request: TutorAskRequest, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<{ ok: true; text: string } | { ok: false }> {
  try {
    const response = await fetchImpl("/api/tutor/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
    const body = (await response.json().catch(() => null)) as TutorAskResponse | null;
    if (response.ok && body?.status === "ok" && typeof body.answer?.text === "string" && body.answer.text.trim()) return { ok: true, text: body.answer.text.trim() };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}
