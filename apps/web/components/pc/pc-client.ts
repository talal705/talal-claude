"use client";

// The page-wide PC lab store wired to this device, like the Code Studio one: guest IndexedDB for
// projects, localStorage for the copy written while the page is closing.
import { useStore } from "zustand";
import type { LabMode, PCProjectData, ProjectRecord, RgbPreference } from "@ytl/contracts";
import { getGuestProjectStore } from "@/lib/storage";
import { pcCatalog } from "./catalog";
import { PC_PROJECT_DATA_VERSION } from "./pc-model";
import { createPCStore, newPCProjectData, type PCState } from "./pc-store";

const DRAFT_PREFIX = "ytl_pc_draft:";

export const pcStore = createPCStore({
  store: getGuestProjectStore,
  catalog: pcCatalog,
  autosaveMs: 800,
  schedule(task, ms) {
    const timer = setTimeout(task, ms);
    return () => clearTimeout(timer);
  },
  // Callers catch: localStorage throws when it is blocked or full.
  drafts: {
    read: (projectId) => localStorage.getItem(DRAFT_PREFIX + projectId),
    write: (projectId, text) => localStorage.setItem(DRAFT_PREFIX + projectId, text),
    remove: (projectId) => localStorage.removeItem(DRAFT_PREFIX + projectId),
  },
});

export function usePC<T>(selector: (state: PCState) => T): T {
  return useStore(pcStore, selector);
}

/** Stores a new PC project: an empty build with a lighting preference, or data already made (a ready build, an import). */
export function createPCProject(input: { title: string; mode: LabMode } & ({ rgbPreference: RgbPreference } | { data: PCProjectData })): Promise<ProjectRecord<PCProjectData>> {
  return getGuestProjectStore().create({
    lab: "pc",
    mode: input.mode,
    title: input.title,
    data: "data" in input ? input.data : newPCProjectData(pcCatalog, input.rgbPreference),
    dataVersion: PC_PROJECT_DATA_VERSION,
  });
}
