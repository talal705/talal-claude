"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import type { SessionState } from "./session";

/** The part of a lab's store the shared project components need. Every lab store fits it. */
export interface SessionStore {
  getState(): SessionState<unknown>;
  subscribe(listener: (state: SessionState<unknown>) => void): () => void;
}

const SessionContext = createContext<SessionStore | null>(null);

export const SessionProvider = SessionContext.Provider;

export function useSessionStore(): SessionStore {
  const store = useContext(SessionContext);
  if (!store) throw new Error("useSessionStore must be used inside a ProjectLoader");
  return store;
}

/** Reads one value from a session store. The selector must return a primitive or a stable reference. */
export function useStoreValue<V>(store: SessionStore, selector: (state: SessionState<unknown>) => V): V {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

/** Reads one value from the open project's session. */
export function useSession<V>(selector: (state: SessionState<unknown>) => V): V {
  return useStoreValue(useSessionStore(), selector);
}
