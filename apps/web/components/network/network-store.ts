// State of the open network project: the engine's undo history, the "select a cable end, then a
// port" machine, and the last refusal, on top of the shared project session. Every change is a
// NetworkAction run through the engine. No React here, and nothing leaves the simulator.
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Localized, NetworkAction, NetworkActionResult, NetworkCableEndId, NetworkDiagnostic, NetworkHistory, NetworkProjectData, ProjectStore } from "@ytl/contracts";
import { network } from "@ytl/simulation";
import { cablingReducer, initialCablingState, portCandidates, type CablingEvent, type CablingState, type CablingSubject } from "@/lib/interaction/network-cabling";
import { createSessionSlice, type DraftStorage, type SessionState } from "../project/session";
import { NETWORK_PROJECT_DATA_VERSION, parseNetworkProjectData } from "./network-model";

export interface NetworkStoreDeps {
  store(): ProjectStore;
  drafts: DraftStorage;
  autosaveMs: number;
  schedule(task: () => void, ms: number): () => void;
}

/** Where DOM focus should go next, as asked by the cabling machine. `seq` changes on every request. */
export type CablingFocus = { seq: number } & ({ to: "candidate"; candidateId: string } | { to: "subject"; subject: CablingSubject });

export interface NetworkLabState extends SessionState<NetworkProjectData> {
  history: NetworkHistory | null;
  cabling: CablingState;
  /** The engine's reason for the last refused action, until the next accepted one. */
  refusal: { seq: number; diagnostic: NetworkDiagnostic } | null;
  focus: CablingFocus | null;
  canUndo: boolean;
  canRedo: boolean;

  /** Runs one action through the engine. A refusal changes nothing and is kept in `refusal`. */
  act(action: NetworkAction): NetworkActionResult | null;
  /** Feeds the cabling machine and carries out what it asks for. */
  send(event: CablingEvent): void;
  /** Picks a loose cable end up: lists every port, with the engine's reason for those that cannot take it. */
  selectCableEnd(cableId: string, endId: NetworkCableEndId, label: Localized): void;
}

export function createNetworkStore(deps: NetworkStoreDeps): StoreApi<NetworkLabState> {
  // Actions logged before this visit; the history only holds the ones made since the project was opened.
  let earlierLog: NetworkAction[] = [];
  let seq = 0;

  return createStore<NetworkLabState>()((set, get) => {
    const session = createSessionSlice<NetworkProjectData, NetworkLabState>(
      {
        store: deps.store,
        drafts: deps.drafts,
        autosaveMs: deps.autosaveMs,
        schedule: deps.schedule,
        lab: "network",
        dataVersion: NETWORK_PROJECT_DATA_VERSION,
        parse: parseNetworkProjectData,
      },
      set,
      get,
      (data) => {
        earlierLog = data.log;
        return { history: network.createHistory(data.state), cabling: initialCablingState, refusal: null, focus: null, canUndo: false, canRedo: false };
      },
    );

    function commit(history: NetworkHistory, extra: Partial<NetworkLabState> = {}) {
      session.markDirty({
        history,
        data: { state: history.present, log: [...earlierLog, ...network.timelineLog(history)] },
        canUndo: network.canUndo(history),
        canRedo: network.canRedo(history),
        ...extra,
      });
    }

    return {
      ...session.state,
      history: null,
      cabling: initialCablingState,
      refusal: null,
      focus: null,
      canUndo: false,
      canRedo: false,

      act(action) {
        const { history } = get();
        if (!history) return null;
        const step = network.dispatch(history, action);
        if (step.result.ok) commit(step.history, { refusal: null });
        else set({ history: step.history, refusal: { seq: (seq += 1), diagnostic: step.result.rejection } });
        return step.result;
      },

      send(event) {
        const step = cablingReducer(get().cabling, event);
        set({ cabling: step.state });
        for (const effect of step.effects) {
          if (effect.type === "dispatch") {
            const result = get().act(effect.action);
            if (!result) continue;
            get().send(result.ok ? { type: "result", ok: true } : { type: "result", ok: false, reason: result.rejection.message });
          } else if (effect.type === "undo" || effect.type === "redo") {
            const { history } = get();
            const changed = !!history && (effect.type === "undo" ? network.canUndo(history) : network.canRedo(history));
            if (history && changed) commit(effect.type === "undo" ? network.undo(history) : network.redo(history), { refusal: null });
            get().send({ type: "history", did: effect.type, changed });
          } else if (effect.type === "focus-candidate") {
            set({ focus: { seq: (seq += 1), to: "candidate", candidateId: effect.candidateId } });
          } else {
            set({ focus: { seq: (seq += 1), to: "subject", subject: effect.subject } });
          }
        }
      },

      selectCableEnd(cableId, endId, label) {
        const { history } = get();
        if (!history) return;
        const options = network.cablePortOptions(history.present, cableId, endId);
        get().send({ type: "select", subject: { kind: "cable-end", cableId, endId, label }, candidates: portCandidates(cableId, endId, options) });
      },
    };
  });
}
