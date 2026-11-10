// Projects of a lab that left the active product (the former Code Studio, decision 8 of
// 2026-10-27). They stay on the device exactly as saved: never opened, never migrated, never
// reported as damaged. The learner can export one as JSON or delete it.
import type { ProjectRecord, ProjectSnapshot, ProjectSummary } from "@ytl/contracts";
import { isLab } from "../labs";

export const ARCHIVE_EXPORT_FORMAT = "ytl-archived-project";
export const ARCHIVE_EXPORT_FORMAT_VERSION = 1;

export function isArchived(project: Pick<ProjectSummary, "lab">): boolean {
  return !isLab(project.lab);
}

export interface ArchivedProjectExport {
  format: typeof ARCHIVE_EXPORT_FORMAT;
  formatVersion: typeof ARCHIVE_EXPORT_FORMAT_VERSION;
  exportedAt: string;
  /** The record as stored, data unchanged. */
  project: ProjectRecord;
  snapshots: ProjectSnapshot[];
}

export function exportArchived(project: ProjectRecord, snapshots: readonly ProjectSnapshot[], now: Date): ArchivedProjectExport {
  return {
    format: ARCHIVE_EXPORT_FORMAT,
    formatVersion: ARCHIVE_EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    project,
    snapshots: [...snapshots],
  };
}
