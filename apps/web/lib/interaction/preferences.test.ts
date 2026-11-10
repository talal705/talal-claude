import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFERENCES, ProjectStoreError, type Preferences } from "@ytl/contracts";

// The page-wide instance imports the real storage module; these tests use their own backing.
vi.mock("@/lib/storage", () => ({ getPreferencesStore: () => ({}) }));

const { createPreferencesState } = await import("./preferences");

function backing(initial: Preferences = DEFAULT_PREFERENCES) {
  let stored = initial;
  const listeners = new Set<(preferences: Preferences) => void>();
  return {
    load: vi.fn(async () => stored),
    save: vi.fn(async (patch: Partial<Preferences>) => (stored = { ...stored, ...patch })),
    subscribe: (listener: (preferences: Preferences) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (preferences: Preferences) => listeners.forEach((listener) => listener(preferences)),
  };
}

describe("preferences state", () => {
  it("holds the defaults and is not ready before loading", () => {
    const state = createPreferencesState(() => backing());
    expect(state.getState()).toMatchObject({ preferences: DEFAULT_PREFERENCES, ready: false, error: null });
  });

  it("loads the stored value once", async () => {
    const store = backing({ ...DEFAULT_PREFERENCES, robotVisible: false });
    const state = createPreferencesState(() => store);
    await Promise.all([state.getState().load(), state.getState().load()]);
    expect(store.load).toHaveBeenCalledTimes(1);
    expect(state.getState()).toMatchObject({ ready: true, preferences: { robotVisible: false } });
  });

  it("applies an update at once and stores it", async () => {
    const store = backing();
    const state = createPreferencesState(() => store);
    await state.getState().load();
    const pending = state.getState().update({ robotVisible: false, robotFrameRate: 30 });
    expect(state.getState().preferences).toMatchObject({ robotVisible: false, robotFrameRate: 30 });
    await pending;
    expect(store.save).toHaveBeenCalledWith({ robotVisible: false, robotFrameRate: 30 });
    expect(state.getState().error).toBeNull();
  });

  it("keeps the change on this page and reports it when storage is unavailable", async () => {
    const store = backing();
    store.save.mockRejectedValueOnce(new ProjectStoreError("unavailable"));
    const state = createPreferencesState(() => store);
    await state.getState().load();
    await state.getState().update({ reducedMotion: "on" });
    expect(state.getState()).toMatchObject({ error: "unavailable", preferences: { reducedMotion: "on" } });
  });

  it("follows a save made elsewhere", async () => {
    const store = backing();
    const state = createPreferencesState(() => store);
    await state.getState().load();
    store.emit({ ...DEFAULT_PREFERENCES, soundEnabled: true });
    expect(state.getState().preferences.soundEnabled).toBe(true);
  });
});
