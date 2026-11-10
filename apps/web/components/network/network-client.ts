"use client";

// The page-wide network lab store wired to this device, like the other labs: guest IndexedDB for
// projects, localStorage for the copy written while the page is closing.
import { useStore } from "zustand";
import type { LabMode, NetworkProjectData, ProjectRecord } from "@ytl/contracts";
import { getGuestProjectStore } from "@/lib/storage";
import { NETWORK_PROJECT_DATA_VERSION } from "./network-model";
import { createNetworkStore, type NetworkLabState } from "./network-store";

const DRAFT_PREFIX = "ytl_network_draft:";

export const networkStore = createNetworkStore({
  store: getGuestProjectStore,
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

export function useNetwork<T>(selector: (state: NetworkLabState) => T): T {
  return useStore(networkStore, selector);
}

export function createNetworkProject(input: { title: string; mode: LabMode; data: NetworkProjectData }): Promise<ProjectRecord<NetworkProjectData>> {
  return getGuestProjectStore().create({ lab: "network", ...input, dataVersion: NETWORK_PROJECT_DATA_VERSION });
}
