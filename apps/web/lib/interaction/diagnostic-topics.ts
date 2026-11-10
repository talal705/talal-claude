// Turns what the labs already know (simulator diagnostics) into hint topics. Rule-based: every
// sentence comes from the simulator or from the `tutor` messages. Nothing here interprets or certifies a result.
import type {
  ConnectivityResult,
  Journey,
  Localized,
  NetworkDiagnostic,
  PCDiagnostic,
  StartupResult,
} from "@ytl/contracts";
import type { HintTopic } from "./hint-ladder";

/** At most this many problems are offered at once; the rest appear as the first ones are fixed. */
export const MAX_TOPICS = 12;

const PC_SEVERITY = { blocking: 0, warning: 1, info: 2 } as const;

/**
 * One PC diagnostic as a topic: level 1 is the symptom (`observation`, else the observation of
 * the startup stage it failed, else a general question), level 2 is `message`, level 3 is
 * `explanation`. Levels 2 and 3 can point at `target`. The topic is tied to the revision and
 * run stamped on the target.
 */
export function topicFromPCDiagnostic(diagnostic: PCDiagnostic, stageObservation?: Localized): HintTopic {
  const { target } = diagnostic;
  return {
    id: `pc:${diagnostic.id}`,
    title: { key: `hints.pc.class.${diagnostic.class}` },
    levels: [
      { text: diagnostic.observation ?? stageObservation ?? { key: "hints.generic.symptom" } },
      { text: diagnostic.message, target },
      { text: diagnostic.explanation, target },
    ],
    madeFor: { projectRevision: target.projectRevision, executionId: target.executionId },
    source: "rule_based",
  };
}

/** Topics for a startup run: blocking faults of the failed stages first, then advisories by severity. */
export function topicsFromStartup(result: Pick<StartupResult, "stages" | "advisories">): HintTopic[] {
  const topics: HintTopic[] = [];
  for (const stage of result.stages) {
    for (const diagnostic of stage.diagnostics) topics.push(topicFromPCDiagnostic(diagnostic, stage.observation));
  }
  const advisories = [...result.advisories].sort((a, b) => PC_SEVERITY[a.severity] - PC_SEVERITY[b.severity]);
  for (const diagnostic of advisories) topics.push(topicFromPCDiagnostic(diagnostic));
  return unique(topics).slice(0, MAX_TOPICS);
}

/** Topics for diagnostics outside a startup run (a rejected action, assembly warnings). */
export function topicsFromPCDiagnostics(diagnostics: readonly PCDiagnostic[]): HintTopic[] {
  const sorted = [...diagnostics].sort((a, b) => PC_SEVERITY[a.severity] - PC_SEVERITY[b.severity]);
  return unique(sorted.map((diagnostic) => topicFromPCDiagnostic(diagnostic))).slice(0, MAX_TOPICS);
}

// ---------- Network ----------

const NETWORK_SEVERITY = { blocking: 0, warning: 1, info: 2 } as const;

/**
 * One network diagnostic as a topic, the same way as a PC diagnostic: level 1 is the symptom
 * (`observation`, else a general question), level 2 is `message`, level 3 is `explanation`.
 * Levels 2 and 3 can point at `target`.
 */
export function topicFromNetworkDiagnostic(diagnostic: NetworkDiagnostic): HintTopic {
  const { target } = diagnostic;
  return {
    id: `network:${diagnostic.id}`,
    title: { key: `hints.network.title.${diagnostic.severity}` },
    levels: [
      { text: diagnostic.observation ?? { key: "hints.generic.symptom" } },
      { text: diagnostic.message, target },
      { text: diagnostic.explanation, target },
    ],
    madeFor: { projectRevision: target.projectRevision, executionId: target.executionId },
    source: "rule_based",
  };
}

/** Topics for the standing check of a topology: blocking findings first, engine order kept. */
export function topicsFromNetworkDiagnostics(diagnostics: readonly NetworkDiagnostic[]): HintTopic[] {
  const sorted = diagnostics
    .map((diagnostic, index) => ({ diagnostic, index }))
    .sort((a, b) => NETWORK_SEVERITY[a.diagnostic.severity] - NETWORK_SEVERITY[b.diagnostic.severity] || a.index - b.index);
  return unique(sorted.map(({ diagnostic }) => topicFromNetworkDiagnostic(diagnostic))).slice(0, MAX_TOPICS);
}

/**
 * A journey that did not arrive, as a topic, for when there is no diagnostic to explain it.
 * Level 1 sends the learner to the playback; level 2 is the engine's sentence for the event
 * where the packet stopped, pointing at that place; level 3 is the engine's reason. Returns null
 * for a delivered journey, and for one whose last event is not a failure (nothing to explain).
 */
export function topicFromJourney(journey: Journey): HintTopic | null {
  if (journey.outcome === "delivered") return null;
  const stopped = journey.events[journey.events.length - 1];
  if (!stopped || stopped.result !== "failed") {
    return {
      id: `network:journey:${journey.id}`,
      title: { key: "hints.network.title.blocking" },
      levels: [{ text: { key: "hints.network.journey.symptom" } }, { text: journey.summary }, { text: journey.summary }],
      source: "rule_based",
    };
  }
  const target = stopped.target;
  return {
    id: `network:journey:${journey.id}`,
    title: { key: "hints.network.title.blocking" },
    levels: [
      { text: { key: "hints.network.journey.symptom" } },
      { text: stopped.message, target },
      { text: stopped.reason ?? journey.summary, target },
    ],
    madeFor: { projectRevision: target.projectRevision, executionId: target.executionId },
    source: "rule_based",
  };
}

/**
 * Topics for a connectivity test: one per diagnostic, the cause first. A failed test that came
 * without diagnostics still gets the topic built from its journey. A successful test gets none.
 */
export function topicsFromConnectivity(result: Pick<ConnectivityResult, "succeeded" | "diagnostics" | "journey">): HintTopic[] {
  if (result.succeeded) return [];
  if (result.diagnostics.length > 0) return unique(result.diagnostics.map(topicFromNetworkDiagnostic)).slice(0, MAX_TOPICS);
  const fromJourney = topicFromJourney(result.journey);
  return fromJourney ? [fromJourney] : [];
}

function unique(topics: HintTopic[]): HintTopic[] {
  const seen = new Set<string>();
  return topics.filter((topic) => (seen.has(topic.id) ? false : (seen.add(topic.id), true)));
}
