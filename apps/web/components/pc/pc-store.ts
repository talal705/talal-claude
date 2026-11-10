// State of the open PC project: the engine's undo history, the "select, then destination" machine,
// and the last refusal, on top of the shared project session. Every change to the build is a
// PCAction run through the engine; this file decides nothing about what is allowed. No React here.
import { createStore, type StoreApi } from "zustand/vanilla";
import type { CableId, InstanceId, PCAction, PCActionResult, PCCatalog, PCDiagnostic, PCHistory, PCPreset, PCProjectData, ProjectStore, RgbPreference } from "@ytl/contracts";
import { pc } from "@ytl/simulation";
import {
  assemblyReducer,
  cableEndCandidates,
  initialAssemblyState,
  mountCandidates,
  type AssemblyEvent,
  type AssemblyState,
  type AssemblySubject,
} from "@/lib/interaction/assembly";
import { createSessionSlice, type DraftStorage, type SessionState } from "../project/session";
import { PC_PROJECT_DATA_VERSION, parsePCProjectData, sameInBoth } from "./pc-model";

export interface PCStoreDeps {
  store(): ProjectStore;
  catalog: PCCatalog;
  drafts: DraftStorage;
  autosaveMs: number;
  schedule(task: () => void, ms: number): () => void;
}

/** Where DOM focus should go next, as asked by the selection machine. `seq` changes on every request. */
export type FocusRequest = { seq: number } & ({ to: "candidate"; candidateId: string } | { to: "subject"; subject: AssemblySubject });

export interface PCState extends SessionState<PCProjectData> {
  /** The engine's undo history for this visit. Null until a project is open. */
  history: PCHistory | null;
  assembly: AssemblyState;
  /** The engine's reason for the last refused action, until the next accepted one. */
  refusal: { seq: number; diagnostic: PCDiagnostic } | null;
  focus: FocusRequest | null;
  canUndo: boolean;
  canRedo: boolean;

  /** Runs one action through the engine. A refusal changes nothing and is kept in `refusal`. */
  act(action: PCAction): PCActionResult | null;
  /** Feeds the selection machine and carries out what it asks for. */
  send(event: AssemblyEvent): void;
  /** Picks a part up: lists every place it could go, with the engine's reason for those it cannot. */
  selectPart(instanceId: InstanceId): void;
  selectCableEnd(cableId: CableId, endId: string): void;
}

/** A new, empty build as project data. The lighting choice is the first logged action, so the log replays to the same state. */
export function newPCProjectData(catalog: PCCatalog, rgbPreference: RgbPreference): PCProjectData {
  const { history } = pc.dispatch(pc.createHistory(pc.createBuild(catalog)), { type: "set_rgb_preference", preference: rgbPreference }, catalog);
  return pc.toProjectData(history);
}

/**
 * A starter kit as project data: its parts added to the bench under the current catalog, nothing installed.
 * Null when the current catalog refuses any of them, so a kit that would not stand is never handed out.
 */
export function kitProjectData(kit: { actions: readonly PCAction[] }, catalog: PCCatalog): PCProjectData | null {
  // A kit's actions begin with its own lighting choice.
  const log: PCAction[] = [...kit.actions];
  const replayed = pc.replay(log, catalog);
  return replayed.clean ? { state: replayed.state, log } : null;
}

export function createPCStore(deps: PCStoreDeps): StoreApi<PCState> {
  // Actions logged before this visit; the history only knows the ones made since the project was opened.
  let earlierLog: PCAction[] = [];
  let seq = 0;

  return createStore<PCState>()((set, get) => {
    const session = createSessionSlice<PCProjectData, PCState>(
      {
        store: deps.store,
        drafts: deps.drafts,
        autosaveMs: deps.autosaveMs,
        schedule: deps.schedule,
        lab: "pc",
        dataVersion: PC_PROJECT_DATA_VERSION,
        parse: (raw) => parsePCProjectData(raw, deps.catalog),
      },
      set,
      get,
      (data) => {
        earlierLog = data.log;
        return { history: pc.createHistory(data.state), assembly: initialAssemblyState, refusal: null, focus: null, canUndo: false, canRedo: false };
      },
    );

    const context = () => ({ projectRevision: get().revision });

    function commit(history: PCHistory, extra: Partial<PCState> = {}) {
      session.markDirty({
        history,
        data: pc.toProjectData(history, earlierLog),
        canUndo: pc.canUndo(history),
        canRedo: pc.canRedo(history),
        ...extra,
      });
    }

    function partLabel(instanceId: InstanceId) {
      const part = get().history?.present.parts.find((item) => item.instanceId === instanceId);
      const entry = part && pc.indexCatalog(deps.catalog).byId.get(part.catalogId);
      return sameInBoth(entry ? `${entry.brand} ${entry.model}` : instanceId);
    }

    return {
      ...session.state,
      history: null,
      assembly: initialAssemblyState,
      refusal: null,
      focus: null,
      canUndo: false,
      canRedo: false,

      act(action) {
        const { history } = get();
        if (!history) return null;
        const step = pc.dispatch(history, action, deps.catalog, context());
        if (step.result.ok) {
          commit(step.history, { refusal: null });
        } else {
          // The attempt stays in the engine's event log; the build and the saved data do not change.
          set({ history: step.history, refusal: { seq: (seq += 1), diagnostic: step.result.rejection } });
        }
        return step.result;
      },

      send(event) {
        const step = assemblyReducer(get().assembly, event);
        set({ assembly: step.state });
        for (const effect of step.effects) {
          if (effect.type === "dispatch") {
            const result = get().act(effect.action);
            if (!result) continue;
            get().send(result.ok ? { type: "result", ok: true } : { type: "result", ok: false, rejection: result.rejection });
          } else if (effect.type === "undo" || effect.type === "redo") {
            const { history } = get();
            const changed = !!history && (effect.type === "undo" ? pc.canUndo(history) : pc.canRedo(history));
            if (history && changed) commit(effect.type === "undo" ? pc.undo(history) : pc.redo(history), { refusal: null });
            get().send({ type: "history", did: effect.type, changed });
          } else if (effect.type === "focus-candidate") {
            set({ focus: { seq: (seq += 1), to: "candidate", candidateId: effect.candidateId } });
          } else {
            set({ focus: { seq: (seq += 1), to: "subject", subject: effect.subject } });
          }
        }
      },

      selectPart(instanceId) {
        const { history } = get();
        if (!history) return;
        const options = pc.mountOptions(history.present, deps.catalog, instanceId, context());
        get().send({ type: "select", subject: { kind: "part", instanceId, label: partLabel(instanceId) }, candidates: mountCandidates(instanceId, options) });
      },

      selectCableEnd(cableId, endId) {
        const { history } = get();
        if (!history) return;
        const cable = history.present.cables.find((item) => item.id === cableId);
        const spec = cable && pc.cableSpecOf(pc.indexCatalog(deps.catalog).byId.get(cable.catalogId), cable.cableSpecId);
        const end = spec?.ends.find((item) => item.id === endId);
        const label = spec && end ? { en: `${spec.label.en}: ${end.label.en}`, ar: `${spec.label.ar}: ${end.label.ar}` } : sameInBoth(`${cableId}/${endId}`);
        const options = pc.cableEndOptions(history.present, deps.catalog, cableId, endId, context());
        get().send({ type: "select", subject: { kind: "cable-end", cableId, endId, label }, candidates: cableEndCandidates(cableId, endId, options) });
      },
    };
  });
}
