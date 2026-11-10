// Programming projects saved by the former Code Studio stay readable after its removal: listed,
// not reported as damaged, exported exactly as stored.
import { IDBFactory as FakeIDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { GuestDatabase, MIGRATIONS } from "@/lib/storage/guest-db";
import { createGuestProjectStore } from "@/lib/storage/guest-project-store";
import { ARCHIVE_EXPORT_FORMAT, exportArchived, isArchived } from "./archive";

/** The shape the old Code Studio saved (`CodeProjectData`, dataVersion 1). */
const legacyData = {
  track: "python",
  files: [{ id: "f1", name: "main.py", language: "python", content: 'print("Hello")\n', order: 0 }],
  openFileIds: ["f1"],
  activeFileId: "f1",
  stdin: "",
};

function store() {
  const factory = new FakeIDBFactory() as unknown as IDBFactory;
  return createGuestProjectStore(new GuestDatabase(() => factory, "ytl-archive-test", MIGRATIONS));
}

describe("archived programming projects", () => {
  it("are listed as projects, not as damaged records, and only code projects count as archived", async () => {
    const projects = store();
    const legacy = await projects.create({ lab: "code", mode: "free", title: "Hello", data: legacyData, dataVersion: 1 });
    const build = await projects.create({ lab: "pc", mode: "free", title: "Build", data: {}, dataVersion: 1 });
    const listed = await projects.list();
    expect(listed.corruptIds).toEqual([]);
    expect(listed.projects.map((p) => p.id).sort()).toEqual([legacy.id, build.id].sort());
    expect(listed.projects.filter(isArchived).map((p) => p.id)).toEqual([legacy.id]);
  });

  it("export the stored record and its snapshots unchanged", async () => {
    const projects = store();
    const legacy = await projects.create({ lab: "code", mode: "learn", title: "Hello", data: legacyData, dataVersion: 1 });
    const summary = await projects.createSnapshot(legacy.id, "before");
    const snapshot = await projects.getSnapshot(legacy.id, summary.id);
    const record = await projects.get(legacy.id);
    const exported = exportArchived(record, [snapshot], new Date("2026-10-27T10:00:00.000Z"));
    expect(exported).toMatchObject({ format: ARCHIVE_EXPORT_FORMAT, formatVersion: 1, exportedAt: "2026-10-27T10:00:00.000Z" });
    expect(exported.project).toEqual(record);
    expect(exported.project.data).toEqual(legacyData);
    expect(exported.snapshots).toEqual([snapshot]);
    // Exporting reads only: the project is still there, at the same revision.
    expect((await projects.get(legacy.id)).revision).toBe(record.revision);
  });
});
