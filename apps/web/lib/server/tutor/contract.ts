// Request and response of the AI tutor API (POST /api/tutor/ask, GET /api/tutor/status).
// The hint ladder is rule-based and deterministic; the AI only answers a question the learner
// typed, about the hints and evidence on screen. Types and constants only: client code may
// `import type` from this file. The browser side of the same shapes is lib/interaction/ai-advisor.ts.
import type { LabType, Locale, TutorTargetKind, TutorTargetRef } from "@ytl/contracts";

export const TUTOR_WIRE_VERSION = 1;

export const TUTOR_LIMITS = {
  maxQuestionLength: 300,
  maxTopics: 12,
  maxAllowedTargets: 60,
  maxDiagnostics: 20,
  /** Longest hint text, evidence string or diagnostic message kept; longer ones are cut. */
  maxTextLength: 800,
  maxBodyBytes: 4 * 1024 * 1024,
  /** Longest answer returned. */
  maxAnswerLength: 1200,
} as const;

/** One level of a hint that is on screen, as the learner reads it. */
export interface TutorWireLevel {
  text: string;
  /** Verbatim output of the lab's own engine that the level rests on. */
  evidence?: string;
  targetId?: string;
}

export interface TutorWireTopic {
  id: string;
  title?: string;
  /** How many of the topic's three levels the learner has opened, 0 to 3. */
  revealedLevels: number;
  /**
   * Exactly the opened levels, in order (symptom, likely area, explanation). A level the learner
   * has not opened is not sent, so the provider cannot give it away.
   */
  levels: TutorWireLevel[];
}

/** One deterministic finding in a lab-neutral form, built from a PCDiagnostic or a NetworkDiagnostic. Optional extra evidence. */
export interface TutorEvidenceDiagnostic {
  /** Unique within the request. */
  id: string;
  severity: "blocking" | "error" | "warning" | "info";
  /** The simulator's own code, e.g. `required_power_missing`. */
  code?: string;
  message: string;
  /** The deterministic rule behind it, when the lab has one. */
  explanation?: string;
  /** Stamped with the state it was made for; a stamp that differs from `context` rejects the request as stale. */
  target?: TutorTargetRef;
}

export interface TutorAskRequest {
  version: typeof TUTOR_WIRE_VERSION;
  /** The two labs of the product (Code Studio was removed on 2026-10-27), or a page outside them. */
  lab: Exclude<LabType, "code"> | "shell";
  /** Language of the answer. */
  locale: Locale;
  /** The project state the question is about. Echoed back unchanged. */
  context: { projectRevision?: number; executionId?: string };
  /** The learner's question. */
  question: string;
  /** The rule-based hints on screen. */
  topics: TutorWireTopic[];
  /** The only targets an answer may name. */
  allowedTargets: { id: string; kind: TutorTargetKind }[];
  /** Optional: the findings behind the hints. */
  diagnostics?: TutorEvidenceDiagnostic[];
}

export type TutorConfidence = "certain" | "likely" | "possible";

export type TutorApiErrorCode =
  | "invalid_request"
  | "unsupported_media_type"
  | "payload_too_large"
  | "forbidden_origin"
  /** The evidence is for another revision or run than `context` says, or the run is not this session's. */
  | "stale_evidence"
  | "rate_limited"
  /** The token allowance for today is used up (this session's, or the site's). */
  | "budget_exhausted"
  | "provider_unavailable"
  | "provider_timeout"
  /** The provider declined to answer. */
  | "provider_refused"
  /** The provider answered with something that is not a valid answer. Nothing of it is passed on. */
  | "invalid_model_output"
  | "server_misconfigured";

/**
 * `ok` and `not_configured` are sent with HTTP 200. `error` is sent with a 4xx or 5xx status and
 * says why in `error.code`; the learner keeps the rule-based hints in every case.
 */
export type TutorAskResponse =
  | { status: "ok"; context: TutorAskRequest["context"]; answer: { text: string; targetId?: string; confidence: TutorConfidence } }
  | { status: "not_configured" }
  | { status: "error"; error: { code: TutorApiErrorCode; message: string; retryAfterSeconds?: number } };

/** `GET /api/tutor/status`. Answering it never calls the provider. */
export interface TutorStatus {
  /** `available` means a provider is configured, not that it has been reached. */
  ai: "available" | "not_configured";
  provider?: string;
  /** Outcome of the most recent provider call on this server, if there was one. */
  lastOutcome: "ok" | "error" | null;
}
