import { DEFAULT_PREFERENCES, type Preferences, type PreferencesStore } from "@ytl/contracts";
import { PREFERENCES_STORE, request, type GuestDatabase } from "./guest-db";
import { checkPreferencesPatch, readPreferences } from "./validation";

/** The single record in the preferences object store. */
export const PREFERENCES_KEY = "current";

export type PreferencesListener = (preferences: Preferences) => void;

export interface ObservablePreferencesStore extends PreferencesStore {
  /**
   * Calls `listener` after every successful save in this tab, and in other tabs where
   * BroadcastChannel exists. Returns the unsubscribe function.
   */
  subscribe(listener: PreferencesListener): () => void;
}

const CHANNEL_NAME = "ytl-preferences";

export function createPreferencesStore(db: GuestDatabase): ObservablePreferencesStore {
  const listeners = new Set<PreferencesListener>();
  let channel: BroadcastChannel | null = null;

  const notify = (preferences: Preferences) => {
    for (const listener of [...listeners]) {
      try {
        listener(preferences);
      } catch (error) {
        // One faulty listener must not stop the others or fail the save.
        console.error(error);
      }
    }
  };

  const getChannel = (): BroadcastChannel | null => {
    if (channel || typeof BroadcastChannel === "undefined") return channel;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      // Other tabs send whatever they stored; read it through the same validation as storage.
      channel.onmessage = (event) => notify(readPreferences(event.data));
    } catch {
      channel = null;
    }
    return channel;
  };

  return {
    async load(): Promise<Preferences> {
      try {
        const stored: unknown = await db.transaction(PREFERENCES_STORE, "readonly", (tx) =>
          request(tx.objectStore(PREFERENCES_STORE).get(PREFERENCES_KEY)),
        );
        return readPreferences(stored);
      } catch {
        return { ...DEFAULT_PREFERENCES };
      }
    },

    async save(patch): Promise<Preferences> {
      const checked = checkPreferencesPatch(patch);
      const next = await db.transaction(PREFERENCES_STORE, "readwrite", async (tx) => {
        const store = tx.objectStore(PREFERENCES_STORE);
        const stored: unknown = await request(store.get(PREFERENCES_KEY));
        const merged: Preferences = { ...readPreferences(stored), ...checked };
        await request(store.put(merged, PREFERENCES_KEY));
        return merged;
      });
      notify(next);
      try {
        // Without subscribers here the channel is opened only for this message, so nothing stays open.
        const keep = channel !== null;
        const out = getChannel();
        out?.postMessage(next);
        if (!keep && out) {
          out.close();
          channel = null;
        }
      } catch {
        // Cross-tab notification is best effort; the value is already stored.
      }
      return next;
    },

    subscribe(listener: PreferencesListener): () => void {
      listeners.add(listener);
      getChannel();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && channel) {
          channel.close();
          channel = null;
        }
      };
    },
  };
}
