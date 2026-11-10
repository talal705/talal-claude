// The seam between the labs and whatever produces guidance. Today that is the rule-based
// advisor below. A server-side AI adapter will implement the same interface later; the panel
// and the ladder do not change when it does.
import type { ConnectivityResult, LabType, NetworkDiagnostic, PCDiagnostic, StartupResult, TutorTargetRef } from "@ytl/contracts";
import { isGuidanceStale, isValidTargetId, type GuidanceContext } from "@/lib/targets/registry";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  MAX_TOPICS,
  topicsFromConnectivity,
  topicsFromNetworkDiagnostics,
  topicsFromPCDiagnostics,
  topicsFromStartup,
} from "./diagnostic-topics";
import { activeTopic, hintLadder, type HintLadderState, type HintLevelContent, type HintTopic } from "./hint-ladder";

/** What a lab hands over. Evidence only: results the simulator already produced. */
export type GuidanceEvidence =
  | { kind: "pc-startup"; result: Pick<StartupResult, "stages" | "advisories"> }
  | { kind: "pc-diagnostics"; diagnostics: readonly PCDiagnostic[] }
  /** The standing check of a network topology (`diagnoseNetwork`). */
  | { kind: "network-diagnostics"; diagnostics: readonly NetworkDiagnostic[] }
  /** A finished virtual ping or name lookup (`runConnectivity`). */
  | { kind: "network-connectivity"; result: Pick<ConnectivityResult, "succeeded" | "diagnostics" | "journey"> }
  /** Topics written by hand (lessons, pages). */
  | { kind: "topics"; topics: readonly HintTopic[] };

export interface GuidanceRequest {
  lab: LabType | "shell";
  /** The active project's revision and, for a run, its execution ID, at the moment of asking. */
  context: GuidanceContext;
  evidence: readonly GuidanceEvidence[];
}

/**
 * `not_configured`: no AI provider is set up; hints are rule-based and the panel says so.
 * `available`: a provider answered a health check. `error`: configured but not reachable.
 */
export type AiStatus = "not_configured" | "available" | "error";

/** An answer to a question the learner typed. Only an AI advisor produces one. */
export interface TutorAnswer {
  /** Plain text in the learner's language. Shown as text, never as markup. */
  text: string;
  /** One thing to point at, taken from the evidence the question was asked about. */
  target?: TutorTargetRef;
  /** How sure the provider says it is. Anything but `certain` is shown as a possibility. */
  confidence: "certain" | "likely" | "possible";
}

export interface TutorAdvisor {
  readonly kind: "rule_based" | "ai";
  /** Never throws for a provider problem: an AI advisor falls back to rule-based topics and reports through `aiStatus`. */
  advise(request: GuidanceRequest): Promise<readonly HintTopic[]>;
  aiStatus(): AiStatus;
  /**
   * Answers a question about the topics on screen. Absent on the rule-based advisor: it never
   * pretends to converse. Rejects when the provider fails; the service turns that into an error state.
   */
  ask?(question: string, request: GuidanceRequest, topics: readonly ShownTopic[]): Promise<TutorAnswer>;
}

/** A topic as the learner sees it: only its first `revealedLevels` levels have been shown. */
export interface ShownTopic {
  topic: HintTopic;
  revealedLevels: number;
}

/** Targets of the revealed levels only: an answer may not point where the learner has not been told to look. */
export function revealedTargets(shown: readonly ShownTopic[]): TutorTargetRef[] {
  const seen = new Set<string>();
  const refs: TutorTargetRef[] = [];
  for (const { topic, revealedLevels } of shown) {
    for (const level of topic.levels.slice(0, revealedLevels)) {
      if (!level.target || seen.has(level.target.id)) continue;
      seen.add(level.target.id);
      refs.push(level.target);
    }
  }
  return refs;
}

/** Longest question accepted, in characters. */
export const QUESTION_MAX = 300;
/** Longest answer shown; anything beyond is cut. */
export const ANSWER_MAX = 1200;

/** Deterministic mapping from evidence to topics. No network, no model. */
export const ruleBasedAdvisor: TutorAdvisor = {
  kind: "rule_based",
  async advise(request) {
    const topics: HintTopic[] = [];
    for (const evidence of request.evidence) {
      if (evidence.kind === "pc-startup") topics.push(...topicsFromStartup(evidence.result));
      else if (evidence.kind === "pc-diagnostics") topics.push(...topicsFromPCDiagnostics(evidence.diagnostics));
      else if (evidence.kind === "network-diagnostics") topics.push(...topicsFromNetworkDiagnostics(evidence.diagnostics));
      else if (evidence.kind === "network-connectivity") topics.push(...topicsFromConnectivity(evidence.result));
      else topics.push(...evidence.topics);
    }
    return topics;
  },
  aiStatus: () => "not_configured",
};

/**
 * Checks topics from any advisor before they reach the learner. An advisor (a model, later) is
 * not trusted: a topic made for another revision or run is dropped, a target with a malformed
 * ID or a stamp that does not match is removed from its level, duplicates are removed, and the
 * list is capped. Whether a target exists on the page is checked again when the learner asks
 * to be shown it.
 */
export function vetTopics(topics: readonly HintTopic[], context: GuidanceContext, options: { allowedTargets?: readonly TutorTargetRef[] } = {}): HintTopic[] {
  const allowed = options.allowedTargets ? new Set(options.allowedTargets.map((ref) => `${ref.kind} ${ref.id}`)) : null;
  const seen = new Set<string>();
  const vetted: HintTopic[] = [];
  for (const topic of topics) {
    if (typeof topic.id !== "string" || topic.id === "" || seen.has(topic.id)) continue;
    if (!Array.isArray(topic.levels) || topic.levels.length !== 3) continue;
    if (topic.madeFor && isGuidanceStale(topic.madeFor, context)) continue;
    seen.add(topic.id);
    const clean = (level: HintLevelContent): HintLevelContent => {
      const { target } = level;
      if (!target) return level;
      const usable =
        isValidTargetId(target.id) &&
        typeof target.kind === "string" &&
        !isGuidanceStale(target, context) &&
        // With a list of allowed targets (an AI answer), anything not supplied in the evidence is removed.
        (!allowed || allowed.has(`${target.kind} ${target.id}`));
      if (usable) return level;
      const { target: _removed, ...rest } = level;
      return rest;
    };
    vetted.push({ ...topic, levels: [clean(topic.levels[0]), clean(topic.levels[1]), clean(topic.levels[2])] });
    if (vetted.length >= MAX_TOPICS) break;
  }
  return vetted;
}

/** Every target the topics carry: the only things an answer about them may point at. */
export function targetsOf(topics: readonly HintTopic[]): TutorTargetRef[] {
  const seen = new Set<string>();
  const refs: TutorTargetRef[] = [];
  for (const topic of topics) {
    for (const level of topic.levels) {
      if (!level.target || seen.has(level.target.id)) continue;
      seen.add(level.target.id);
      refs.push(level.target);
    }
  }
  return refs;
}

/**
 * Checks an answer from a provider before the learner sees it. The text must be a non-empty
 * string and is cut to ANSWER_MAX. A target is kept only when it is one of `allowed` (same ID
 * and kind) and still current; the allowed reference is used, never the provider's own copy.
 * Returns null when there is nothing usable.
 */
export function vetAnswer(answer: unknown, allowed: readonly TutorTargetRef[], context: GuidanceContext): TutorAnswer | null {
  if (typeof answer !== "object" || answer === null) return null;
  const { text, target, confidence } = answer as { text?: unknown; target?: unknown; confidence?: unknown };
  if (typeof text !== "string" || text.trim() === "") return null;
  const wanted = typeof target === "object" && target !== null ? (target as { id?: unknown; kind?: unknown }) : null;
  const match = wanted ? allowed.find((ref) => ref.id === wanted.id && ref.kind === wanted.kind) : undefined;
  return {
    text: text.trim().slice(0, ANSWER_MAX),
    ...(match && !isGuidanceStale(match, context) ? { target: match } : {}),
    confidence: confidence === "certain" || confidence === "likely" ? confidence : "possible",
  };
}

/**
 * `thinking`: a question is with the provider. `answered`: `answer` is on screen.
 * `error`: the provider failed; the hints are untouched. `discarded`: the project changed while
 * the provider was working, so its answer was thrown away.
 */
export type QuestionState =
  | { status: "idle" }
  | { status: "thinking"; question: string }
  | { status: "answered"; question: string; answer: TutorAnswer }
  /** `busy`: the server said there were too many questions for now (its rate limit or daily budget). */
  | { status: "error"; question: string; reason?: "busy" }
  | { status: "discarded"; question: string };

export interface TutorStatus {
  advisor: TutorAdvisor["kind"];
  ai: AiStatus;
  question: QuestionState;
}

export interface TutorService {
  /** Which advisor produced the topics on screen, whether AI chat exists, and the question in progress. Read by the panel. */
  readonly status: StoreApi<TutorStatus>;
  /**
   * Sends the learner's question about the topics on screen to the AI advisor. Does nothing
   * unless AI is available and a question is not already in flight. Never throws.
   */
  ask(question: string): Promise<void>;
  /** Removes the answer or error from the panel. */
  clearQuestion(): void;
  /** Swaps the advisor (the AI adapter calls this once it is configured). */
  setAdvisor(advisor: TutorAdvisor): void;
  /**
   * A lab calls this after every change that produces new evidence: an action, a startup run,
   * a connectivity test. It sets the project context (which removes guidance made for an older state),
   * asks the advisor, vets the answer and shows it. If the project moved on while the advisor
   * was working, the answer is discarded. Returns the topics shown, or null when discarded.
   */
  presentGuidance(request: GuidanceRequest): Promise<readonly HintTopic[] | null>;
  /** The lab is leaving or has no project: remove its topics. */
  clearGuidance(): void;
}

export function createTutorService(ladder: StoreApi<HintLadderState>, initial: TutorAdvisor = ruleBasedAdvisor): TutorService {
  let advisor = initial;
  let latest = 0;
  let asked = 0;
  /** What is on screen and what it was built from; a question is always about these. */
  let shown: { request: GuidanceRequest; topics: readonly HintTopic[] } | null = null;
  const status = createStore<TutorStatus>()(() => ({
    advisor: advisor.kind,
    ai: advisor.aiStatus(),
    question: { status: "idle" },
  }));
  const sameContext = (a: GuidanceContext, b: GuidanceContext) => a.projectRevision === b.projectRevision && a.executionId === b.executionId;
  return {
    status,
    setAdvisor(next) {
      advisor = next;
      asked += 1;
      status.setState({ advisor: next.kind, ai: next.aiStatus(), question: { status: "idle" } });
    },
    async ask(raw) {
      const question = raw.trim().slice(0, QUESTION_MAX);
      const state = status.getState();
      if (question === "" || state.ai !== "available" || !advisor.ask || state.question.status === "thinking") return;
      // The question is about what the learner can see: the lab's topics, or the page's own topic
      // when no lab has supplied any. The one being read comes first.
      const onScreen = ladder.getState();
      const current = activeTopic(onScreen);
      const visible = onScreen.pageTopics.length > 0 ? onScreen.pageTopics : onScreen.fallbackTopic ? [onScreen.fallbackTopic] : [];
      const ordered = current ? [current, ...visible.filter((topic) => topic.id !== current.id)] : visible;
      // Only the levels the learner has opened count as shown; other topics are named but not opened.
      const topics: ShownTopic[] = ordered.map((topic) => ({ topic, revealedLevels: topic === current ? onScreen.level : 0 }));
      const about = { request: shown?.request ?? { lab: "shell" as const, context: onScreen.context, evidence: [] }, topics };
      const ticket = (asked += 1);
      status.setState({ question: { status: "thinking", question } });
      let answer: TutorAnswer | null = null;
      let failed = false;
      let busy = false;
      try {
        answer = vetAnswer(await advisor.ask(question, about.request, about.topics), revealedTargets(about.topics), about.request.context);
        failed = answer === null;
      } catch (error) {
        failed = true;
        const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
        busy = code === "rate_limited" || code === "budget_exhausted";
      }
      if (ticket !== asked) return;
      // An answer about a project state that is no longer on screen is not shown.
      if (!sameContext(ladder.getState().context, about.request.context)) {
        status.setState({ ai: advisor.aiStatus(), question: { status: "discarded", question } });
        return;
      }
      status.setState({ ai: advisor.aiStatus(), question: failed || !answer ? { status: "error", question, ...(busy ? { reason: "busy" as const } : {}) } : { status: "answered", question, answer } });
    },
    clearQuestion() {
      asked += 1;
      status.setState({ question: { status: "idle" } });
    },
    async presentGuidance(request) {
      const ticket = (latest += 1);
      // An answer or a question in flight belongs to the state that is being replaced.
      if (shown && !sameContext(shown.request.context, request.context)) {
        const { question } = status.getState();
        asked += 1;
        status.setState({ question: question.status === "thinking" ? { status: "discarded", question: question.question } : { status: "idle" } });
      }
      ladder.getState().setContext(request.context);
      let topics: readonly HintTopic[];
      try {
        topics = await advisor.advise(request);
      } catch {
        // A failing advisor must not take the rule-based hints away.
        topics = advisor === ruleBasedAdvisor ? [] : await ruleBasedAdvisor.advise(request);
      }
      status.setState({ advisor: advisor.kind, ai: advisor.aiStatus() });
      // A newer request, or a project that moved on, makes this answer stale.
      if (ticket !== latest) return null;
      const current = ladder.getState().context;
      if (current.projectRevision !== request.context.projectRevision || current.executionId !== request.context.executionId) return null;
      // What an AI advisor returns may only point at targets the deterministic evidence supplied.
      const allowedTargets = advisor.kind === "ai" ? targetsOf(await ruleBasedAdvisor.advise(request)) : undefined;
      const vetted = vetTopics(topics, current, { allowedTargets });
      ladder.getState().setPageTopics(vetted);
      shown = { request, topics: vetted };
      return vetted;
    },
    clearGuidance() {
      latest += 1;
      asked += 1;
      shown = null;
      status.setState({ question: { status: "idle" } });
      ladder.getState().setPageTopics([]);
    },
  };
}

/** The page-wide tutor service, bound to the page-wide ladder. */
export const tutor = createTutorService(hintLadder);
