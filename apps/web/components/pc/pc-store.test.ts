import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IDBFactory as FakeIDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import type { PCAction, PCProjectData, ProjectStore } from "@ytl/contracts";
import { pc } from "@ytl/simulation";
import { GuestDatabase } from "@/lib/storage/guest-db";
import { createGuestProjectStore } from "@/lib/storage/guest-project-store";
import { ARCHIVED_CATALOG_IDS, NOT_OFFERED_IDS, pcCatalog, pcPresets, pcStarterKits } from "./catalog";
import { PC_PROJECT_DATA_VERSION, archivedInBuild, buildRows, catalogDrift, parsePCProjectData, pickerEntries } from "./pc-model";
import { createPCStore, kitProjectData, newPCProjectData } from "./pc-store";
import { MAX_PC_IMPORT_CHARS, PC_EXPORT_FORMAT, exportBuild, importBuild } from "./pc-transfer";

let factory: IDBFactory;
let projects: ProjectStore;
let drafts: Map<string, string>;

function openStore() {
  projects = createGuestProjectStore(new GuestDatabase(() => factory, "ytl-pc-test"));
  return createPCStore({
    store: () => projects,
    catalog: pcCatalog,
    autosaveMs: 500,
    schedule: () => () => {},
    drafts: { read: (id) => drafts.get(id) ?? null, write: (id, text) => void drafts.set(id, text), remove: (id) => void drafts.delete(id) },
  });
}

async function openNewProject() {
  const store = openStore();
  const record = await projects.create({ lab: "pc", mode: "free", title: "My PC", data: newPCProjectData(pcCatalog, "with_rgb"), dataVersion: PC_PROJECT_DATA_VERSION });
  await store.getState().open(record.id);
  return { store, record, state: () => store.getState(), build: () => store.getState().history!.present };
}

const firstOf = (category: string) => pcCatalog.entries.find((entry) => entry.category === category)!;

/** Adds a part and returns its instance ID. */
function add(state: () => ReturnType<ReturnType<typeof openStore>["getState"]>, catalogId: string) {
  const result = state().act({ type: "add_part", catalogId });
  if (!result?.ok || !result.created?.instanceId) throw new Error(`add_part ${catalogId} was refused`);
  return result.created.instanceId;
}

beforeEach(() => {
  factory = new FakeIDBFactory();
  drafts = new Map();
});

describe("new PC project data", () => {
  it("logs the lighting choice so the log replays to the same state", () => {
    for (const preference of ["with_rgb", "without_rgb"] as const) {
      const data = newPCProjectData(pcCatalog, preference);
      expect(data.state.rgbPreference).toBe(preference);
      expect(data.state.parts).toEqual([]);
      const replayed = pc.replay(data.log, pcCatalog);
      expect(replayed.clean).toBe(true);
      expect(replayed.state).toEqual(data.state);
      expect(parsePCProjectData(JSON.parse(JSON.stringify(data)), pcCatalog)).not.toBeNull();
    }
  });
});

describe("parsePCProjectData", () => {
  it("rejects data that is not a PC build, or that names a part the catalog does not have", () => {
    const good = newPCProjectData(pcCatalog, "with_rgb");
    expect(parsePCProjectData(null, pcCatalog)).toBeNull();
    expect(parsePCProjectData({ track: "python", files: [] }, pcCatalog)).toBeNull();
    expect(parsePCProjectData({ ...good, log: "none" }, pcCatalog)).toBeNull();
    expect(parsePCProjectData({ ...good, state: { ...good.state, power: { wallConnected: true } } }, pcCatalog)).toBeNull();
    const ghost = { ...good, state: { ...good.state, parts: [{ instanceId: "cpu-1", catalogId: "no-such-part", attachments: [] }] } };
    expect(parsePCProjectData(ghost, pcCatalog)).toBeNull();
  });
});

describe("PC store", () => {
  it("opens a project with an empty build and nothing to undo", async () => {
    const { state, build } = await openNewProject();
    expect(state()).toMatchObject({ phase: "ready", saveState: "saved", canUndo: false, canRedo: false, refusal: null });
    expect(build().parts).toEqual([]);
    expect(state().assembly.phase).toBe("idle");
  });

  it("adds parts through the engine, marks the project changed, and saves the state with its log", async () => {
    const { store, record, state, build } = await openNewProject();
    const caseId = add(state, firstOf("case").id);
    expect(build().parts.map((part) => part.instanceId)).toEqual([caseId]);
    expect(state()).toMatchObject({ saveState: "dirty", canUndo: true });
    expect(await state().saveNow()).toBe(true);

    const stored = await projects.get<PCProjectData>(record.id);
    expect(stored.revision).toBe(2);
    expect(stored.data.state).toEqual(build());
    expect(stored.data.log.map((action) => action.type)).toEqual(["set_rgb_preference", "add_part"]);
    expect(pc.replay(stored.data.log, pcCatalog).state).toEqual(stored.data.state);

    // A reload starts a new undo history but keeps the whole log.
    const again = openStore();
    await again.getState().open(record.id);
    expect(again.getState().history!.present).toEqual(build());
    expect(again.getState().canUndo).toBe(false);
    add(() => again.getState(), firstOf("psu").id);
    expect(again.getState().data!.log.map((action) => action.type)).toEqual(["set_rgb_preference", "add_part", "add_part"]);
    expect(store.getState().data!.log).toHaveLength(2);
  });

  it("keeps a refusal with the engine's reason and changes nothing", async () => {
    const { state, build } = await openNewProject();
    const before = build();
    const result = state().act({ type: "remove_part", instanceId: "ram-99" });
    expect(result?.ok).toBe(false);
    expect(build()).toBe(before);
    expect(state().saveState).toBe("saved");
    expect(state().refusal?.diagnostic.message.en.length).toBeGreaterThan(0);
    expect(state().history!.events.at(-1)).toMatchObject({ accepted: false });
    add(state, firstOf("case").id);
    expect(state().refusal).toBeNull();
  });

  it("places a part through the selection machine: list, choose, result, focus back", async () => {
    const { state, build } = await openNewProject();
    add(state, firstOf("case").id);
    const board = pcCatalog.entries.find((entry) => {
      if (entry.category !== "motherboard") return false;
      const trial = pc.dispatch(pc.createHistory(build()), { type: "add_part", catalogId: entry.id }, pcCatalog);
      return trial.result.ok && pc.mountOptions(trial.history.present, pcCatalog, trial.result.created!.instanceId!).some((option) => option.ok);
    })!;
    const boardId = add(state, board.id);

    state().selectPart(boardId);
    const choosing = state().assembly;
    if (choosing.phase !== "choosing") throw new Error(`expected a destination list, got ${choosing.phase}`);
    expect(choosing.subject).toMatchObject({ kind: "part", instanceId: boardId });
    expect(choosing.candidates[choosing.activeIndex].ok).toBe(true);
    expect(choosing.announcement?.key).toBe("selected");
    expect(state().focus).toMatchObject({ to: "candidate", candidateId: choosing.candidates[choosing.activeIndex].id });

    state().send({ type: "choose" });
    expect(state().assembly).toMatchObject({ phase: "idle", announcement: { key: "placed" } });
    expect(state().focus).toMatchObject({ to: "subject", subject: { instanceId: boardId } });
    const mounted = build().parts.find((part) => part.instanceId === boardId)!;
    expect(mounted.attachments).toHaveLength(1);
    expect(mounted.attachments[0].seating).toBe("placed");

    const rows = buildRows(build(), pcCatalog);
    const boardRow = rows.parts.find((row) => row.part.instanceId === boardId)!;
    expect(boardRow.attachments[0].hostName).toBe(`${firstOf("case").brand} ${firstOf("case").model}`);
    expect(boardRow.canPlace).toBe(false);
    const caseRow = rows.parts[0];
    expect(caseRow.mountPoints.find((point) => point.occupant)?.occupant).toEqual({ instanceId: boardId, name: boardRow.name });

    state().send({ type: "undo" });
    expect(build().parts.find((part) => part.instanceId === boardId)!.attachments).toEqual([]);
    expect(state().assembly.announcement?.key).toBe("undone");
    expect(state()).toMatchObject({ canRedo: true });
    state().send({ type: "redo" });
    expect(build().parts.find((part) => part.instanceId === boardId)!.attachments).toHaveLength(1);
  });

  it("says so when there is nothing to undo, and cancelling a list moves nothing", async () => {
    const { state, build } = await openNewProject();
    state().send({ type: "undo" });
    expect(state().assembly.announcement?.key).toBe("nothingToUndo");
    add(state, firstOf("case").id);
    const ramId = add(state, firstOf("ram").id);
    const before = build();
    state().selectPart(ramId);
    // No motherboard yet: either nowhere to go, or a list with nothing available.
    if (state().assembly.phase === "choosing") state().send({ type: "cancel" });
    expect(state().assembly.phase).toBe("idle");
    expect(build()).toBe(before);
  });

  it("lists a cable's ends, loose until plugged, and offers destinations for an end", async () => {
    const { state, build } = await openNewProject();
    add(state, firstOf("case").id);
    const rows = buildRows(build(), pcCatalog);
    expect(rows.cables.length).toBeGreaterThan(0);
    const cable = rows.cables[0];
    expect(cable.ownerName).toBe(rows.parts[0].name);
    expect(cable.ends.every((end) => end.pluggedInto === null)).toBe(true);
    state().selectCableEnd(cable.cable.id, cable.ends[0].spec.id);
    const { assembly } = state();
    expect(["idle", "choosing"]).toContain(assembly.phase);
    expect(assembly.announcement?.key).toMatch(/^selected/);
  });
});

describe("a build saved before the case's fans became parts", () => {
  it("opens without the case's old fan leads, with everything else as it was", () => {
    const data = pc.toProjectData(pc.createHistory(pc.replay([{ type: "add_part", catalogId: "corsair-4000d-airflow-black" }, { type: "add_part", catalogId: "asus-tuf-gaming-z790-plus-wifi" }], pcCatalog).state));
    const old = JSON.parse(JSON.stringify(data)) as PCProjectData;
    // As stored on 2026-10-15: the case carried its fans' leads, one of them plugged into the board.
    old.state.cables.push({ id: "case-1.fan-1", catalogId: "corsair-4000d-airflow-black", cableSpecId: "fan-1", ownerInstanceId: "case-1", ends: { plug: { kind: "part", instanceId: "motherboard-2", portId: "cha-fan-1" } }, tidied: false });
    const parsed = parsePCProjectData(old, pcCatalog);
    expect(parsed).not.toBeNull();
    expect(parsed!.state.cables.some((cable) => cable.id === "case-1.fan-1")).toBe(false);
    expect(parsed!.state.parts.map((part) => part.catalogId)).toEqual(["corsair-4000d-airflow-black", "asus-tuf-gaming-z790-plus-wifi"]);
    // A cable of an unknown part is still unreadable.
    const broken = JSON.parse(JSON.stringify(old)) as PCProjectData;
    broken.state.cables.push({ id: "x.y", catalogId: "corsair-4000d-airflow-black", cableSpecId: "nope", ownerInstanceId: "case-99", ends: {}, tidied: false });
    expect(parsePCProjectData(broken, pcCatalog)).toBeNull();
  });
});

describe("a real export from before the case fans became parts (2026-10-10)", () => {
  const file = readFileSync(fileURLToPath(new URL("./fixtures/build-export-2026-10-10.json", import.meta.url)), "utf8");

  it("imports: the steps on the case's old fan leads are left out, every other step is replayed and accepted", () => {
    const imported = importBuild(file, pcCatalog);
    if (!imported.ok) throw new Error(`${imported.problem} ${imported.reason?.en ?? ""}`);
    const original = (JSON.parse(file) as { log: PCAction[] }).log;
    const dropped = original.filter((action) => "cableId" in action && /^case-1\.fan-[12]$/.test(action.cableId));
    expect(dropped.length).toBeGreaterThan(0);
    expect(imported.data.log).toHaveLength(original.length - dropped.length);
    expect(pc.replay(imported.data.log, pcCatalog).clean).toBe(true);
  });

  it("starts with all five stages passed up to its drive removal, and its stored form shows no catalog-drift notice", () => {
    const original = (JSON.parse(file) as { log: PCAction[] }).log;
    // The file ends with the drive taken out (that is how the browser check exported it): cut it there, as the reviewer did.
    const cut = original.slice(0, original.findIndex((action) => action.type === "remove_part"));
    const imported = importBuild(JSON.stringify({ ...JSON.parse(file), log: cut.filter((a) => a.type !== "power_off") }), pcCatalog);
    if (!imported.ok) throw new Error(imported.problem);
    const state = imported.data.state.power.pressed ? imported.data.state : pc.replay([...imported.data.log, { type: "press_power" }], pcCatalog).state;
    expect(pc.evaluateStartup(state, pcCatalog).stages.map((stage) => stage.status)).toEqual(["passed", "passed", "passed", "passed", "passed"]);
    // The whole file: the drive it removed is reported where it should be, and nothing about the old leads.
    const whole = importBuild(file, pcCatalog);
    if (!whole.ok) throw new Error(whole.problem);
    const end = pc.evaluateStartup(pc.replay([...whole.data.log, { type: "press_power" }], pcCatalog).state, pcCatalog);
    expect(end.stages.flatMap((stage) => stage.diagnostics.map((d) => d.code))).toEqual(["storage_missing"]);
    // As the old version stored it: the original log under an older catalog version. No drift notice.
    expect(catalogDrift({ state: { ...whole.data.state, catalogVersion: "2026.10.10-1" }, log: original }, pcCatalog)).toBeNull();
  });
});

describe("pickerEntries", () => {
  it("filters a category by lighting hardware", () => {
    const all = pickerEntries(pcCatalog, "ram", "all");
    const lit = pickerEntries(pcCatalog, "ram", "with");
    const plain = pickerEntries(pcCatalog, "ram", "without");
    expect(all.length).toBeGreaterThan(0);
    expect(lit.length + plain.length).toBe(all.length);
    expect(lit.every((entry) => entry.rgb !== null)).toBe(true);
    expect(plain.every((entry) => entry.rgb === null)).toBe(true);
    expect(all.every((entry) => entry.category === "ram")).toBe(true);
  });

  it("never lists an archived entry, and offers two options in every category", () => {
    for (const category of pc.PC_PART_CATEGORIES) {
      const offered = pickerEntries(pcCatalog, category, "all", NOT_OFFERED_IDS);
      expect(offered.map((e) => e.id), category).toHaveLength(2);
      expect(offered.some((e) => ARCHIVED_CATALOG_IDS.has(e.id)), category).toBe(false);
    }
    expect(pickerEntries(pcCatalog, "monitor", "all", NOT_OFFERED_IDS)).toEqual([]);
    // The fans fitted in the cases are never offered on their own.
    expect(pickerEntries(pcCatalog, "fan", "all", NOT_OFFERED_IDS).map((e) => e.id)).toEqual(["arctic-p12-pwm-pst", "arctic-p12-pwm-pst-argb"]);
  });
});

describe("a saved build with parts that are no longer offered", () => {
  // As the old Intel ready build was saved before 2026-10-27: Core i9 and an HDMI cable to a monitor.
  const legacy: PCAction[] = [
    { type: "add_part", catalogId: "corsair-4000d-airflow-black" },
    { type: "add_part", catalogId: "asus-tuf-gaming-z790-plus-wifi" },
    { type: "add_part", catalogId: "intel-core-i9-14900k" },
    { type: "add_part", catalogId: "generic-monitor" },
    { type: "add_cable", catalogId: "generic-hdmi-cable" },
  ];

  it("still replays on the current catalog and names each archived part once", () => {
    const replayed = pc.replay(legacy, pcCatalog);
    expect(replayed.clean).toBe(true);
    expect(archivedInBuild(replayed.state, pcCatalog, ARCHIVED_CATALOG_IDS).map((e) => e.id)).toEqual(["intel-core-i9-14900k", "generic-monitor", "generic-hdmi-cable"]);
    expect(archivedInBuild(pc.replay(pcPresets[0]!.actions, pcCatalog).state, pcCatalog, ARCHIVED_CATALOG_IDS)).toEqual([]);
  });

  it("opens from storage with its parts unchanged", async () => {
    const store = openStore();
    const state = pc.replay(legacy, pcCatalog).state;
    const record = await projects.create({ lab: "pc", mode: "free", title: "Old build", data: { state: { ...state, catalogVersion: "2026.10.15-1" }, log: legacy }, dataVersion: PC_PROJECT_DATA_VERSION });
    await store.getState().open(record.id);
    expect(store.getState().phase).toBe("ready");
    expect(store.getState().history!.present.parts.map((p) => p.catalogId)).toEqual(state.parts.map((p) => p.catalogId));
    expect(catalogDrift(store.getState().data!, pcCatalog)).toBeNull();
  });
});

describe("rows of a complete build", () => {
  it("lists every part and cable of a preset, with plugged ends named in words", () => {
    const preset = pcPresets[0];
    const replayed = pc.replay(preset.actions, pcCatalog);
    expect(replayed.clean).toBe(true);
    const rows = buildRows(replayed.state, pcCatalog);
    expect(rows.parts).toHaveLength(replayed.state.parts.length);
    expect(rows.cables).toHaveLength(replayed.state.cables.length);

    const installed = rows.parts.filter((row) => row.attachments.length > 0);
    expect(installed.length).toBeGreaterThan(3);
    for (const row of installed) {
      for (const item of row.attachments) {
        expect(item.hostName.length).toBeGreaterThan(0);
        expect(item.mountLabel.en.length).toBeGreaterThan(0);
        expect(item.attachment.fastenersSecured).toBeLessThanOrEqual(item.fastenersTotal);
      }
    }
    // Each plugged port and the cable end in it describe the same connection from both sides.
    const pluggedPorts = rows.parts.flatMap((row) => row.ports.filter((port) => port.plugged).map((port) => ({ row, port })));
    expect(pluggedPorts.length).toBeGreaterThan(0);
    for (const { row, port } of pluggedPorts) {
      const cable = rows.cables.find((item) => item.cable.id === port.plugged!.cableId)!;
      const end = cable.ends.find((item) => item.spec.id === port.plugged!.endId)!;
      expect(end.pluggedInto).toEqual({ owner: row.name, label: port.spec.label });
    }
  });
});

describe("catalogDrift", () => {
  it("is null for a build saved under this catalog, and names the refused step when the rules changed", () => {
    const data = newPCProjectData(pcCatalog, "with_rgb");
    expect(catalogDrift(data, pcCatalog)).toBeNull();
    const older = { state: { ...data.state, catalogVersion: "older" }, log: data.log };
    expect(catalogDrift(older, pcCatalog)).toBeNull();
    const broken = { state: older.state, log: [...data.log, { type: "add_part" as const, catalogId: "part-that-was-withdrawn" }] };
    expect(catalogDrift(broken, pcCatalog)?.message.en.length).toBeGreaterThan(0);
  });
});

describe("starter kits", () => {
  it("arrive as parts on the bench, nothing installed or connected, and are built step by step to Working", async () => {
    expect(pcStarterKits.map((kit) => kit.id)).toEqual(["i5-ddr4-air", "i7-ddr5-rgb-aio"]);
    for (const kit of pcStarterKits) {
      const data = kitProjectData(kit, pcCatalog);
      if (!data) throw new Error(`kit ${kit.id} is refused by the current rules`);
      expect(data.state.rgbPreference).toBe(kit.rgb);
      // Disassembled: no part sits anywhere except the case's factory-fitted fans, and no cable end is plugged in.
      const fitted = data.state.parts.filter((part) => part.attachments.length > 0);
      expect(fitted.map((part) => [part.catalogId, part.attachments[0]!.target.hostInstanceId, part.attachments[0]!.target.mountPointId])).toEqual([
        [fitted[0]!.catalogId, "case-1", "fan-front-1"],
        [fitted[0]!.catalogId, "case-1", "fan-front-2"],
      ]);
      expect(data.state.parts.length).toBeGreaterThanOrEqual(11);
      expect(data.log.filter((a) => a.type === "add_part").length).toBe(data.state.parts.length);
      expect(data.state.cables.every((cable) => Object.values(cable.ends).every((to) => to === null))).toBe(true);

      // The same steps a learner takes, through the store.
      const store = openStore();
      const record = await projects.create({ lab: "pc", mode: "free", title: kit.id, data, dataVersion: PC_PROJECT_DATA_VERSION });
      await store.getState().open(record.id);
      const state = () => store.getState();
      const build = () => state().history!.present;
      const outcome = () => pc.evaluateStartup(build(), pcCatalog).outcome;

      expect(state().act({ type: "press_power" })?.ok).toBe(true);
      expect(outcome()).toBe("no_power");
      expect(state().act({ type: "power_off" })?.ok).toBe(true);
      for (const action of kit.solution) expect(state().act(action)?.ok, `${kit.id}: ${action.type}`).toBe(true);
      expect(state().act({ type: "press_power" })?.ok).toBe(true);
      expect(outcome()).toBe("operational");

      const drive = build().parts.find((part) => part.bootable !== undefined)!;
      // Hardware cannot change while the computer is on; the engine says so and nothing moves.
      const whileOn = state().act({ type: "remove_part", instanceId: drive.instanceId });
      expect(whileOn?.ok === false && whileOn.rejection.code).toBe("power_is_on");
      expect(state().act({ type: "power_off" })?.ok).toBe(true);
      expect(state().act({ type: "set_side_panel", open: true })?.ok).toBe(true);
      expect(state().act({ type: "remove_part", instanceId: drive.instanceId })?.ok).toBe(true);
      expect(state().act({ type: "press_power" })?.ok).toBe(true);
      expect(outcome()).toBe("no_boot_device");
    }
  });
});

describe("PC export and import", () => {
  const now = new Date("2026-10-11T09:00:00.000Z");

  it("round-trips a build through its log", () => {
    const data = { state: pc.replay(pcPresets[0]!.actions, pcCatalog).state, log: [...pcPresets[0]!.actions] };
    const exported = exportBuild("تجميعتي", "learn", data, now);
    expect(exported).toMatchObject({ format: PC_EXPORT_FORMAT, formatVersion: 1, catalogVersion: pcCatalog.version });
    expect("state" in exported).toBe(false);
    const imported = importBuild(JSON.stringify(exported), pcCatalog);
    if (!imported.ok) throw new Error(imported.problem);
    expect(imported.title).toBe("تجميعتي");
    expect(imported.mode).toBe("learn");
    expect(imported.data.state).toEqual(data.state);
    expect(parsePCProjectData(JSON.parse(JSON.stringify(imported.data)), pcCatalog)).not.toBeNull();
  });

  it("refuses files that are not a build export, and builds the current rules do not allow", () => {
    const good = exportBuild("T", "free", newPCProjectData(pcCatalog, "with_rgb"), now);
    const problem = (value: unknown) => {
      const result = importBuild(typeof value === "string" ? value : JSON.stringify(value), pcCatalog);
      return result.ok ? null : result.problem;
    };
    expect(problem("{")).toBe("not_json");
    expect(problem([])).toBe("wrong_format");
    expect(problem({ ...good, format: "ytl-code-project" })).toBe("wrong_format");
    expect(problem({ ...good, formatVersion: 9 })).toBe("unsupported_version");
    expect(problem({ ...good, title: "" })).toBe("invalid_title");
    expect(problem({ ...good, log: "x" })).toBe("invalid_log");
    expect(problem({ ...good, log: [null] })).toBe("invalid_log");
    expect(problem(" ".repeat(MAX_PC_IMPORT_CHARS + 1))).toBe("file_too_large");

    const refused = importBuild(JSON.stringify({ ...good, log: [...good.log, { type: "add_part", catalogId: "not-in-the-catalog" }] }), pcCatalog);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.problem).toBe("step_refused");
    expect(!refused.ok && refused.reason?.en.length).toBeGreaterThan(0);
  });

  it("ignores a state smuggled into the file: only the log is replayed", () => {
    const good = exportBuild("T", "free", newPCProjectData(pcCatalog, "with_rgb"), now);
    const imported = importBuild(JSON.stringify({ ...good, state: { parts: [{ instanceId: "cpu-1", catalogId: "x", attachments: [] }] } }), pcCatalog);
    expect(imported.ok && imported.data.state.parts).toEqual([]);
  });
});

describe("a refused place, then another part", () => {
  it("cancel after a refusal, pick another module, and an accepting slot places it", async () => {
    const { state, build } = await openNewProject();
    const board = add(state, "asus-tuf-gaming-z790-plus-wifi");
    const ddr4 = add(state, "corsair-vengeance-lpx-ddr4-3600-16gb-kit");
    const ddr5 = add(state, "corsair-vengeance-rgb-ddr5-6000-32gb-kit");
    const slot = (id: string) => {
      const assembly = state().assembly;
      if (assembly.phase === "idle") throw new Error("no list open");
      return assembly.candidates.find((candidate) => candidate.action.type === "mount_part" && candidate.action.target.hostInstanceId === board && candidate.action.target.mountPointId === id)!;
    };

    state().selectPart(ddr4);
    const refused = slot("dimm-a2");
    expect(refused.ok).toBe(false);
    state().send({ type: "pick", candidateId: refused.id });
    expect(state().assembly.announcement?.key).toBe("notAvailable");
    expect(build().parts.find((part) => part.instanceId === ddr4)!.attachments).toEqual([]);
    state().send({ type: "cancel" });
    expect(state().assembly.phase).toBe("idle");

    state().selectPart(ddr5);
    const accepted = slot("dimm-a2");
    expect(accepted.ok).toBe(true);
    state().send({ type: "pick", candidateId: accepted.id });
    expect(state().assembly).toMatchObject({ phase: "idle", announcement: { key: "placed" } });
    expect(build().parts.find((part) => part.instanceId === ddr5)!.attachments[0].target.mountPointId).toBe("dimm-a2");
  });
});

describe("an archived programming project opened in the PC lab", () => {
  it("is reported as archived, not as damaged, and is left unchanged", async () => {
    const store = openStore();
    const legacy = await projects.create({ lab: "code", mode: "free", title: "Hello", data: { track: "python", files: [], stdin: "" }, dataVersion: 1 });
    await store.getState().open(legacy.id);
    expect(store.getState().phase).toBe("archived");
    expect(await projects.get(legacy.id)).toEqual(legacy);
  });
});

describe("names that tell look-alike cables and ends apart", () => {
  it("numbers a part's identical cables and a cable's same-named ends, in both languages, so every end has a unique name", () => {
    for (const preset of pcPresets) {
      const rows = buildRows(pc.replay(preset.actions, pcCatalog).state, pcCatalog);
      const names = rows.cables.flatMap((row) => row.ends.map((end) => `${end.label.en} | ${row.label.en}`));
      expect(new Set(names).size, preset.id).toBe(names.length);
      const arabic = rows.cables.flatMap((row) => row.ends.map((end) => `${end.label.ar} | ${row.label.ar}`));
      expect(new Set(arabic).size, preset.id).toBe(arabic.length);
    }
    const b = buildRows(pc.replay(pcPresets.find((p) => p.id === "i7-ddr5-rgb-aio")!.actions, pcCatalog).state, pcCatalog);
    expect(b.cables.filter((row) => row.spec.id === "eps").map((row) => row.label.en)).toEqual([
      "EPS / ATX 12V 8-pin (4+4) cable, Type 4 (cable 1)",
      "EPS / ATX 12V 8-pin (4+4) cable, Type 4 (cable 2)",
    ]);
    expect(b.cables.find((row) => row.spec.id === "eps")!.label.ar).toMatch(/\(الكيبل 1\)$/);
    const a = buildRows(pc.replay(pcPresets.find((p) => p.id === "i5-ddr4-air")!.actions, pcCatalog).state, pcCatalog);
    const pcie = a.cables.find((row) => row.spec.id === "pcie")!;
    expect(pcie.ends.map((end) => end.label.en)).toEqual(["PCIe 6+2-pin plug (end 1)", "PCIe 6+2-pin plug (end 2)"]);
    // A cable supplied once keeps its plain name.
    expect(a.cables.find((row) => row.spec.id === "atx24")!.label).toEqual(a.cables.find((row) => row.spec.id === "atx24")!.spec.label);
  });
});
