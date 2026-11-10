// Turns a tutor request into bounded evidence: validated, cut to size, with secrets replaced.
// The model sees only what this file builds.
import { TARGET_ID_PATTERN, type Locale, type TutorTargetKind } from "@ytl/contracts";
import { TUTOR_LIMITS, TUTOR_WIRE_VERSION, type TutorAskRequest, type TutorEvidenceDiagnostic, type TutorWireLevel, type TutorWireTopic } from "./contract";
import { redactSecrets } from "./redact";

const LABS: readonly TutorAskRequest["lab"][] = ["pc", "network", "shell"];
const LOCALES: readonly Locale[] = ["en", "ar"];
const SEVERITIES: readonly TutorEvidenceDiagnostic["severity"][] = ["blocking", "error", "warning", "info"];
const TARGET_KINDS: readonly TutorTargetKind[] = ["ui", "component", "connector", "port", "cable-end", "setting"];
const EXECUTION_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
export interface TutorEvidence {
  lab: TutorAskRequest["lab"];
  locale: Locale;
  /** As sent; echoed back unchanged. */
  context: { projectRevision?: number; executionId?: string };
  question: string;
  topics: TutorWireTopic[];
  /** Every target the answer may name, by ID. */
  allowedTargets: Map<string, TutorTargetKind>;
  diagnostics: TutorEvidenceDiagnostic[];
  /** How many secret-looking values were replaced. */
  redactions: number;
}

export type EvidenceOutcome =
  | { ok: true; evidence: TutorEvidence }
  | { ok: false; code: "invalid_request" | "stale_evidence"; message: string };

const invalid = (message: string): EvidenceOutcome => ({ ok: false, code: "invalid_request", message });
const stale = (message: string): EvidenceOutcome => ({ ok: false, code: "stale_evidence", message });

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/** Cuts text to a length without splitting a surrogate pair. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut}…`;
}

export function buildEvidence(body: unknown): EvidenceOutcome {
  if (!isObject(body)) return invalid("the request body must be a JSON object");
  if (body.version !== TUTOR_WIRE_VERSION) return invalid(`version must be ${TUTOR_WIRE_VERSION}`);
  if (!(LABS as readonly unknown[]).includes(body.lab)) return invalid("lab must be pc, network or shell");
  if (!(LOCALES as readonly unknown[]).includes(body.locale)) return invalid("locale must be en or ar");

  if (!isObject(body.context)) return invalid("context must be an object");
  const context: TutorEvidence["context"] = {};
  if (body.context.projectRevision !== undefined) {
    if (!isPositiveInteger(body.context.projectRevision)) return invalid("context.projectRevision must be an integer >= 1");
    context.projectRevision = body.context.projectRevision;
  }
  if (body.context.executionId !== undefined) {
    if (typeof body.context.executionId !== "string" || !EXECUTION_ID_PATTERN.test(body.context.executionId)) return invalid("context.executionId is not a valid ID");
    context.executionId = body.context.executionId;
  }

  let redactions = 0;
  const clean = (text: string, max: number): string => {
    const redacted = redactSecrets(clip(text, max));
    redactions += redacted.count;
    return redacted.text;
  };

  if (typeof body.question !== "string" || body.question.trim() === "") return invalid("question must be a non-empty string");
  if (body.question.length > TUTOR_LIMITS.maxQuestionLength) return invalid(`question is longer than ${TUTOR_LIMITS.maxQuestionLength} characters`);
  const question = clean(body.question.trim(), TUTOR_LIMITS.maxQuestionLength);

  if (!Array.isArray(body.allowedTargets)) return invalid("allowedTargets must be an array");
  if (body.allowedTargets.length > TUTOR_LIMITS.maxAllowedTargets) return invalid(`at most ${TUTOR_LIMITS.maxAllowedTargets} allowed targets are accepted`);
  const allowedTargets = new Map<string, TutorTargetKind>();
  for (const entry of body.allowedTargets as unknown[]) {
    if (!isObject(entry) || typeof entry.id !== "string" || entry.id.length > 300 || !TARGET_ID_PATTERN.test(entry.id)) return invalid("each allowed target needs a valid target id");
    if (!(TARGET_KINDS as readonly unknown[]).includes(entry.kind)) return invalid("an allowed target has an unknown kind");
    allowedTargets.set(entry.id, entry.kind as TutorTargetKind);
  }

  if (!Array.isArray(body.topics)) return invalid("topics must be an array");
  if (body.topics.length > TUTOR_LIMITS.maxTopics) return invalid(`at most ${TUTOR_LIMITS.maxTopics} topics are accepted`);
  const topics: TutorWireTopic[] = [];
  for (const entry of body.topics as unknown[]) {
    if (!isObject(entry) || typeof entry.id !== "string" || entry.id.length === 0 || entry.id.length > 200) return invalid("each topic needs an id of 1 to 200 characters");
    if (!Array.isArray(entry.levels) || entry.levels.length > 3) return invalid("a topic has at most three levels");
    const revealedLevels = entry.revealedLevels;
    if (typeof revealedLevels !== "number" || !Number.isInteger(revealedLevels) || revealedLevels < 0 || revealedLevels > 3) {
      return invalid("revealedLevels must be an integer from 0 to 3");
    }
    if (entry.levels.length !== revealedLevels) return invalid("a topic must send exactly its revealed levels");
    const topic: TutorWireTopic = { id: entry.id, revealedLevels, levels: [] };
    if (typeof entry.title === "string" && entry.title.trim() !== "") topic.title = clean(entry.title, 200);
    for (const raw of entry.levels as unknown[]) {
      if (!isObject(raw) || typeof raw.text !== "string") return invalid("each level needs a text");
      const level: TutorWireLevel = { text: clean(raw.text, TUTOR_LIMITS.maxTextLength) };
      if (typeof raw.evidence === "string" && raw.evidence !== "") level.evidence = clean(raw.evidence, TUTOR_LIMITS.maxTextLength);
      // A hint may only refer to a target the request allows.
      if (typeof raw.targetId === "string" && allowedTargets.has(raw.targetId)) level.targetId = raw.targetId;
      topic.levels.push(level);
    }
    topics.push(topic);
  }

  const diagnostics: TutorEvidenceDiagnostic[] = [];
  if (body.diagnostics !== undefined) {
    if (!Array.isArray(body.diagnostics)) return invalid("diagnostics must be an array");
    if (body.diagnostics.length > TUTOR_LIMITS.maxDiagnostics) return invalid(`at most ${TUTOR_LIMITS.maxDiagnostics} diagnostics are accepted`);
    const ids = new Set<string>();
    for (const entry of body.diagnostics as unknown[]) {
      if (!isObject(entry)) return invalid("each diagnostic must be an object");
      if (typeof entry.id !== "string" || entry.id.length === 0 || entry.id.length > 200) return invalid("each diagnostic needs an id of 1 to 200 characters");
      if (ids.has(entry.id)) return invalid(`diagnostic id "${clip(entry.id, 60)}" is used twice`);
      ids.add(entry.id);
      if (!(SEVERITIES as readonly unknown[]).includes(entry.severity)) return invalid("diagnostic severity must be blocking, error, warning or info");
      if (typeof entry.message !== "string" || entry.message.trim() === "") return invalid("each diagnostic needs a message");
      const diagnostic: TutorEvidenceDiagnostic = {
        id: entry.id,
        severity: entry.severity as TutorEvidenceDiagnostic["severity"],
        message: clean(entry.message, TUTOR_LIMITS.maxTextLength),
      };
      if (typeof entry.code === "string" && entry.code.length > 0) diagnostic.code = clip(entry.code, 100);
      if (typeof entry.explanation === "string" && entry.explanation.trim() !== "") diagnostic.explanation = clean(entry.explanation, TUTOR_LIMITS.maxTextLength);
      if (entry.target !== undefined) {
        const target = entry.target;
        if (!isObject(target) || typeof target.id !== "string" || target.id.length > 300 || !TARGET_ID_PATTERN.test(target.id)) {
          return invalid("a diagnostic's target must have a valid target id");
        }
        if (!(TARGET_KINDS as readonly unknown[]).includes(target.kind)) return invalid("a diagnostic's target has an unknown kind");
        // A target stamped for another revision or run means this evidence is not from the state the request claims.
        if (target.projectRevision !== undefined && target.projectRevision !== context.projectRevision) {
          return stale(`target ${target.id} was made for revision ${String(target.projectRevision)}, not ${String(context.projectRevision)}`);
        }
        if (target.executionId !== undefined && target.executionId !== context.executionId) return stale(`target ${target.id} was made for another run`);
        diagnostic.target = { id: target.id, kind: target.kind as TutorTargetKind };
      }
      diagnostics.push(diagnostic);
    }
  }

  return { ok: true, evidence: { lab: body.lab as TutorEvidence["lab"], locale: body.locale as Locale, context, question, topics, allowedTargets, diagnostics, redactions } };
}

/** The user message: one JSON object. Learner text appears only as JSON string values. */
export function renderEvidence(evidence: TutorEvidence): string {
  return JSON.stringify(
    {
      locale: evidence.locale,
      lab: evidence.lab,
      question: evidence.question,
      hints: evidence.topics.map((topic) => ({
        id: topic.id,
        title: topic.title ?? null,
        revealed_levels: topic.revealedLevels,
        levels: topic.levels.map((level) => ({ text: level.text, tool_output: level.evidence ?? null, target_id: level.targetId ?? null })),
      })),
      diagnostics: evidence.diagnostics.map((diagnostic) => ({
        id: diagnostic.id,
        severity: diagnostic.severity,
        code: diagnostic.code ?? null,
        message: diagnostic.message,
        explanation: diagnostic.explanation ?? null,
      })),
      allowed_targets: [...evidence.allowedTargets].map(([id, kind]) => ({ id, kind })),
    },
    null,
    1,
  );
}
