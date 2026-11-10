"use client";

// Which part of the network the journey playback is at right now, so the device, port or cable
// it names can be marked in the lists.
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export const highlightStore = createStore<{ id: string | null }>()(() => ({ id: null }));

/** True while the playback's current step is at the element with this tutor target ID. */
export function useHighlighted(targetId: string): boolean {
  return useStore(highlightStore, (state) => state.id === targetId);
}
