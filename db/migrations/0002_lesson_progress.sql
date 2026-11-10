-- 0002_lesson_progress: one record per account, lesson and mode. Mirrors LessonProgressRecord
-- (apps/web/lib/storage/progress.ts): the latest run as the lesson runner produced it, plus how
-- often the lesson was completed.

create table lesson_progress (
  user_id            uuid not null references users (id) on delete cascade,
  lesson_id          text not null check (char_length(lesson_id) between 1 and 200),
  mode               text not null check (mode in ('learn', 'test')),
  lesson_version     integer not null check (lesson_version >= 1),
  status             text not null check (status in ('in_progress', 'completed')),
  step_index         integer not null check (step_index >= 0),
  -- StepRecord[]: attempts, highest hint level, example shown, prediction, passed, independent, follow-up.
  steps              jsonb not null check (jsonb_typeof(steps) = 'array'),
  started_at         timestamptz,
  completed_at       timestamptz,
  updated_at         timestamptz not null default now(),
  completed_count    integer not null default 0 check (completed_count >= 0),
  first_completed_at timestamptz,
  revision           integer not null default 1 check (revision >= 1),
  -- What the browser reported. Set to true only by a server-side check of the lesson, which does not exist yet.
  verified           boolean not null default false,
  primary key (user_id, lesson_id, mode),
  check (status <> 'completed' or completed_count >= 1)
);

create index lesson_progress_user_updated_idx on lesson_progress (user_id, updated_at desc);
