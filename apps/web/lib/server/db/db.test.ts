// Integration tests against the real PostgreSQL test database (TEST_DATABASE_URL in the root .env.local).
// Each run works in its own temporary schema, so overlapping runs do not disturb each other, and
// refuses to run against anything but `yourtechlab_test`.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProjectStoreError, type ProjectStore, type ProjectStoreErrorCode } from "@ytl/contracts";
import { createDb, type Db } from "./client";
import { migrate, readMigrationFiles } from "./migrate";
import type { LessonProgress, StepRecord } from "@ytl/curriculum";
import type { LessonProgressStore } from "../../storage/progress";
import { createLessonProgressRepository } from "./progress-repository";
import { createProjectRepository } from "./project-repository";
import { assertTestDatabaseUrl, createTestSchema, type TestSchema } from "./testing";

const testUrl = process.env.TEST_DATABASE_URL;

const SKIP_MESSAGE =
  "SKIPPED: PostgreSQL integration tests did not run because TEST_DATABASE_URL is not set. " +
  "Copy .env.example to .env.local in the repository root and set it.";

// Written straight to stderr: the default reporter hides console output and skipped suite names.
if (!testUrl) process.stderr.write(`\n${SKIP_MESSAGE}\n`);

async function expectCode(promise: Promise<unknown>, code: ProjectStoreErrorCode): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ProjectStoreError);
  expect((error as ProjectStoreError).code).toBe(code);
}

const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const pcInput = { lab: "pc", mode: "free", title: "My first build", data: { parts: ["cpu"] }, dataVersion: 1 } as const;

describe("test database guard", () => {
  it("accepts only a URL that names yourtechlab_test", () => {
    const ok = "postgresql://ytl_app:secret@localhost:5432/yourtechlab_test";
    expect(assertTestDatabaseUrl(ok)).toBe(ok);
    expect(() => assertTestDatabaseUrl("postgresql://ytl_app:secret@localhost:5432/yourtechlab")).toThrow(/Refusing/);
    expect(() => assertTestDatabaseUrl("postgresql://ytl_app:secret@localhost:5432/postgres")).toThrow(/Refusing/);
    expect(() => assertTestDatabaseUrl("postgresql://ytl_app:secret@localhost:5432/")).toThrow(/Refusing/);
    expect(() => assertTestDatabaseUrl("not a url")).toThrow(/not a valid/);
  });

  it("refuses to create a test schema in a database that is not the test database", async () => {
    await expect(createTestSchema("postgresql://ytl_app:secret@localhost:5432/yourtechlab")).rejects.toThrow(
      /Refusing/,
    );
  });
});

// Generous: these wait on a real database that other test runs may be using at the same time.
describe.skipIf(!testUrl)(testUrl ? "PostgreSQL (TEST_DATABASE_URL)" : SKIP_MESSAGE, { timeout: 60_000 }, () => {
  let schema: TestSchema;
  let url: string;
  let db: Db;
  let aliceId: string;
  let bobId: string;
  let alice: ProjectStore;
  let bob: ProjectStore;

  async function schemaTables(): Promise<string[]> {
    const result = await sql<{ tablename: string }>`
      select tablename from pg_tables where schemaname = current_schema() order by tablename
    `.execute(db);
    return result.rows.map((row) => row.tablename);
  }

  beforeAll(async () => {
    schema = await createTestSchema(assertTestDatabaseUrl(testUrl!));
    url = schema.url;
    db = createDb(url, { maxConnections: 4 });
  });

  afterAll(async () => {
    await db?.destroy();
    await schema?.drop();
  });

  describe("migrations", () => {
    it("applies every migration to the empty database", async () => {
      // This run's own schema, and nothing else on the search path.
      const current = await sql<{ name: string }>`select current_schema() as name`.execute(db);
      expect(current.rows[0].name).toBe(schema.name);
      expect(schema.name).toMatch(/^ytl_test_\d+_\d+_[0-9a-f]{8}$/);
      expect(await schemaTables()).toEqual([]);
      const files = await readMigrationFiles();
      expect(files.map((file) => file.name)).toEqual(expect.arrayContaining(["0001_initial.sql", "0002_lesson_progress.sql"]));

      const result = await migrate(url);
      expect(result).toEqual({ applied: files.map((file) => file.name), skipped: [] });
      expect(await schemaTables()).toEqual(["lesson_progress", "preferences", "project_snapshots", "projects", "schema_migrations", "users"]);

      const recorded = await db.selectFrom("schema_migrations").select(["name", "checksum"]).orderBy("name").execute();
      expect(recorded).toEqual(files.map((file) => ({ name: file.name, checksum: file.checksum })));
    });

    it("does nothing when applied again", async () => {
      const before = await db.selectFrom("schema_migrations").selectAll().orderBy("name").execute();
      const result = await migrate(url);
      expect(result.applied).toEqual([]);
      expect(result.skipped).toEqual(before.map((row) => row.name));
      // Same rows, same applied_at: nothing was re-run.
      expect(await db.selectFrom("schema_migrations").selectAll().orderBy("name").execute()).toEqual(before);
    });

    it("rolls back a failing migration completely and refuses an edited one", async () => {
      const dir = await mkdtemp(join(tmpdir(), "ytl-migrations-"));
      try {
        const files = await readMigrationFiles();
        for (const file of files) await writeFile(join(dir, file.name), file.sql);
        await writeFile(join(dir, "9998_broken.sql"), "create table half_done (id integer); select * from no_such_table;");

        await expect(migrate(url, { dir })).rejects.toThrow(/9998_broken\.sql.*rolled back/);
        expect(await schemaTables()).not.toContain("half_done");
        const names = (await db.selectFrom("schema_migrations").select("name").execute()).map((row) => row.name);
        expect(names).not.toContain("9998_broken.sql");

        await rm(join(dir, "9998_broken.sql"));
        await writeFile(join(dir, files[0].name), `${files[0].sql}\n-- edited later`);
        await expect(migrate(url, { dir })).rejects.toThrow(/edited after it was applied/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("schema constraints", () => {
    it("rejects an unknown lab, a revision below 1 and a project without an existing owner", async () => {
      const owner = await db.insertInto("users").defaultValues().returning("id").executeTakeFirstOrThrow();
      const valid = { owner_id: owner.id, lab: "pc", mode: "free", title: "t", data: "{}", data_version: 1 } as const;

      await expect(db.insertInto("projects").values({ ...valid, lab: "radio" as never }).execute()).rejects.toMatchObject({ code: "23514" });
      await expect(db.insertInto("projects").values({ ...valid, mode: "play" as never }).execute()).rejects.toMatchObject({ code: "23514" });
      await expect(db.insertInto("projects").values({ ...valid, revision: 0 }).execute()).rejects.toMatchObject({ code: "23514" });
      await expect(db.insertInto("projects").values({ ...valid, title: "  " }).execute()).rejects.toMatchObject({ code: "23514" });
      await expect(db.insertInto("projects").values({ ...valid, owner_id: MISSING_ID }).execute()).rejects.toMatchObject({ code: "23503" });
      await db.deleteFrom("users").where("id", "=", owner.id).execute();
    });

    it("gives a new account the contract's default preferences", async () => {
      const user = await db.insertInto("users").defaultValues().returning("id").executeTakeFirstOrThrow();
      const row = await db.insertInto("preferences").values({ user_id: user.id }).returningAll().executeTakeFirstOrThrow();
      expect(row).toMatchObject({
        version: 1,
        reduced_motion: "system",
        sound_enabled: false,
        avatar: "none",
        robot_visible: true,
        robot_frame_rate: 60,
        skip_workstation: false,
      });
      await db.deleteFrom("users").where("id", "=", user.id).execute();
    });
  });

  describe("project repository", () => {
    beforeAll(async () => {
      const users = await db
        .insertInto("users")
        .values([{ email: "alice@example.test" }, { email: "bob@example.test" }])
        .returning("id")
        .execute();
      [aliceId, bobId] = users.map((user) => user.id);
      alice = createProjectRepository(db, aliceId);
      bob = createProjectRepository(db, bobId);
    });

    it("round-trips a project record", async () => {
      const data = { parts: ["cpu", { slot: "dimm-a2", size: 16 }], notes: "مرحبا", nested: [[1, 2], null] };
      const created = await alice.create({ ...pcInput, title: "جهازي الأول", data });

      expect(created).toMatchObject({ ownerId: aliceId, lab: "pc", mode: "free", title: "جهازي الأول", data, dataVersion: 1, revision: 1 });
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);
      expect(await alice.get(created.id)).toEqual(created);

      // A top-level array must come back as a JSON array, not a PostgreSQL array literal.
      const list = await alice.create({ ...pcInput, data: [1, "two", { three: 3 }] });
      expect((await alice.get(list.id)).data).toEqual([1, "two", { three: 3 }]);
    });

    it("increments the revision by 1 on update and rejects a stale expectedRevision", async () => {
      const created = await alice.create(pcInput);
      const second = await alice.update(created.id, { expectedRevision: 1, title: "Renamed", data: { parts: [] } });
      expect(second).toMatchObject({ title: "Renamed", data: { parts: [] }, mode: "free", revision: 2 });
      expect(second.updatedAt >= created.updatedAt).toBe(true);

      await expectCode(alice.update(created.id, { expectedRevision: 1, title: "Stale write" }), "revision_conflict");
      await expectCode(alice.update(created.id, { expectedRevision: 5, title: "Future write" }), "revision_conflict");
      expect(await alice.get(created.id)).toEqual(second);
    });

    it("lets exactly one of several concurrent updates with the same expectedRevision win", async () => {
      const created = await alice.create(pcInput);
      const results = await Promise.allSettled(
        ["a", "b", "c", "d"].map((title) => alice.update(created.id, { expectedRevision: 1, title })),
      );
      const rejected = results.filter((result) => result.status === "rejected");
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(rejected.map((result) => (result as PromiseRejectedResult).reason.code)).toEqual(Array(3).fill("revision_conflict"));
      expect((await alice.get(created.id)).revision).toBe(2);
    });

    it("does not let one owner read, list, update, snapshot or remove another owner's project", async () => {
      const mine = await alice.create({ ...pcInput, title: "Alice only" });
      const snapshot = await alice.createSnapshot(mine.id, "private");

      await expectCode(bob.get(mine.id), "not_found");
      await expectCode(bob.update(mine.id, { expectedRevision: 1, title: "Taken over" }), "not_found");
      await expectCode(bob.remove(mine.id), "not_found");
      await expectCode(bob.createSnapshot(mine.id, "copy"), "not_found");
      await expectCode(bob.listSnapshots(mine.id), "not_found");
      await expectCode(bob.restoreSnapshot(mine.id, snapshot.id, 1), "not_found");
      expect((await bob.list()).projects.map((project) => project.id)).not.toContain(mine.id);

      // Bob cannot pull Alice's snapshot into his own project either.
      const bobs = await bob.create({ ...pcInput, title: "Bob's", data: { parts: ["psu"] } });
      await expectCode(bob.restoreSnapshot(bobs.id, snapshot.id, 1), "not_found");
      expect(await bob.get(bobs.id)).toEqual(bobs);

      expect(await alice.get(mine.id)).toEqual(mine);
      expect(await alice.listSnapshots(mine.id)).toEqual([snapshot]);
    });

    it("lists only the owner's summaries, newest first, filtered by lab", async () => {
      const carolId = (await db.insertInto("users").defaultValues().returning("id").executeTakeFirstOrThrow()).id;
      const carol = createProjectRepository(db, carolId);
      const pc = await carol.create(pcInput);
      const network = await carol.create({ ...pcInput, lab: "network", title: "Home network" });
      await carol.update(pc.id, { expectedRevision: 1, title: "Touched last" });

      const all = await carol.list();
      expect(all.projects.map((project) => project.id)).toEqual([pc.id, network.id]);
      expect(all.projects.every((project) => !("data" in project) && project.ownerId === carolId)).toBe(true);
      expect(all.corruptIds).toEqual([]);
      expect((await carol.list({ lab: "network" })).projects.map((project) => project.id)).toEqual([network.id]);
      expect((await carol.list({ lab: "code" })).projects).toEqual([]);
    });

    it("snapshots without changing the revision and restores as a new revision", async () => {
      const created = await alice.create(pcInput);
      const snapshot = await alice.createSnapshot(created.id, "Original");
      expect(snapshot).toMatchObject({ projectId: created.id, revision: 1, label: "Original", dataVersion: 1 });
      expect("data" in snapshot).toBe(false);
      expect((await alice.get(created.id)).revision).toBe(1);

      await alice.update(created.id, { expectedRevision: 1, data: { parts: [] }, dataVersion: 3 });
      await expectCode(alice.restoreSnapshot(created.id, snapshot.id, 1), "revision_conflict");
      await expectCode(alice.restoreSnapshot(created.id, MISSING_ID, 2), "not_found");

      const restored = await alice.restoreSnapshot(created.id, snapshot.id, 2);
      expect(restored).toMatchObject({ data: pcInput.data, dataVersion: 1, revision: 3 });
      expect(await alice.get(created.id)).toEqual(restored);
      expect(await alice.listSnapshots(created.id)).toEqual([snapshot]);
    });

    it("removes a project with its snapshots, and an account with its projects", async () => {
      const doomed = await alice.create(pcInput);
      await alice.createSnapshot(doomed.id, "a");
      await alice.remove(doomed.id);
      await expectCode(alice.get(doomed.id), "not_found");
      await expectCode(alice.remove(doomed.id), "not_found");
      const orphans = await db.selectFrom("project_snapshots").select("id").where("project_id", "=", doomed.id).execute();
      expect(orphans).toEqual([]);

      const daveId = (await db.insertInto("users").defaultValues().returning("id").executeTakeFirstOrThrow()).id;
      const davesProject = await createProjectRepository(db, daveId).create(pcInput);
      await db.deleteFrom("users").where("id", "=", daveId).execute();
      expect(await db.selectFrom("projects").select("id").where("id", "=", davesProject.id).execute()).toEqual([]);
    });

    it("maps bad ids and bad input to contract errors instead of database errors", async () => {
      await expectCode(alice.get("not-a-uuid"), "not_found");
      await expectCode(alice.get(MISSING_ID), "not_found");
      await expectCode(alice.update("not-a-uuid", { expectedRevision: 1, title: "x" }), "not_found");
      await expectCode(alice.create({ ...pcInput, title: "" }), "invalid_input");
      await expectCode(alice.create({ ...pcInput, lab: "radio" as never }), "invalid_input");
      await expectCode(alice.create({ ...pcInput, data: { text: "nul \u0000 byte" } }), "invalid_input");
      expect(() => createProjectRepository(db, "not-a-uuid")).toThrow(ProjectStoreError);
      // An owner id with no account behind it cannot create anything.
      await expectCode(createProjectRepository(db, MISSING_ID).create(pcInput), "invalid_input");
    });

    it("reports unavailable when the database cannot be reached", async () => {
      const unreachable = createDb("postgresql://ytl_app:x@127.0.0.1:1/yourtechlab_test", { maxConnections: 1 });
      try {
        await expectCode(createProjectRepository(unreachable, aliceId).list(), "unavailable");
      } finally {
        await unreachable.destroy();
      }
    });
  });

  describe("lesson progress repository", () => {
    let carolId: string;
    let danId: string;
    let carol: LessonProgressStore;
    let dan: LessonProgressStore;
    const LESSON = "pc.beginner.memory-slots";
    const step = (stepId: string, overrides: Partial<StepRecord> = {}): StepRecord => ({ stepId, attempts: 1, hintLevel: 0, exampleShown: false, predictionCorrect: null, passed: true, independent: true, followUp: "not_offered", ...overrides });
    const run = (overrides: Partial<LessonProgress> = {}): LessonProgress => ({
      lessonId: LESSON,
      lessonVersion: 1,
      mode: "learn",
      status: "in_progress",
      stepIndex: 1,
      steps: [step("find-slots", { attempts: 3, hintLevel: 2, independent: false }), step("seat-module", { attempts: 0, passed: false, independent: false })],
      startedAt: "2026-10-13T08:00:00.000Z",
      updatedAt: "2026-10-13T08:05:00.000Z",
      ...overrides,
    });
    const finished = (completedAt: string) => run({ status: "completed", stepIndex: 2, updatedAt: completedAt, completedAt });

    beforeAll(async () => {
      const users = await db.insertInto("users").values([{ email: "carol@example.test" }, { email: "dan@example.test" }]).returning("id").execute();
      [carolId, danId] = users.map((user) => user.id);
      carol = createLessonProgressRepository(db, carolId);
      dan = createLessonProgressRepository(db, danId);
    });

    it("round-trips a run with its attempts and hints", async () => {
      expect(await carol.get(LESSON, "learn")).toBeNull();
      const saved = await carol.save(run());
      expect(saved).toEqual({ progress: run(), completedCount: 0, revision: 1 });
      expect(await carol.get(LESSON, "learn")).toEqual(saved);
      expect(saved.progress.steps[0]).toMatchObject({ attempts: 3, hintLevel: 2, independent: false });
    });

    it("counts completions once each, keeps the first, and survives a restart of the lesson", async () => {
      const first = await carol.save(finished("2026-10-13T08:10:00.000Z"));
      expect(first).toMatchObject({ completedCount: 1, firstCompletedAt: "2026-10-13T08:10:00.000Z", revision: 2 });
      // The same finished run written without milliseconds is still the same completion.
      expect((await carol.save({ ...finished("2026-10-13T08:10:00.000Z"), completedAt: "2026-10-13T08:10:00Z" })).completedCount).toBe(1);
      const restarted = await carol.save(run({ stepIndex: 0, updatedAt: "2026-10-14T08:00:00.000Z" }));
      expect(restarted).toMatchObject({ completedCount: 1, firstCompletedAt: "2026-10-13T08:10:00.000Z" });
      expect(restarted.progress).not.toHaveProperty("completedAt");
      expect((await carol.save(finished("2026-10-14T08:09:00.000Z"))).completedCount).toBe(2);
    });

    it("keeps one record per lesson and mode, and lists the owner's records by recency", async () => {
      await carol.save(run({ mode: "test", updatedAt: "2026-10-15T08:00:00.000Z" }));
      await carol.save(run({ lessonId: "network.beginner.cables", updatedAt: "2026-10-12T08:00:00.000Z" }));
      const listed = await carol.list();
      expect(listed.corruptKeys).toEqual([]);
      expect(listed.records.map((record) => [record.progress.lessonId, record.progress.mode])).toEqual([
        [LESSON, "test"],
        [LESSON, "learn"],
        ["network.beginner.cables", "learn"],
      ]);
    });

    it("does not lose a completion when two saves arrive together", async () => {
      const lessonId = "code.beginner.concurrent";
      const results = await Promise.all([
        carol.save(run({ lessonId })),
        carol.save(run({ lessonId, stepIndex: 2 })),
        carol.save({ ...finished("2026-10-13T09:00:00.000Z"), lessonId }),
      ]);
      expect(results.map((record) => record.revision).sort()).toEqual([1, 2, 3]);
      const stored = await carol.get(lessonId, "learn");
      expect(stored).toMatchObject({ revision: 3, completedCount: 1 });
    });

    it("does not let one account read, overwrite or remove another account's progress", async () => {
      expect(await dan.get(LESSON, "learn")).toBeNull();
      expect((await dan.list()).records).toEqual([]);
      await dan.remove(LESSON, "learn");
      const carols = await carol.get(LESSON, "learn");
      expect(carols?.completedCount).toBe(2);

      // Dan's own record for the same lesson is separate.
      const dans = await dan.save(run());
      expect(dans).toMatchObject({ revision: 1, completedCount: 0 });
      expect(await carol.get(LESSON, "learn")).toEqual(carols);
    });

    it("rejects invalid progress, reports a damaged row, and removes with the account", async () => {
      await expectCode(carol.save({ ...run(), status: "done" } as never), "invalid_input");
      await expectCode(carol.save({ ...run(), steps: [{ stepId: "a" }] } as never), "invalid_input");
      await expectCode(carol.get("", "learn"), "invalid_input");
      expect(() => createLessonProgressRepository(db, "not-a-uuid")).toThrow(ProjectStoreError);
      // The table refuses a completed row that was never counted, whatever the application sends.
      await expect(
        db.insertInto("lesson_progress").values({ user_id: danId, lesson_id: "x", mode: "learn", lesson_version: 1, status: "completed", step_index: 0, steps: "[]", updated_at: new Date() }).execute(),
      ).rejects.toMatchObject({ code: "23514" });

      // A row whose steps were damaged outside the application is reported, not hidden and not deleted.
      await db.updateTable("lesson_progress").set({ steps: JSON.stringify([{ stepId: 5 }]) }).where("user_id", "=", danId).where("lesson_id", "=", LESSON).execute();
      await expectCode(dan.get(LESSON, "learn"), "corrupt");
      expect(await dan.list()).toEqual({ records: [], corruptKeys: [`${LESSON}:learn`] });

      await carol.remove(LESSON, "test");
      expect(await carol.get(LESSON, "test")).toBeNull();
      await db.deleteFrom("users").where("id", "=", danId).execute();
      expect(await db.selectFrom("lesson_progress").select("lesson_id").where("user_id", "=", danId).execute()).toEqual([]);
    });
  });
});
