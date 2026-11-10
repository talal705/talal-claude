// Checks a provider's answer before any of it leaves the server. The model is not trusted:
// whatever does not fit the contract is dropped, and a target is kept only if the request allowed it.
import { TUTOR_LIMITS, type TutorConfidence } from "./contract";
import { clip, type TutorEvidence } from "./evidence";
import { TutorProviderError } from "./provider";

const CONFIDENCES: readonly TutorConfidence[] = ["certain", "likely", "possible"];

export interface ValidatedAnswer {
  text: string;
  targetId?: string;
  confidence: TutorConfidence;
}

/** Plain text: control and direction-override characters removed (newlines kept), whitespace tidied, cut to length. */
export function answerText(value: unknown): string {
  if (typeof value !== "string") return "";
  const cleaned = value
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clip(cleaned, TUTOR_LIMITS.maxAnswerLength);
}

/**
 * The answer that may be sent to the browser: exactly a text, a confidence label and, at most, one
 * of the targets the request allowed. Throws `invalid_output` when there is no usable text.
 */
export function validateAnswer(answer: unknown, evidence: TutorEvidence): ValidatedAnswer {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) {
    throw new TutorProviderError("invalid_output", "the answer is not an object");
  }
  const raw = answer as Record<string, unknown>;
  const text = answerText(raw.answer);
  if (text === "") throw new TutorProviderError("invalid_output", "the answer has no text");
  const validated: ValidatedAnswer = {
    text,
    // Anything but the three labels is the weakest one.
    confidence: (CONFIDENCES as readonly unknown[]).includes(raw.confidence) ? (raw.confidence as TutorConfidence) : "possible",
  };
  if (typeof raw.target_id === "string" && evidence.allowedTargets.has(raw.target_id)) validated.targetId = raw.target_id;
  return validated;
}
