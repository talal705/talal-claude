// Pure validation shared by the guest IndexedDB store and the server repository.
// No browser or Node APIs here, so both sides apply exactly the same rules.
import {
  DEFAULT_PREFERENCES,
  ProjectStoreError,
  type AvatarStyle,
  type CreateProjectInput,
  type LabMode,
  type LabType,
  type Preferences,
  type ProjectRecord,
  type ProjectSnapshot,
  type UpdateProjectInput,
} from "@ytl/contracts";

export const LAB_TYPES: readonly LabType[] = ["pc", "network", "code"];
export const LAB_MODES: readonly LabMode[] = ["learn", "free", "test"];
export const AVATAR_STYLES: readonly AvatarStyle[] = ["none", "boy", "man", "girl", "woman"];
export const REDUCED_MOTION_VALUES: readonly Preferences["reducedMotion"][] = ["system", "on", "off"];
export const ROBOT_FRAME_RATES: readonly Preferences["robotFrameRate"][] = [60, 30];

/** Same limits as the CHECK constraints in db/migrations/0001_initial.sql. */
export const TITLE_MAX_LENGTH = 200;
export const SNAPSHOT_LABEL_MAX_LENGTH = 200;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T>(allowed: readonly T[], value: unknown): value is T {
  return (allowed as readonly unknown[]).includes(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function invalid(message: string): never {
  throw new ProjectStoreError("invalid_input", message);
}

// ---------- Input ----------

function checkTitle(title: unknown): string {
  if (typeof title !== "string") invalid("title must be a string");
  if (title.trim().length === 0) invalid("title must not be empty");
  if (title.length > TITLE_MAX_LENGTH) invalid(`title must be at most ${TITLE_MAX_LENGTH} characters`);
  return title;
}

function checkDataVersion(dataVersion: unknown): number {
  if (!isPositiveInteger(dataVersion)) invalid("dataVersion must be an integer >= 1");
  return dataVersion;
}

/**
 * Returns the JSON form of `data`. Lab state must be JSON-serializable, so the guest store keeps the
 * same value the server would keep in a jsonb column (no Date, Map, undefined or class instances).
 */
export function toJsonData(data: unknown): unknown {
  let text: string | undefined;
  try {
    text = JSON.stringify(data);
  } catch {
    invalid("data is not JSON-serializable");
  }
  if (text === undefined) invalid("data is required and must be JSON-serializable");
  return JSON.parse(text);
}

export function checkCreateInput(input: CreateProjectInput): CreateProjectInput {
  if (!isObject(input)) invalid("input must be an object");
  if (!isOneOf(LAB_TYPES, input.lab)) invalid("lab must be one of pc, network, code");
  if (!isOneOf(LAB_MODES, input.mode)) invalid("mode must be one of learn, free, test");
  return {
    lab: input.lab,
    mode: input.mode,
    title: checkTitle(input.title),
    data: toJsonData(input.data),
    dataVersion: checkDataVersion(input.dataVersion),
  };
}

/** Only the fields present in the result are to be written. */
export function checkUpdateInput(input: UpdateProjectInput): UpdateProjectInput {
  if (!isObject(input)) invalid("input must be an object");
  const checked: UpdateProjectInput = { expectedRevision: checkExpectedRevision(input.expectedRevision) };
  if (input.title !== undefined) checked.title = checkTitle(input.title);
  if (input.mode !== undefined) {
    if (!isOneOf(LAB_MODES, input.mode)) invalid("mode must be one of learn, free, test");
    checked.mode = input.mode;
  }
  if (input.data !== undefined) checked.data = toJsonData(input.data);
  if (input.dataVersion !== undefined) checked.dataVersion = checkDataVersion(input.dataVersion);
  return checked;
}

export function checkExpectedRevision(expectedRevision: unknown): number {
  if (!isPositiveInteger(expectedRevision)) invalid("expectedRevision must be an integer >= 1");
  return expectedRevision;
}

export function checkSnapshotLabel(label: unknown): string {
  if (typeof label !== "string") invalid("label must be a string");
  if (label.length > SNAPSHOT_LABEL_MAX_LENGTH) {
    invalid(`label must be at most ${SNAPSHOT_LABEL_MAX_LENGTH} characters`);
  }
  return label;
}

export function checkLabFilter(filter: { lab?: LabType } | undefined): LabType | undefined {
  if (filter === undefined || filter.lab === undefined) return undefined;
  if (!isOneOf(LAB_TYPES, filter.lab)) invalid("lab must be one of pc, network, code");
  return filter.lab;
}

// ---------- Stored records ----------

export function isProjectRecord(value: unknown): value is ProjectRecord {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    (value.ownerId === null || typeof value.ownerId === "string") &&
    isOneOf(LAB_TYPES, value.lab) &&
    isOneOf(LAB_MODES, value.mode) &&
    typeof value.title === "string" &&
    "data" in value &&
    value.data !== undefined &&
    isPositiveInteger(value.dataVersion) &&
    isPositiveInteger(value.revision) &&
    isIsoTimestamp(value.createdAt) &&
    isIsoTimestamp(value.updatedAt)
  );
}

export function isProjectSnapshot(value: unknown): value is ProjectSnapshot {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.projectId === "string" &&
    isPositiveInteger(value.revision) &&
    typeof value.label === "string" &&
    "data" in value &&
    value.data !== undefined &&
    isPositiveInteger(value.dataVersion) &&
    isIsoTimestamp(value.createdAt)
  );
}

// ---------- Preferences ----------

type PreferencesPatch = Partial<Omit<Preferences, "version">>;

const PREFERENCE_CHECKS: { [K in keyof Omit<Preferences, "version">]: (value: unknown) => boolean } = {
  reducedMotion: (value) => isOneOf(REDUCED_MOTION_VALUES, value),
  soundEnabled: (value) => typeof value === "boolean",
  avatar: (value) => isOneOf(AVATAR_STYLES, value),
  robotVisible: (value) => typeof value === "boolean",
  robotFrameRate: (value) => isOneOf(ROBOT_FRAME_RATES, value),
  skipWorkstation: (value) => typeof value === "boolean",
};

const PREFERENCE_KEYS = Object.keys(PREFERENCE_CHECKS) as (keyof typeof PREFERENCE_CHECKS)[];

/**
 * Reads a stored value. Anything that is not a version 1 preferences object gives the defaults; a
 * single unreadable field falls back to its default without discarding the learner's other choices.
 */
export function readPreferences(value: unknown): Preferences {
  if (!isObject(value) || value.version !== DEFAULT_PREFERENCES.version) return { ...DEFAULT_PREFERENCES };
  const result: Record<string, unknown> = { ...DEFAULT_PREFERENCES };
  for (const key of PREFERENCE_KEYS) {
    if (PREFERENCE_CHECKS[key](value[key])) result[key] = value[key];
  }
  return result as unknown as Preferences;
}

/** Rejects unknown keys and invalid values; `undefined` fields are ignored. */
export function checkPreferencesPatch(patch: PreferencesPatch): PreferencesPatch {
  if (!isObject(patch)) invalid("patch must be an object");
  const checked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!isOneOf(PREFERENCE_KEYS, key)) invalid(`unknown preference: ${key}`);
    if (!PREFERENCE_CHECKS[key](value)) invalid(`invalid value for preference: ${key}`);
    checked[key] = value;
  }
  return checked as PreferencesPatch;
}
