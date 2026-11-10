// The help ladder: three levels the learner asks for one at a time, then pointing on request.
// Topics are supplied by code that knows the page or the lab state (see ./advisor.ts).
import { createStore, type StoreApi } from "zustand/vanilla";
import type { HelpLevel, Localized, TutorTargetRef } from "@ytl/contracts";
import { isGuidanceStale, type GuidanceCheck, type GuidanceContext } from "@/lib/targets/registry";

/**
 * Text from a lab (already in both languages), or a key inside the `tutor` message namespace
 * with optional values for its placeholders.
 */
export type HintText = Localized | { key: string; values?: Record<string, string | number> };

export interface HintLevelContent {
  text: HintText;
  /**
   * Verbatim technical text the hint rests on (a compiler message, a measured value). Shown as-is,
   * left to right, in both languages; never translated or rewritten.
   */
  evidence?: string;
  /** What the robot points at when the learner asks to be shown. */
  target?: TutorTargetRef;
}

export interface HintTopic {
  /** Stable ID; the ladder restarts when the active topic's ID changes. */
  id: string;
  title?: HintText;
  /** 1: the symptom or a thinking question. 2: the likely area. 3: the explicit explanation. */
  levels: readonly [HintLevelContent, HintLevelContent, HintLevelContent];
  /** The project state this topic was written for. The topic is dropped when the state moves on. */
  madeFor?: GuidanceContext;
  /** `rule_based` text comes from the simulator, compiler or curriculum; `ai` from a configured provider. */
  source?: "rule_based" | "ai";
}

export type LadderNotice = "stale" | "unavailable" | null;

export interface HintLadderState {
  /** Set by the lab that knows what the learner is doing; one topic per problem. Wins over `fallbackTopic`. */
  pageTopics: readonly HintTopic[];
  /** Which of `pageTopics` the learner is looking at. */
  topicIndex: number;
  /** Set by the tutor from the current route. */
  fallbackTopic: HintTopic | null;
  /** 0 = nothing asked yet. */
  level: 0 | HelpLevel;
  context: GuidanceContext;
  pointing: TutorTargetRef | null;
  notice: LadderNotice;
  panelOpen: boolean;
  /**
   * The highest level the learner may ask for now. A Test Yourself step sets 2 until an attempt
   * has been submitted, so the explicit explanation is not on offer before then.
   */
  levelCap: HelpLevel;
  /**
   * When set, something else owns the level (a lesson: its runner decides and records how many
   * hints have been opened). The panel's "next hint" asks it, and the level shown is whatever it
   * reports back through `setExternalLevel`.
   */
  external: { requestNext(): void } | null;
  /** Set by code outside the panel (a lesson hint's "Show me where"); the tutor answers it by pointing. */
  pointRequest: { target: TutorTargetRef; seq: number } | null;

  /**
   * Replaces the lab's topics. The learner stays on the same problem (and level) when its topic
   * is still in the new list; otherwise the ladder restarts on the first one.
   */
  setPageTopics(topics: readonly HintTopic[]): void;
  /** Shorthand for a single topic, or none. */
  setPageTopic(topic: HintTopic | null): void;
  /** The learner moves to another problem. Restarts the ladder for it. */
  selectTopic(index: number): void;
  setFallbackTopic(topic: HintTopic | null): void;
  /** The learner asks for the next level. Never skips a level and never advances by itself. */
  requestNextLevel(): void;
  resetLadder(): void;
  /** The active project changed revision or started a new run: stale guidance is removed. */
  setContext(context: GuidanceContext): void;
  /**
   * The learner asks to be shown the current level's target. `check` is the registry's
   * `checkGuidance`; pointing starts only when it accepts the target.
   */
  pointAtCurrentTarget(check: (ref: TutorTargetRef, context: GuidanceContext) => GuidanceCheck): GuidanceCheck | null;
  /** The same for a given target (an answer's target). Pointing starts only when `check` accepts it. */
  pointAt(target: TutorTargetRef, check: (ref: TutorTargetRef, context: GuidanceContext) => GuidanceCheck): GuidanceCheck;
  /** `reason` is set when the tutor, not the learner, stopped (the target went away). */
  stopPointing(reason?: Exclude<LadderNotice, null>): void;
  setPanelOpen(open: boolean): void;
  setLevelCap(cap: HelpLevel): void;
  setExternal(external: { requestNext(): void } | null): void;
  /** The level as the external owner has it. Only meaningful while `external` is set. */
  setExternalLevel(level: 0 | HelpLevel): void;
  /** Ask the tutor to point at this target, as its own "Show me where" does: checked, revealed, then pointed at. */
  requestPoint(target: TutorTargetRef): void;
}

type TopicSlots = Pick<HintLadderState, "pageTopics" | "topicIndex" | "fallbackTopic">;

export function activeTopic(state: TopicSlots): HintTopic | null {
  return state.pageTopics[state.topicIndex] ?? state.pageTopics[0] ?? state.fallbackTopic;
}

export function currentTarget(state: TopicSlots & Pick<HintLadderState, "level">): TutorTargetRef | null {
  const topic = activeTopic(state);
  if (!topic || state.level === 0) return null;
  return topic.levels[state.level - 1].target ?? null;
}

/** True when the topic, or any target in it, was made for a project state that is no longer current. */
export function isTopicStale(topic: HintTopic, context: GuidanceContext): boolean {
  if (topic.madeFor && isGuidanceStale(topic.madeFor, context)) return true;
  return topic.levels.some((level) => level.target !== undefined && isGuidanceStale(level.target, context));
}

export function createHintLadderStore(): StoreApi<HintLadderState> {
  return createStore<HintLadderState>()((set, get) => {
    /** Applies a change to the topic slots; restarts the ladder when the active topic is a different one. */
    const withTopics = (patch: Partial<TopicSlots>, notice: LadderNotice = null) => {
      const before = activeTopic(get());
      const after = activeTopic({ ...get(), ...patch });
      if (before?.id === after?.id) set(patch);
      else set({ ...patch, level: 0, pointing: null, notice });
    };
    const replaceTopics = (topics: readonly HintTopic[], notice: LadderNotice = null) => {
      const current = get().pageTopics[get().topicIndex];
      const kept = current ? topics.findIndex((topic) => topic.id === current.id) : -1;
      withTopics({ pageTopics: topics, topicIndex: Math.max(0, kept) }, notice);
    };
    return {
      pageTopics: [],
      topicIndex: 0,
      fallbackTopic: null,
      level: 0,
      context: {},
      pointing: null,
      notice: null,
      panelOpen: false,
      levelCap: 3,
      external: null,
      pointRequest: null,

      setPageTopics: (topics) => replaceTopics(topics),
      setPageTopic: (topic) => replaceTopics(topic ? [topic] : []),
      selectTopic(index) {
        if (!Number.isInteger(index) || index < 0 || index >= get().pageTopics.length) return;
        withTopics({ topicIndex: index });
      },
      setFallbackTopic: (topic) => withTopics({ fallbackTopic: topic }),
      requestNextLevel() {
        const { level } = get();
        if (!activeTopic(get()) || level >= 3 || level >= get().levelCap) return;
        const external = get().external;
        if (external) {
          external.requestNext();
          return;
        }
        set({ level: (level + 1) as HelpLevel, pointing: null, notice: null });
      },
      resetLadder: () => set({ level: 0, pointing: null, notice: null }),
      setContext(context) {
        const state = get();
        set({ context });
        const fresh = state.pageTopics.filter((topic) => !isTopicStale(topic, context));
        if (fresh.length !== state.pageTopics.length) {
          const activeDropped = !fresh.some((topic) => topic.id === state.pageTopics[state.topicIndex]?.id);
          replaceTopics(fresh, activeDropped ? "stale" : null);
        }
        const { pointing } = get();
        if (pointing && isGuidanceStale(pointing, context)) set({ pointing: null, notice: "stale" });
      },
      pointAtCurrentTarget(check) {
        const target = currentTarget(get());
        return target ? get().pointAt(target, check) : null;
      },
      pointAt(target, check) {
        const state = get();
        const result = check(target, state.context);
        const usable = result.ok && (result.resolution.status === "visible" || result.resolution.status === "offscreen");
        if (usable) set({ pointing: target, notice: null });
        else set({ pointing: null, notice: !result.ok && result.reason === "stale" ? "stale" : "unavailable" });
        return result;
      },
      stopPointing: (reason) => set({ pointing: null, notice: reason ?? null }),
      setPanelOpen: (panelOpen) => set({ panelOpen }),
      setLevelCap(cap) {
        // Lowering the cap hides nothing already shown; it only stops the next request.
        if (cap === 1 || cap === 2 || cap === 3) set({ levelCap: cap });
      },
      setExternal: (external) => set({ external }),
      setExternalLevel(level) {
        if (!get().external || level === get().level) return;
        set({ level: Math.max(0, Math.min(3, level)) as 0 | HelpLevel, pointing: null, notice: null });
      },
      requestPoint: (target) => set({ pointRequest: { target, seq: (get().pointRequest?.seq ?? 0) + 1 } }),
    };
  });
}

/** The page-wide ladder. Labs normally reach it through `presentGuidance` in ./advisor.ts. */
export const hintLadder = createHintLadderStore();
