// What every lab project shares once it is open: loading, autosave with a revision check, the
// conflict choice, recovery of unsaved edits, and snapshots. Each lab builds its own store around
// this slice and adds its own data operations. No React here.
import type { LabMode, LabType, ProjectRecord, ProjectSnapshotSummary, ProjectStore, ProjectStoreErrorCode } from "@ytl/contracts";
import { isArchived } from "./archive";

export type SessionPhase =
  | "idle"
  | "loading"
  | "ready"
  /** No project with this ID on this device. */
  | "missing"
  /** The record exists but is not a readable project of this lab. It is left untouched. */
  | "corrupt"
  /** A project of a lab that left the product (the former Code Studio). Kept, listed in My Projects, never opened. */
  | "archived"
  | "unavailable"
  | "error";

export type SaveState =
  | "saved"
  /** Changed since the last save; a save is scheduled. */
  | "dirty"
  | "saving"
  | "failed"
  /** The stored project has a newer revision than the one these edits started from. */
  | "conflict";

/** Same limit as the project store and the database. */
export const TITLE_MAX_LENGTH = 200;

/** Synchronous storage for the copy written when the page is closing with unsaved edits. */
export interface DraftStorage {
  read(projectId: string): string | null;
  write(projectId: string, text: string): void;
  remove(projectId: string): void;
}

export interface SessionDeps<T> {
  store(): ProjectStore;
  drafts: DraftStorage;
  /** Delay between the last change and the autosave. */
  autosaveMs: number;
  /** Runs `task` after `ms`; returns the function that cancels it. */
  schedule(task: () => void, ms: number): () => void;
  lab: LabType;
  /** `ProjectRecord.dataVersion` written with every save. */
  dataVersion: number;
  /** Validates stored (or drafted) data and returns a normalized copy, or null when it is not readable. */
  parse(raw: unknown): T | null;
}

export interface SessionState<T> {
  phase: SessionPhase;
  projectId: string | null;
  title: string;
  mode: LabMode;
  /** Revision of the last successful save or load. */
  revision: number;
  data: T | null;
  saveState: SaveState;
  /** True after edits were brought back from the closing-page copy. */
  recovered: boolean;

  open(projectId: string): Promise<void>;
  /** Loads the stored project again, discarding what is in memory. */
  reload(): Promise<void>;
  /** False when the title is empty or too long; nothing changes then. */
  setTitle(title: string): boolean;
  /** Moves the project between Learn, Free Lab and Test Yourself. The work itself is untouched. */
  setMode(mode: LabMode): void;
  dismissRecovered(): void;
  /** Saves now if there is anything to save. Resolves true when the stored project matches memory. */
  saveNow(): Promise<boolean>;
  /** `mine`: store these edits as the next revision. `theirs`: drop them and load the stored project. */
  resolveConflict(choice: "mine" | "theirs"): Promise<void>;
  /** Saves first, so the snapshot holds exactly what is on screen. Null when it could not be taken. */
  createSnapshot(label: string): Promise<ProjectSnapshotSummary | null>;
  /** Null when the list could not be read. */
  listSnapshots(): Promise<ProjectSnapshotSummary[] | null>;
  restoreSnapshot(snapshotId: string): Promise<boolean>;
  /** Call when the page is closing: keeps unsaved edits where the next load can find them. */
  writeDraft(): void;
}

interface Draft<T> {
  baseRevision: number;
  title: string;
  data: T;
}

function errorCode(error: unknown): ProjectStoreErrorCode | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? (code as ProjectStoreErrorCode) : null;
}

const LOAD_FAILURES: Partial<Record<ProjectStoreErrorCode, SessionPhase>> = {
  not_found: "missing",
  invalid_input: "missing",
  corrupt: "corrupt",
  unavailable: "unavailable",
};

export interface SessionSlice<T, S extends SessionState<T>> {
  /** Spread into the lab's store: the session fields and actions. */
  state: SessionState<T>;
  /** Applies a change made by the learner and schedules the autosave. */
  markDirty(patch: Partial<S>): void;
}

/**
 * Builds the session part of a lab store. `adopted` is called whenever a whole project replaces
 * what is in memory (open, reload, restore, "load the other version") and returns the lab's own
 * fields for that fresh state, such as an empty undo history.
 */
export function createSessionSlice<T, S extends SessionState<T>>(
  deps: SessionDeps<T>,
  set: (patch: Partial<S>) => void,
  get: () => S,
  adopted: (data: T) => Partial<S>,
): SessionSlice<T, S> {
  let cancelAutosave: (() => void) | null = null;
  let saving: Promise<boolean> | null = null;
  // Bumped on every load so a slow, superseded load cannot overwrite a newer one.
  let loadToken = 0;
  const put = (patch: Partial<SessionState<T>>) => set(patch as Partial<S>);

  function scheduleSave() {
    cancelAutosave?.();
    cancelAutosave = deps.schedule(() => {
      cancelAutosave = null;
      void get().saveNow();
    }, deps.autosaveMs);
  }

  function markDirty(patch: Partial<S>) {
    // During a conflict nothing is written until the learner chooses; edits still apply in memory.
    const conflict = get().saveState === "conflict";
    set({ ...patch, saveState: conflict ? "conflict" : "dirty" });
    if (!conflict) scheduleSave();
  }

  function adopt(record: ProjectRecord, data: T, extra: Partial<SessionState<T>> = {}) {
    cancelAutosave?.();
    cancelAutosave = null;
    set({
      ...adopted(data),
      phase: "ready",
      projectId: record.id,
      title: record.title,
      mode: record.mode,
      revision: record.revision,
      data,
      saveState: "saved",
      recovered: false,
      ...extra,
    } as Partial<S>);
  }

  function readDraft(projectId: string): Draft<T> | null {
    try {
      const text = deps.drafts.read(projectId);
      if (!text) return null;
      const raw = JSON.parse(text) as Partial<Draft<unknown>> | null;
      if (!raw || typeof raw.baseRevision !== "number" || typeof raw.title !== "string") return null;
      const data = deps.parse(raw.data);
      return data === null ? null : { baseRevision: raw.baseRevision, title: raw.title, data };
    } catch {
      return null;
    }
  }

  function removeDraft(projectId: string) {
    try {
      deps.drafts.remove(projectId);
    } catch {
      // Nothing to clean up if draft storage is blocked.
    }
  }

  async function load(projectId: string) {
    const token = (loadToken += 1);
    cancelAutosave?.();
    cancelAutosave = null;
    put({ phase: "loading", projectId, data: null });
    let record: ProjectRecord;
    try {
      record = await deps.store().get(projectId);
    } catch (error) {
      const code = errorCode(error);
      if (token === loadToken) put({ phase: (code && LOAD_FAILURES[code]) || "error" });
      return;
    }
    if (token !== loadToken) return;
    if (isArchived(record)) {
      put({ phase: "archived" });
      return;
    }
    const data = record.lab === deps.lab ? deps.parse(record.data) : null;
    if (data === null) {
      put({ phase: "corrupt" });
      return;
    }
    const draft = readDraft(projectId);
    const differs = draft && (draft.title !== record.title || JSON.stringify(draft.data) !== JSON.stringify(data));
    if (!draft || !differs) {
      if (draft) removeDraft(projectId);
      adopt(record, data);
      return;
    }
    // Unsaved edits from the last visit. If the stored project moved on meanwhile, the learner decides.
    const stale = draft.baseRevision !== record.revision;
    adopt(record, draft.data, { title: draft.title, recovered: true, saveState: stale ? "conflict" : "dirty" });
    if (!stale) scheduleSave();
  }

  async function save(): Promise<boolean> {
    const { projectId, data, title, mode, revision } = get();
    if (!projectId || data === null) return false;
    cancelAutosave?.();
    cancelAutosave = null;
    put({ saveState: "saving" });
    try {
      const record = await deps.store().update(projectId, { expectedRevision: revision, title, mode, data, dataVersion: deps.dataVersion });
      if (get().projectId !== projectId) return true;
      removeDraft(projectId);
      const current = get();
      // Edits made while the save was in flight are not in it; they wait for the next one.
      const unchanged = current.data === data && current.title === title;
      put({ revision: record.revision, saveState: unchanged ? "saved" : "dirty" });
      if (!unchanged) scheduleSave();
      return unchanged;
    } catch (error) {
      if (get().projectId === projectId) put({ saveState: errorCode(error) === "revision_conflict" ? "conflict" : "failed" });
      return false;
    }
  }

  const state: SessionState<T> = {
    phase: "idle",
    projectId: null,
    title: "",
    mode: "free",
    revision: 0,
    data: null,
    saveState: "saved",
    recovered: false,

    async open(projectId) {
      const current = get();
      if (current.projectId === projectId && (current.phase === "ready" || current.phase === "loading")) return;
      // Leaving another project: its pending edits are written before it is replaced.
      if (current.phase === "ready" && current.saveState !== "saved") await get().saveNow();
      await load(projectId);
    },

    async reload() {
      const { projectId } = get();
      if (!projectId) return;
      removeDraft(projectId);
      await load(projectId);
    },

    setTitle(title) {
      if (title.trim().length === 0 || title.length > TITLE_MAX_LENGTH) return false;
      if (title !== get().title) markDirty({ title } as Partial<S>);
      return true;
    },

    setMode(mode) {
      if (mode !== get().mode) markDirty({ mode } as Partial<S>);
    },

    dismissRecovered() {
      put({ recovered: false });
    },

    async saveNow() {
      while (saving) await saving;
      const { phase, saveState } = get();
      if (phase !== "ready") return false;
      if (saveState === "saved") return true;
      if (saveState === "conflict") return false;
      saving = save();
      try {
        return await saving;
      } finally {
        saving = null;
      }
    },

    async resolveConflict(choice) {
      const { projectId } = get();
      if (!projectId || get().saveState !== "conflict") return;
      if (choice === "theirs") {
        await get().reload();
        return;
      }
      try {
        const stored = await deps.store().get(projectId);
        put({ revision: stored.revision, saveState: "dirty" });
      } catch {
        put({ saveState: "failed" });
        return;
      }
      await get().saveNow();
    },

    async createSnapshot(label) {
      const { projectId } = get();
      if (!projectId || !(await get().saveNow())) return null;
      try {
        return await deps.store().createSnapshot(projectId, label);
      } catch {
        return null;
      }
    },

    async listSnapshots() {
      const { projectId } = get();
      if (!projectId) return null;
      try {
        return await deps.store().listSnapshots(projectId);
      } catch {
        return null;
      }
    },

    async restoreSnapshot(snapshotId) {
      const { projectId } = get();
      // Saving first keeps the revision check honest; the restore then replaces the project on purpose.
      if (!projectId || !(await get().saveNow())) return false;
      try {
        const record = await deps.store().restoreSnapshot(projectId, snapshotId, get().revision);
        const data = deps.parse(record.data);
        if (data === null) {
          put({ phase: "corrupt" });
          return false;
        }
        removeDraft(projectId);
        adopt(record, data);
        return true;
      } catch (error) {
        if (errorCode(error) === "revision_conflict") put({ saveState: "conflict" });
        return false;
      }
    },

    writeDraft() {
      const { phase, projectId, data, title, revision, saveState } = get();
      if (phase !== "ready" || !projectId || data === null || saveState === "saved") return;
      const draft: Draft<T> = { baseRevision: revision, title, data };
      try {
        deps.drafts.write(projectId, JSON.stringify(draft));
      } catch {
        // Draft storage is blocked or full; the autosave is the only copy then.
      }
    },
  };

  return { state, markDirty };
}
