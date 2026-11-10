// A stand-in provider for end-to-end checks in a browser when no real key exists. It calls
// nothing and answers from the request it was given, so a test can predict every answer.
// It is reachable only with AI_PROVIDER=fake together with YTL_DEV_PAGES=1 (see anthropic.ts).
import { TutorProviderError, type TutorCompletion, type TutorCompletionRequest, type TutorProvider } from "./provider";

/** Put one of these words in the question to get that behaviour instead of a normal answer. */
export const FAKE_MARKERS = {
  /** The provider declines: the route answers 422 `provider_refused`. */
  refusal: "fake-refusal",
  /** The provider never answers: the route answers 504 `provider_timeout` after its timeout. */
  timeout: "fake-timeout",
  /** The provider returns something that is not an answer: the route answers 502 `invalid_model_output`. */
  outOfContract: "fake-out-of-contract",
  /** The answer names a well-formed target the request did not allow, plus fields outside the contract: both are dropped. */
  badTarget: "fake-bad-target",
} as const;

export const FAKE_UNALLOWED_TARGET = "shell:ui:fake-not-allowed";

interface SeenEvidence {
  lab?: unknown;
  locale?: unknown;
  question?: unknown;
  hints?: unknown;
  allowed_targets?: unknown;
}

/** The text a normal answer carries, so a test can compute what to expect. */
export function fakeAnswerText(lab: string, locale: string, questionLength: number, hintCount: number): string {
  return `FAKE TUTOR lab=${lab} locale=${locale} question_length=${questionLength} hints=${hintCount}`;
}

export function createFakeProvider(): TutorProvider {
  return {
    name: "fake",
    async complete(request: TutorCompletionRequest): Promise<TutorCompletion> {
      const evidence = JSON.parse(request.user) as SeenEvidence;
      const question = typeof evidence.question === "string" ? evidence.question : "";
      const usage = { inputTokens: 100, outputTokens: 20 };

      if (question.includes(FAKE_MARKERS.refusal)) throw new TutorProviderError("refused", "the fake provider was asked to refuse");
      if (question.includes(FAKE_MARKERS.timeout)) {
        // Like a provider that hangs: ends only when the tutor gives up and aborts.
        return new Promise<TutorCompletion>((_, reject) => {
          const abort = () => reject(new TutorProviderError("timeout", "the fake provider was asked to hang"));
          if (request.signal.aborted) abort();
          else request.signal.addEventListener("abort", abort, { once: true });
        });
      }
      if (question.includes(FAKE_MARKERS.outOfContract)) return { json: ["this", "is", "not", "an", "answer"], usage };

      const targets = Array.isArray(evidence.allowed_targets) ? (evidence.allowed_targets as { id?: unknown }[]) : [];
      const firstTarget = typeof targets[0]?.id === "string" ? targets[0].id : null;
      const text = fakeAnswerText(String(evidence.lab), String(evidence.locale), question.length, Array.isArray(evidence.hints) ? evidence.hints.length : 0);
      if (question.includes(FAKE_MARKERS.badTarget)) {
        return { json: { answer: text, confidence: "certain", target_id: FAKE_UNALLOWED_TARGET, success: true, html: "<b>not allowed</b>" }, usage };
      }
      return { json: { answer: text, confidence: "likely", target_id: firstTarget }, usage };
    },
  };
}
