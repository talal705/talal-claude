// Kysely types for the tables created by db/migrations. Keep in step with the SQL files.
import type { ColumnType, Generated, Insertable, Selectable } from "kysely";
import type { AvatarStyle, LabMode, LabType, Locale, Preferences } from "@ytl/contracts";

/** timestamptz: read as Date, written as Date or ISO string, defaulted by the database. */
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
/** jsonb: read parsed, written as JSON text (always JSON.stringify; pg would send an array as a PostgreSQL array). */
type Json = ColumnType<unknown, string, string>;

export interface UsersTable {
  id: Generated<string>;
  email: string | null;
  display_name: string | null;
  locale: Generated<Locale>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProjectsTable {
  id: Generated<string>;
  owner_id: string;
  lab: LabType;
  mode: LabMode;
  title: string;
  data: Json;
  data_version: number;
  revision: Generated<number>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProjectSnapshotsTable {
  id: Generated<string>;
  project_id: string;
  revision: number;
  label: string;
  data: Json;
  data_version: number;
  created_at: Timestamp;
}

export interface PreferencesTable {
  user_id: string;
  version: Generated<number>;
  reduced_motion: Generated<Preferences["reducedMotion"]>;
  sound_enabled: Generated<boolean>;
  avatar: Generated<AvatarStyle>;
  robot_visible: Generated<boolean>;
  robot_frame_rate: Generated<Preferences["robotFrameRate"]>;
  skip_workstation: Generated<boolean>;
  updated_at: Timestamp;
}

export interface LessonProgressTable {
  user_id: string;
  lesson_id: string;
  mode: "learn" | "test";
  lesson_version: number;
  status: "in_progress" | "completed";
  step_index: number;
  steps: Json;
  started_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  completed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  updated_at: Timestamp;
  completed_count: Generated<number>;
  first_completed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  revision: Generated<number>;
  verified: Generated<boolean>;
}

export interface SchemaMigrationsTable {
  name: string;
  checksum: string;
  applied_at: Timestamp;
}

export interface Database {
  users: UsersTable;
  projects: ProjectsTable;
  project_snapshots: ProjectSnapshotsTable;
  preferences: PreferencesTable;
  lesson_progress: LessonProgressTable;
  schema_migrations: SchemaMigrationsTable;
}

export type UserRow = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type ProjectRow = Selectable<ProjectsTable>;
export type ProjectSnapshotRow = Selectable<ProjectSnapshotsTable>;
export type PreferencesRow = Selectable<PreferencesTable>;
export type LessonProgressRow = Selectable<LessonProgressTable>;
