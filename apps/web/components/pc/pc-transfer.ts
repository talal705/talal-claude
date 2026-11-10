// Export and import of one PC build as a single JSON file. The file carries the build's action
// log, not its state: importing replays the log under the current catalog and rules, so a file
// cannot smuggle in a build the engine would not allow.
import type { LabMode, Localized, PCAction, PCCatalog, PCProjectData } from "@ytl/contracts";
import { pc } from "@ytl/simulation";
import { isMode } from "../labs";
import { TITLE_MAX_LENGTH } from "../project/session";
import { migrateLog } from "./pc-model";

export const PC_EXPORT_FORMAT = "ytl-pc-build";
export const PC_EXPORT_FORMAT_VERSION = 1;
export const MAX_PC_IMPORT_CHARS = 2 * 1024 * 1024;
/** Far above any build a learner makes by hand; stops a hostile file from keeping the page busy. */
export const MAX_PC_LOG_ACTIONS = 5000;

export interface ExportedBuild {
  format: typeof PC_EXPORT_FORMAT;
  formatVersion: typeof PC_EXPORT_FORMAT_VERSION;
  exportedAt: string;
  title: string;
  mode: LabMode;
  /** The catalog the build was last saved under, for information. */
  catalogVersion: string;
  log: PCAction[];
}

export function exportBuild(title: string, mode: LabMode, data: PCProjectData, now: Date): ExportedBuild {
  return {
    format: PC_EXPORT_FORMAT,
    formatVersion: PC_EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    title,
    mode,
    catalogVersion: data.state.catalogVersion,
    log: data.log,
  };
}

export type PCImportProblem =
  | "file_too_large"
  | "not_json"
  | "wrong_format"
  | "unsupported_version"
  | "invalid_title"
  | "invalid_log"
  /** The current catalog or rules refuse one of the file's steps; `reason` is the engine's sentence. */
  | "step_refused";

export type PCImportResult =
  | { ok: true; title: string; mode: LabMode; data: PCProjectData }
  | { ok: false; problem: PCImportProblem; reason?: Localized };

export function importBuild(text: string, catalog: PCCatalog): PCImportResult {
  if (text.length > MAX_PC_IMPORT_CHARS) return { ok: false, problem: "file_too_large" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, problem: "not_json" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, problem: "wrong_format" };
  const file = parsed as Record<string, unknown>;
  if (file.format !== PC_EXPORT_FORMAT) return { ok: false, problem: "wrong_format" };
  if (file.formatVersion !== PC_EXPORT_FORMAT_VERSION) return { ok: false, problem: "unsupported_version" };
  if (typeof file.title !== "string" || file.title.trim().length === 0 || file.title.length > TITLE_MAX_LENGTH) {
    return { ok: false, problem: "invalid_title" };
  }
  const { log } = file;
  if (
    !Array.isArray(log) ||
    log.length > MAX_PC_LOG_ACTIONS ||
    !log.every((action) => typeof action === "object" && action !== null && !Array.isArray(action) && typeof (action as { type?: unknown }).type === "string")
  ) {
    return { ok: false, problem: "invalid_log" };
  }
  let replayed: ReturnType<typeof pc.replay>;
  try {
    replayed = pc.replay(migrateLog(log as PCAction[], catalog), catalog);
  } catch {
    // An action with a known type but a malformed body.
    return { ok: false, problem: "invalid_log" };
  }
  const refused = replayed.events.find((event) => !event.accepted);
  if (refused) return { ok: false, problem: "step_refused", reason: refused.rejection?.message };
  return { ok: true, title: file.title, mode: isMode(file.mode) ? file.mode : "free", data: { state: replayed.state, log: migrateLog(log as PCAction[], catalog) } };
}
