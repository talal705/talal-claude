// Undo, redo and replay over the pure reducer. States are immutable, so history keeps whole states.
import type { PCAction, PCActionResult, PCBuildState, PCCatalog, PCEvaluationContext, PCEvent, PCHistory, PCProjectData } from "@ytl/contracts";
import { applyAction, createBuild } from "./reducer";

/** Which accepted action produced a state. Lets the timeline log follow undo and redo without storing it twice. */
const producedBy = new WeakMap<PCBuildState, PCAction>();

export function createHistory(initial: PCBuildState): PCHistory {
  return { past: [], present: initial, future: [], events: [] };
}

/**
 * Applies one action. An accepted action becomes a new undo step and clears redo; a rejected one changes nothing
 * except the event log, which records the attempt and its reason.
 */
export function dispatch(history: PCHistory, action: PCAction, catalog: PCCatalog, ctx: PCEvaluationContext = {}): { history: PCHistory; result: PCActionResult } {
  const result = applyAction(history.present, action, catalog, ctx);
  const event: PCEvent = {
    seq: history.events.length + 1,
    action,
    accepted: result.ok,
    ...(result.ok ? (result.created ? { created: result.created } : {}) : { rejection: result.rejection }),
  };
  const events = [...history.events, event];
  if (!result.ok) return { history: { ...history, events }, result };
  producedBy.set(result.state, action);
  return { history: { past: [...history.past, history.present], present: result.state, future: [], events }, result };
}

export const canUndo = (history: PCHistory): boolean => history.past.length > 0;
export const canRedo = (history: PCHistory): boolean => history.future.length > 0;

export function undo(history: PCHistory): PCHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return { ...history, past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo(history: PCHistory): PCHistory {
  const next = history.future[0];
  if (!next) return history;
  return { ...history, past: [...history.past, history.present], present: next, future: history.future.slice(1) };
}

/**
 * The accepted actions that lead from the history's first state to its present one, following undo and redo.
 * Replaying them on that first state reproduces `present` exactly.
 */
export function timelineLog(history: PCHistory): PCAction[] {
  const log: PCAction[] = [];
  for (const state of [...history.past.slice(1), history.present]) {
    const action = producedBy.get(state);
    if (action) log.push(action);
  }
  return history.past.length === 0 ? [] : log;
}

/** What a PC project stores: the state and the actions that rebuild it from an empty build. */
export function toProjectData(history: PCHistory, earlierLog: PCAction[] = []): PCProjectData {
  return { state: history.present, log: [...earlierLog, ...timelineLog(history)] };
}

export interface ReplayResult {
  state: PCBuildState;
  events: PCEvent[];
  /** False when any action in the log was rejected. */
  clean: boolean;
}

/** Re-runs a log on a fresh build (or on `from`). The same log and catalog always give the same state and IDs. */
export function replay(actions: readonly PCAction[], catalog: PCCatalog, from?: PCBuildState): ReplayResult {
  let history = createHistory(from ?? createBuild(catalog));
  for (const action of actions) history = dispatch(history, action, catalog).history;
  return { state: history.present, events: history.events, clean: history.events.every((e) => e.accepted) };
}
