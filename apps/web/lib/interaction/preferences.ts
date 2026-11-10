"use client";

// Learner preferences for React. One page-wide store; no provider to mount.
import { useEffect, useSyncExternalStore } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { DEFAULT_PREFERENCES, type Preferences, type PreferencesStore } from "@ytl/contracts";
import { getPreferencesStore } from "@/lib/storage";

export type PreferencesPatch = Partial<Omit<Preferences, "version">>;

export interface PreferencesState {
  preferences: Preferences;
  /** False until the stored value has been read. Until then `preferences` holds the defaults. */
  ready: boolean;
  /** `unavailable`: the last change applies on this page but could not be stored on this device. */
  error: "unavailable" | null;
  load(): Promise<void>;
  /** Applies the change at once, then stores it. Never throws. */
  update(patch: PreferencesPatch): Promise<void>;
}

type Backing = PreferencesStore & { subscribe?(listener: (preferences: Preferences) => void): () => void };

export function createPreferencesState(getBacking: () => Backing): StoreApi<PreferencesState> {
  let loading: Promise<void> | null = null;
  return createStore<PreferencesState>()((set, get) => ({
    preferences: DEFAULT_PREFERENCES,
    ready: false,
    error: null,
    load() {
      loading ??= (async () => {
        const backing = getBacking();
        // Saves from other tabs, and from code that uses the storage API directly.
        backing.subscribe?.((preferences) => set({ preferences }));
        const preferences = await backing.load();
        set({ preferences, ready: true });
      })();
      return loading;
    },
    async update(patch) {
      set({ preferences: { ...get().preferences, ...patch }, error: null });
      try {
        await getBacking().save(patch);
      } catch {
        set({ error: "unavailable" });
      }
    },
  }));
}

export const preferencesState = createPreferencesState(getPreferencesStore);

const serverSnapshot: Pick<PreferencesState, "preferences" | "ready" | "error"> = {
  preferences: DEFAULT_PREFERENCES,
  ready: false,
  error: null,
};

/**
 * `{ preferences, ready, error, update }`. Loads the stored value on first use.
 * Server render and first client render both see the defaults with `ready: false`.
 */
export function usePreferences() {
  const state = useSyncExternalStore(
    preferencesState.subscribe,
    preferencesState.getState,
    () => serverSnapshot as PreferencesState,
  );
  useEffect(() => {
    void preferencesState.getState().load();
  }, []);
  return { preferences: state.preferences, ready: state.ready, error: state.error, update: preferencesState.getState().update };
}

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribeSystemMotion(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** The reduced-motion preference resolved to a yes or no: `system` follows the operating system. */
export function useReducedMotion(): boolean {
  const { preferences } = usePreferences();
  const system = useSyncExternalStore(
    subscribeSystemMotion,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
  if (preferences.reducedMotion === "on") return true;
  if (preferences.reducedMotion === "off") return false;
  return system;
}
