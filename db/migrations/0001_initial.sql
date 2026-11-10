-- 0001_initial: accounts foundation, projects with revisions and snapshots, preferences.
-- Mirrors contracts v1 (packages/contracts/src/platform.ts). The runner wraps this file in one
-- transaction, so it contains no BEGIN/COMMIT. Applied migrations are never edited: add a new file.

-- Accounts foundation. Sign-in is not designed yet, so the identity columns are nullable for now.
create table users (
  id           uuid primary key default gen_random_uuid(),
  email        text,
  display_name text,
  locale       text not null default 'en' check (locale in ('en', 'ar')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index users_email_lower_key on users (lower(email));

-- Server projects always have an owner; guest projects (ownerId null) stay in the browser.
create table projects (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references users (id) on delete cascade,
  lab          text not null check (lab in ('pc', 'network', 'code')),
  mode         text not null check (mode in ('learn', 'free', 'test')),
  title        text not null check (char_length(title) <= 200 and btrim(title) <> ''),
  data         jsonb not null,
  data_version integer not null check (data_version >= 1),
  revision     integer not null default 1 check (revision >= 1),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index projects_owner_updated_idx on projects (owner_id, updated_at desc);

create table project_snapshots (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects (id) on delete cascade,
  -- Revision of the project when the snapshot was taken.
  revision     integer not null check (revision >= 1),
  label        text not null check (char_length(label) <= 200),
  data         jsonb not null,
  data_version integer not null check (data_version >= 1),
  created_at   timestamptz not null default now()
);

create index project_snapshots_project_created_idx on project_snapshots (project_id, created_at desc);

-- One row per account; defaults equal DEFAULT_PREFERENCES.
create table preferences (
  user_id          uuid primary key references users (id) on delete cascade,
  version          integer not null default 1 check (version = 1),
  reduced_motion   text not null default 'system' check (reduced_motion in ('system', 'on', 'off')),
  sound_enabled    boolean not null default false,
  avatar           text not null default 'none' check (avatar in ('none', 'boy', 'man', 'girl', 'woman')),
  robot_visible    boolean not null default true,
  robot_frame_rate smallint not null default 60 check (robot_frame_rate in (60, 30)),
  skip_workstation boolean not null default false,
  updated_at       timestamptz not null default now()
);
