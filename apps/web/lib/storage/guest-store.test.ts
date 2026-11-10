import { IDBFactory as FakeIDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, ProjectStoreError, type ProjectStoreErrorCode } from "@ytl/contracts";
import {
  GuestDatabase,
  LESSON_PROGRESS_STORE,
  MIGRATIONS,
  PREFERENCES_STORE,
  PROJECTS_STORE,
  SNAPSHOTS_STORE,
  openGuestDatabase,
  request,
  type GuestMigration,
} from "./guest-db";
import { createGuestProjectStore } from "./guest-project-store";
import { PREFERENCES_KEY, createPreferencesStore } from "./preferences-store";
import { getGuestProjectStore, getPreferencesStore } from "./index";

const DB_NAME = "ytl-guest-test";

let factory: IDBFactory;

/** A fresh store over the current database: what the app gets after a page reload. */
function openStores(migrations: readonly GuestMigration[] = MIGRATIONS) {
  const db = new GuestDatabase(() => factory, DB_NAME, migrations);
  let tick = 0;
  // A strictly increasing clock keeps ordering assertions deterministic.
  const now = () => new Date(Date.UTC(2026, 9, 10, 12, 0, tick++));
  return { db, projects: createGuestProjectStore(db, { now }), preferences: createPreferencesStore(db) };
}

/** Writes a value straight into IndexedDB, bypassing the store's validation. */
async function putRaw(storeName: string, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await openGuestDatabase(factory, DB_NAME);
  const tx = db.transaction(storeName, "readwrite");
  await request(tx.objectStore(storeName).put(value, key));
  db.close();
}

async function getRaw(storeName: string, key: IDBValidKey): Promise<unknown> {
  const db = await openGuestDatabase(factory, DB_NAME);
  const value: unknown = await request(db.transaction(storeName, "readonly").objectStore(storeName).get(key));
  db.close();
  return value;
}

async function expectCode(promise: Promise<unknown>, code: ProjectStoreErrorCode): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ProjectStoreError);
  expect((error as ProjectStoreError).code).toBe(code);
}

const pcInput = { lab: "pc", mode: "free", title: "My first build", data: { parts: ["cpu"] }, dataVersion: 1 } as const;

beforeEach(() => {
  factory = new FakeIDBFactory() as unknown as IDBFactory;
});

describe("guest project store", () => {
  it("creates a guest project at revision 1 and reads it back", async () => {
    const { projects } = openStores();
    const created = await projects.create(pcInput);

    expect(created).toMatchObject({ ...pcInput, ownerId: null, revision: 1 });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.createdAt).toBe(created.updatedAt);
    expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);
    expect(await projects.get(created.id)).toEqual(created);
  });

  it("rejects invalid input without writing", async () => {
    const { projects } = openStores();
    await expectCode(projects.create({ ...pcInput, title: "   " }), "invalid_input");
    await expectCode(projects.create({ ...pcInput, title: "x".repeat(201) }), "invalid_input");
    await expectCode(projects.create({ ...pcInput, lab: "radio" as never }), "invalid_input");
    await expectCode(projects.create({ ...pcInput, dataVersion: 0 }), "invalid_input");
    await expectCode(projects.create({ ...pcInput, data: undefined }), "invalid_input");
    await expectCode(projects.create({ ...pcInput, data: { big: 1n } }), "invalid_input");
    expect(await projects.list()).toEqual({ projects: [], corruptIds: [] });
  });

  it("updates the given fields and increments the revision by exactly 1", async () => {
    const { projects } = openStores();
    const created = await projects.create(pcInput);

    const second = await projects.update(created.id, { expectedRevision: 1, title: "Renamed" });
    expect(second).toMatchObject({ title: "Renamed", data: pcInput.data, mode: "free", revision: 2 });
    expect(second.createdAt).toBe(created.createdAt);
    expect(second.updatedAt > created.updatedAt).toBe(true);

    const third = await projects.update(created.id, {
      expectedRevision: 2,
      data: { parts: ["cpu", "ram"] },
      dataVersion: 2,
      mode: "test",
    });
    expect(third).toMatchObject({ title: "Renamed", data: { parts: ["cpu", "ram"] }, dataVersion: 2, mode: "test", revision: 3 });
    expect(await projects.get(created.id)).toEqual(third);
  });

  it("fails with revision_conflict on a stale expectedRevision and writes nothing", async () => {
    const { projects } = openStores();
    const created = await projects.create(pcInput);
    const current = await projects.update(created.id, { expectedRevision: 1, title: "Second" });

    await expectCode(projects.update(created.id, { expectedRevision: 1, title: "Stale write" }), "revision_conflict");
    await expectCode(projects.update(created.id, { expectedRevision: 3, title: "Future write" }), "revision_conflict");
    expect(await projects.get(created.id)).toEqual(current);
  });

  it("lets only one of two concurrent updates with the same expectedRevision win", async () => {
    const { projects } = openStores();
    const otherTab = openStores().projects;
    const created = await projects.create(pcInput);

    const results = await Promise.allSettled([
      projects.update(created.id, { expectedRevision: 1, title: "Tab A" }),
      otherTab.update(created.id, { expectedRevision: 1, title: "Tab B" }),
    ]);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "revision_conflict" });
    expect((await projects.get(created.id)).revision).toBe(2);
  });

  it("reports not_found for an unknown project", async () => {
    const { projects } = openStores();
    await expectCode(projects.get("missing"), "not_found");
    await expectCode(projects.update("missing", { expectedRevision: 1, title: "x" }), "not_found");
    await expectCode(projects.remove("missing"), "not_found");
    await expectCode(projects.createSnapshot("missing", "x"), "not_found");
    await expectCode(projects.listSnapshots("missing"), "not_found");
    await expectCode(projects.restoreSnapshot("missing", "missing", 1), "not_found");
  });

  it("lists summaries newest first, without data, filtered by lab", async () => {
    const { projects } = openStores();
    const pc = await projects.create(pcInput);
    const network = await projects.create({ ...pcInput, lab: "network", title: "Home network" });
    const code = await projects.create({ ...pcInput, lab: "code", title: "Hello" });
    await projects.update(pc.id, { expectedRevision: 1, title: "Touched last" });

    const all = await projects.list();
    expect(all.projects.map((project) => project.id)).toEqual([pc.id, code.id, network.id]);
    expect(all.projects.every((project) => !("data" in project))).toBe(true);
    expect(all.corruptIds).toEqual([]);

    const onlyNetwork = await projects.list({ lab: "network" });
    expect(onlyNetwork.projects.map((project) => project.id)).toEqual([network.id]);
  });

  it("takes a snapshot of the current data without changing the revision", async () => {
    const { projects } = openStores();
    const created = await projects.create(pcInput);
    await projects.update(created.id, { expectedRevision: 1, data: { parts: ["cpu", "ram"] } });

    const snapshot = await projects.createSnapshot(created.id, "Before the GPU");
    expect(snapshot).toMatchObject({ projectId: created.id, revision: 2, label: "Before the GPU", dataVersion: 1 });
    expect("data" in snapshot).toBe(false);
    expect((await projects.get(created.id)).revision).toBe(2);

    const later = await projects.createSnapshot(created.id, "Second");
    expect(await projects.listSnapshots(created.id)).toEqual([later, snapshot]);
  });

  it("restores a snapshot as a new revision and keeps the snapshot", async () => {
    const { projects } = openStores();
    const created = await projects.create(pcInput);
    const snapshot = await projects.createSnapshot(created.id, "Original");
    await projects.update(created.id, { expectedRevision: 1, data: { parts: [] }, dataVersion: 3, title: "Emptied" });

    await expectCode(projects.restoreSnapshot(created.id, snapshot.id, 1), "revision_conflict");
    expect((await projects.get(created.id)).data).toEqual({ parts: [] });

    const restored = await projects.restoreSnapshot(created.id, snapshot.id, 2);
    expect(restored).toMatchObject({ data: pcInput.data, dataVersion: 1, revision: 3, title: "Emptied" });
    expect(await projects.get(created.id)).toEqual(restored);
    expect(await projects.listSnapshots(created.id)).toEqual([snapshot]);
  });

  it("does not restore a snapshot that belongs to another project", async () => {
    const { projects } = openStores();
    const first = await projects.create(pcInput);
    const second = await projects.create({ ...pcInput, title: "Other", data: { parts: ["psu"] } });
    const foreign = await projects.createSnapshot(second.id, "Other project");

    await expectCode(projects.restoreSnapshot(first.id, foreign.id, 1), "not_found");
    expect(await projects.get(first.id)).toEqual(first);
  });

  it("removes a project together with its snapshots only", async () => {
    const { projects } = openStores();
    const doomed = await projects.create(pcInput);
    const kept = await projects.create({ ...pcInput, title: "Kept" });
    const doomedSnapshot = await projects.createSnapshot(doomed.id, "a");
    const keptSnapshot = await projects.createSnapshot(kept.id, "b");

    await projects.remove(doomed.id);

    await expectCode(projects.get(doomed.id), "not_found");
    expect((await projects.list()).projects.map((project) => project.id)).toEqual([kept.id]);
    expect(await getRaw(SNAPSHOTS_STORE, doomedSnapshot.id)).toBeUndefined();
    expect(await projects.listSnapshots(kept.id)).toEqual([keptSnapshot]);
  });

  it("recovers projects, revisions and snapshots after a reload", async () => {
    const before = openStores();
    const created = await before.projects.create(pcInput);
    const snapshot = await before.projects.createSnapshot(created.id, "Checkpoint");
    const updated = await before.projects.update(created.id, { expectedRevision: 1, data: { parts: ["cpu", "gpu"] } });
    await before.db.close();

    const after = openStores();
    expect(await after.projects.get(created.id)).toEqual(updated);
    expect((await after.projects.list()).projects).toHaveLength(1);
    expect(await after.projects.listSnapshots(created.id)).toEqual([snapshot]);
    // The revision counter continues from the stored value.
    expect((await after.projects.update(created.id, { expectedRevision: 2, title: "After reload" })).revision).toBe(3);
  });

  it("reports a corrupt record, keeps it in place, and still lists the others", async () => {
    const { projects } = openStores();
    const good = await projects.create(pcInput);
    const broken = { id: "broken-1", lab: "pc", title: 42, revision: "three" };
    await putRaw(PROJECTS_STORE, broken);
    await putRaw(PROJECTS_STORE, { id: "broken-2" });

    const listed = await projects.list();
    expect(listed.projects.map((project) => project.id)).toEqual([good.id]);
    expect(listed.corruptIds.sort()).toEqual(["broken-1", "broken-2"]);
    // Also under a filter: a corrupt record's lab cannot be trusted.
    expect((await projects.list({ lab: "code" })).corruptIds.sort()).toEqual(["broken-1", "broken-2"]);

    await expectCode(projects.get("broken-1"), "corrupt");
    await expectCode(projects.update("broken-1", { expectedRevision: 1, title: "fix" }), "corrupt");
    await expectCode(projects.createSnapshot("broken-1", "x"), "corrupt");
    expect(await getRaw(PROJECTS_STORE, "broken-1")).toEqual(broken);

    // Only an explicit remove deletes it.
    await projects.remove("broken-1");
    expect((await projects.list()).corruptIds).toEqual(["broken-2"]);
  });

  it("reports a corrupt snapshot on restore and leaves the project unchanged", async () => {
    const { projects } = openStores();
    const created = await projects.create(pcInput);
    const good = await projects.createSnapshot(created.id, "good");
    await putRaw(SNAPSHOTS_STORE, { id: "bad-snapshot", projectId: created.id, revision: 0 });

    expect(await projects.listSnapshots(created.id)).toEqual([good]);
    await expectCode(projects.restoreSnapshot(created.id, "bad-snapshot", 1), "corrupt");
    expect(await projects.get(created.id)).toEqual(created);
    expect(await getRaw(SNAPSHOTS_STORE, "bad-snapshot")).toBeDefined();
  });

  it("stores the JSON form of data", async () => {
    const { projects } = openStores();
    const created = await projects.create({ ...pcInput, data: { when: new Date(0), skip: undefined, list: [1] } });
    expect(created.data).toEqual({ when: "1970-01-01T00:00:00.000Z", list: [1] });
  });
});

describe("guest database schema", () => {
  it("creates the current schema in an empty database", async () => {
    const db = await openGuestDatabase(factory, DB_NAME);
    expect(db.version).toBe(MIGRATIONS.length);
    expect(db.version).toBe(2);
    expect([...db.objectStoreNames].sort()).toEqual([LESSON_PROGRESS_STORE, PREFERENCES_STORE, PROJECTS_STORE, SNAPSHOTS_STORE].sort());
    db.close();
  });

  it("upgrades a version 1 database to the current schema and keeps its records", async () => {
    // A browser that last ran the first release: only the version 1 stores exist.
    const v1 = openStores(MIGRATIONS.slice(0, 1));
    const created = await v1.projects.create(pcInput);
    await v1.preferences.save({ soundEnabled: true });
    await v1.db.close();
    const before = await openGuestDatabase(factory, DB_NAME, MIGRATIONS.slice(0, 1));
    expect([before.version, [...before.objectStoreNames]]).toEqual([1, expect.not.arrayContaining([LESSON_PROGRESS_STORE])]);
    before.close();

    const ran: number[] = [];
    const recorded: GuestMigration[] = MIGRATIONS.map((step, index) => (db, tx) => {
      ran.push(index + 1);
      step(db, tx);
    });
    const current = openStores(recorded);
    expect(await current.projects.get(created.id)).toEqual(created);
    expect((await current.preferences.load()).soundEnabled).toBe(true);
    // Only the missing step ran.
    expect(ran).toEqual([2]);
    await current.db.close();

    const after = await openGuestDatabase(factory, DB_NAME);
    expect(after.version).toBe(2);
    expect([...after.objectStoreNames]).toContain(LESSON_PROGRESS_STORE);
    after.close();
  });

  it("applies a later step on top of the current schema", async () => {
    const now = openStores();
    const created = await now.projects.create(pcInput);
    await now.db.close();
    const next: GuestMigration[] = [
      ...MIGRATIONS,
      (db, tx) => {
        db.createObjectStore("attempts", { keyPath: "id" });
        tx.objectStore(PROJECTS_STORE).createIndex("lab", "lab");
      },
    ];
    const later = openStores(next);
    expect(await later.projects.get(created.id)).toEqual(created);
    await later.db.close();
    const raw = await openGuestDatabase(factory, DB_NAME, next);
    expect([raw.version, [...raw.objectStoreNames].includes("attempts")]).toEqual([3, true]);
    raw.close();
  });

  it("reports unavailable when the database was written by a newer build", async () => {
    const newer: GuestMigration[] = [...MIGRATIONS, () => {}];
    const future = openStores(newer);
    const created = await future.projects.create(pcInput);
    await future.db.close();

    const current = openStores();
    await expectCode(current.projects.list(), "unavailable");
    expect(await current.preferences.load()).toEqual(DEFAULT_PREFERENCES);
    // The newer data is untouched.
    expect(await openStores(newer).projects.get(created.id)).toEqual(created);
  });

  it("reports unavailable when IndexedDB does not exist or throws on access", async () => {
    const missing = createGuestProjectStore(new GuestDatabase(() => undefined));
    await expectCode(missing.list(), "unavailable");
    await expectCode(missing.create(pcInput), "unavailable");

    const blocked = new GuestDatabase(() => {
      throw new DOMException("denied", "SecurityError");
    });
    await expectCode(createGuestProjectStore(blocked).get("x"), "unavailable");
    expect(await createPreferencesStore(blocked).load()).toEqual(DEFAULT_PREFERENCES);
    await expectCode(createPreferencesStore(blocked).save({ soundEnabled: true }), "unavailable");
  });
});

describe("preferences store", () => {
  it("returns the contract defaults when nothing is stored", async () => {
    const { preferences } = openStores();
    const loaded = await preferences.load();
    expect(loaded).toEqual(DEFAULT_PREFERENCES);
    expect(loaded).toMatchObject({ soundEnabled: false, reducedMotion: "system", avatar: "none", robotVisible: true });
    // A copy: mutating the result must not change the defaults.
    expect(loaded).not.toBe(DEFAULT_PREFERENCES);
  });

  it("merges a patch, persists it and survives a reload", async () => {
    const before = openStores();
    expect(await before.preferences.save({ reducedMotion: "on", robotVisible: false })).toEqual({
      ...DEFAULT_PREFERENCES,
      reducedMotion: "on",
      robotVisible: false,
    });
    const saved = await before.preferences.save({ avatar: "girl", soundEnabled: true, robotFrameRate: 30 });
    expect(saved).toEqual({
      version: 1,
      reducedMotion: "on",
      soundEnabled: true,
      avatar: "girl",
      robotVisible: false,
      robotFrameRate: 30,
      skipWorkstation: false,
    });
    await before.db.close();

    expect(await openStores().preferences.load()).toEqual(saved);
  });

  it("rejects an invalid patch and keeps the stored value", async () => {
    const { preferences } = openStores();
    const saved = await preferences.save({ avatar: "man" });
    await expectCode(preferences.save({ avatar: "robot" as never }), "invalid_input");
    await expectCode(preferences.save({ robotFrameRate: 45 as never }), "invalid_input");
    await expectCode(preferences.save({ version: 2 } as never), "invalid_input");
    expect(await preferences.load()).toEqual(saved);
  });

  it("returns the defaults for a corrupt stored value and does not throw", async () => {
    const { preferences } = openStores();
    for (const corruptValue of ["not an object", 7, null, [], { version: 99, soundEnabled: true }]) {
      await putRaw(PREFERENCES_STORE, corruptValue, PREFERENCES_KEY);
      expect(await preferences.load()).toEqual(DEFAULT_PREFERENCES);
    }
  });

  it("falls back per field when one stored field is unreadable", async () => {
    const { preferences } = openStores();
    await putRaw(
      PREFERENCES_STORE,
      { version: 1, reducedMotion: "sometimes", soundEnabled: "yes", avatar: "woman", robotVisible: false, extra: 1 },
      PREFERENCES_KEY,
    );
    expect(await preferences.load()).toEqual({ ...DEFAULT_PREFERENCES, avatar: "woman", robotVisible: false });
    // Saving over it writes a clean record.
    await preferences.save({ soundEnabled: true });
    expect(await getRaw(PREFERENCES_STORE, PREFERENCES_KEY)).toEqual({
      ...DEFAULT_PREFERENCES,
      avatar: "woman",
      robotVisible: false,
      soundEnabled: true,
    });
  });

  it("notifies subscribers after a save until they unsubscribe", async () => {
    const { preferences } = openStores();
    const seen: boolean[] = [];
    const unsubscribe = preferences.subscribe((value) => seen.push(value.robotVisible));
    await preferences.save({ robotVisible: false });
    await expectCode(preferences.save({ avatar: "x" as never }), "invalid_input");
    unsubscribe();
    await preferences.save({ robotVisible: true });
    expect(seen).toEqual([false]);
  });
});

describe("storage entry point without IndexedDB (server rendering)", () => {
  it("can be imported and called without throwing synchronously", async () => {
    expect(globalThis.indexedDB).toBeUndefined();
    const projects = getGuestProjectStore();
    const preferences = getPreferencesStore();
    expect(getGuestProjectStore()).toBe(projects);
    expect(getPreferencesStore()).toBe(preferences);
    await expectCode(projects.list(), "unavailable");
    expect(await preferences.load()).toEqual(DEFAULT_PREFERENCES);
  });
});
