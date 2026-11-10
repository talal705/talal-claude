// Guest storage on this device (IndexedDB). Browser-only at call time, but safe to import during
// server rendering: nothing is opened until a method is called. On the server, or when the browser
// blocks IndexedDB, project methods reject with ProjectStoreError("unavailable") and
// preferences.load() resolves to the defaults.
import type { ProjectStore } from "@ytl/contracts";
import { GuestDatabase } from "./guest-db";
import { createGuestProjectStore } from "./guest-project-store";
import { createGuestLessonProgressStore } from "./lesson-progress-store";
import type { LessonProgressStore } from "./progress";
import { createPreferencesStore, type ObservablePreferencesStore } from "./preferences-store";

export type { ObservablePreferencesStore, PreferencesListener } from "./preferences-store";
export type { LessonProgressList, LessonProgressRecord, LessonProgressStore } from "./progress";

let database: GuestDatabase | null = null;
let projectStore: ProjectStore | null = null;
let preferencesStore: ObservablePreferencesStore | null = null;
let lessonProgressStore: LessonProgressStore | null = null;

function getDatabase(): GuestDatabase {
  database ??= new GuestDatabase(() => globalThis.indexedDB);
  return database;
}

/** Same instance on every call. */
export function getGuestProjectStore(): ProjectStore {
  projectStore ??= createGuestProjectStore(getDatabase());
  return projectStore;
}

/** Same instance on every call. */
export function getPreferencesStore(): ObservablePreferencesStore {
  preferencesStore ??= createPreferencesStore(getDatabase());
  return preferencesStore;
}

/** Lesson progress of the guest on this device. Same instance on every call. */
export function getLessonProgressStore(): LessonProgressStore {
  lessonProgressStore ??= createGuestLessonProgressStore(getDatabase());
  return lessonProgressStore;
}
