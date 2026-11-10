// Binds a lesson to the tutor: the lesson is the source of the hints on the robot's ladder, and
// the lesson runner stays the only owner of how many hints have been opened (it records them and
// enforces the Test Yourself lock). The page calls `syncLessonToTutor` after every runner change
// and `releaseLessonFromTutor` when the lesson closes.
import { currentStep, currentTask, visibleHelp, type LessonEvent, type LessonRunState } from "@ytl/curriculum";
import type { StoreApi } from "zustand/vanilla";
import { hintLadder, type HintLadderState, type HintTopic } from "./hint-ladder";

/** The hint topic for the task on screen, or null when it has no hints on offer (summary, untried follow-up). */
export function lessonTopic(state: LessonRunState): HintTopic | null {
  const step = currentStep(state);
  const task = currentTask(state);
  if (!step || !task || state.phase === "summary") return null;
  if (state.phase === "follow_up") return null;
  return {
    id: `lesson:${state.lesson.id}:${step.id}`,
    title: state.lesson.title,
    levels: [
      { text: task.hints[0].text, ...(task.hints[0].target ? { target: task.hints[0].target } : {}) },
      { text: task.hints[1].text, ...(task.hints[1].target ? { target: task.hints[1].target } : {}) },
      { text: task.hints[2].text, ...(task.hints[2].target ? { target: task.hints[2].target } : {}) },
    ],
    source: "rule_based",
  };
}

/**
 * Puts the lesson's hints on the tutor's ladder and keeps the ladder in step with the runner:
 * the topic, the number of hints opened, and the Test Yourself cap. The tutor's "next hint"
 * button sends `request_hint` through `send`; nothing else changes the level.
 */
export function syncLessonToTutor(state: LessonRunState, send: (event: LessonEvent) => void, ladder: StoreApi<HintLadderState> = hintLadder): void {
  const topic = lessonTopic(state);
  const store = ladder.getState();
  store.setExternal({ requestNext: () => send({ type: "request_hint" }) });
  store.setPageTopics(topic ? [topic] : []);
  const record = state.records[state.stepIndex];
  const help = visibleHelp(state);
  store.setLevelCap(state.mode === "test" && record && record.attempts === 0 ? 2 : 3);
  store.setExternalLevel(topic ? (help.hints.length as 0 | 1 | 2 | 3) : 0);
}

/** The lesson closed: the ladder goes back to its own levels and the page's own topics. */
export function releaseLessonFromTutor(ladder: StoreApi<HintLadderState> = hintLadder): void {
  const store = ladder.getState();
  store.setExternal(null);
  store.setLevelCap(3);
  store.setPageTopics([]);
}
