import { IDBFactory as FakeIDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import type { NetworkProjectData, ProjectStore } from "@ytl/contracts";
import { network } from "@ytl/simulation";
import { GuestDatabase } from "@/lib/storage/guest-db";
import { createGuestProjectStore } from "@/lib/storage/guest-project-store";
import { createPlugState } from "@/lib/interaction/network-cabling";
import { NETWORK_PRESETS, looseWireOrder, NETWORK_PROJECT_DATA_VERSION, networkRows, newNetworkProjectData, parseNetworkProjectData, splitAddresses } from "./network-model";
import { createNetworkStore } from "./network-store";

let factory: IDBFactory;
let projects: ProjectStore;

function openStore() {
  projects = createGuestProjectStore(new GuestDatabase(() => factory, "ytl-network-test"));
  const drafts = new Map<string, string>();
  return createNetworkStore({
    store: () => projects,
    autosaveMs: 500,
    schedule: () => () => {},
    drafts: { read: (id) => drafts.get(id) ?? null, write: (id, text) => void drafts.set(id, text), remove: (id) => void drafts.delete(id) },
  });
}

async function openProject(data: NetworkProjectData) {
  const store = openStore();
  const record = await projects.create({ lab: "network", mode: "free", title: "Home", data, dataVersion: NETWORK_PROJECT_DATA_VERSION });
  await store.getState().open(record.id);
  return { store, record, state: () => store.getState(), net: () => store.getState().history!.present };
}

beforeEach(() => {
  factory = new FakeIDBFactory();
});

describe("ready home networks", () => {
  it("replay without a refusal, and a ping and a name lookup from the computer succeed inside the simulator", () => {
    for (const preset of NETWORK_PRESETS) {
      const data = newNetworkProjectData(preset);
      if (!data) throw new Error(`${preset.id} is refused by the engine`);
      expect(network.replay(data.log).state).toEqual(data.state);
      expect(parseNetworkProjectData(JSON.parse(JSON.stringify(data)))).not.toBeNull();
      expect(network.diagnoseNetwork(data.state).filter((item) => item.severity === "blocking")).toEqual([]);

      const ping = network.runConnectivity(data.state, { kind: "ping", fromDeviceId: "pc-1", to: "school.test" });
      expect(ping.succeeded, preset.id).toBe(true);
      expect(ping.journey.outcome).toBe("delivered");
      expect(ping.journey.events.length).toBeGreaterThan(2);
      const lookup = network.runConnectivity(data.state, { kind: "lookup", fromDeviceId: "phone-1", name: "library.test" });
      expect(lookup.succeeded, preset.id).toBe(true);
      expect(lookup.resolvedAddress).toBe("203.0.113.20");
    }
  });

  it("an empty bench has no devices and no log", () => {
    expect(newNetworkProjectData()).toEqual({ state: { devices: [], cables: [] }, log: [] });
  });
});

describe("parseNetworkProjectData", () => {
  it("rejects data that is not a network", () => {
    expect(parseNetworkProjectData(null)).toBeNull();
    expect(parseNetworkProjectData({ state: { parts: [] }, log: [] })).toBeNull();
    expect(parseNetworkProjectData({ state: { devices: [{ id: "x" }], cables: [] }, log: [] })).toBeNull();
    expect(parseNetworkProjectData({ state: { devices: [], cables: [{ id: "c", medium: "coax", ends: {} }] }, log: [] })).toBeNull();
    expect(parseNetworkProjectData({ state: { devices: [], cables: [] }, log: "none" })).toBeNull();
  });
});

describe("network store", () => {
  it("adds devices and a cable, plugs an end through the cabling machine, and saves the state with its log", async () => {
    const { record, state, net } = await openProject(newNetworkProjectData()!);
    expect(state().act({ type: "add_device", kind: "router" })?.ok).toBe(true);
    expect(state().act({ type: "add_device", kind: "wired_client" })?.ok).toBe(true);
    const added = state().act({ type: "add_cable", medium: "rj45" });
    const cableId = added?.ok ? added.created!.cableId! : "";
    expect(state()).toMatchObject({ saveState: "dirty", canUndo: true });

    state().selectCableEnd(cableId, "a", { en: "Cable 1, end A", ar: "الكيبل 1، الطرف A" });
    const choosing = state().cabling;
    if (choosing.phase !== "choosing") throw new Error(`expected a port list, got ${choosing.phase}`);
    expect(choosing.candidates.length).toBe(net().devices.reduce((count, device) => count + device.ports.length, 0));
    expect(choosing.candidates[choosing.activeIndex].ok).toBe(true);
    expect(state().focus).toMatchObject({ to: "candidate" });
    state().send({ type: "choose" });
    expect(state().cabling).toMatchObject({ phase: "idle", announcement: { key: "placed" } });
    expect(net().cables[0].ends.a).not.toBeNull();
    expect(state().focus).toMatchObject({ to: "subject", subject: { cableId, endId: "a" } });

    const rows = networkRows(net());
    expect(rows.cables[0].ends[0].pluggedInto?.portLabel.length).toBeGreaterThan(0);
    expect(rows.cables[0].ends[1].pluggedInto).toBeNull();
    const plugged = rows.devices.flatMap((row) => row.ports).filter((port) => port.plugged);
    expect(plugged).toHaveLength(1);
    expect(plugged[0].plugged).toEqual({ cableId, endId: "a", cableNumber: 1 });

    expect(await state().saveNow()).toBe(true);
    const stored = await projects.get<NetworkProjectData>(record.id);
    expect(stored.data.state).toEqual(net());
    expect(stored.data.log.map((action) => action.type)).toEqual(["add_device", "add_device", "add_cable", "connect_cable_end"]);
    expect(network.replay(stored.data.log).state).toEqual(stored.data.state);
  });

  it("keeps the whole log across a reload and across undo", async () => {
    const preset = newNetworkProjectData(NETWORK_PRESETS[0])!;
    const { store, record, state, net } = await openProject(preset);
    state().act({ type: "set_power", deviceId: "router-1", powered: false });
    state().act({ type: "add_device", kind: "switch" });
    state().send({ type: "undo" });
    expect(state().cabling.announcement?.key).toBe("undone");
    expect(net().devices.some((device) => device.kind === "switch")).toBe(false);
    await state().saveNow();
    const stored = await projects.get<NetworkProjectData>(record.id);
    expect(stored.data.log).toHaveLength(preset.log.length + 1);
    expect(network.replay(stored.data.log).state).toEqual(net());

    const again = openStore();
    await again.getState().open(record.id);
    again.getState().act({ type: "set_power", deviceId: "router-1", powered: true });
    expect(again.getState().data!.log).toHaveLength(preset.log.length + 2);
    expect(store.getState().data!.log).toHaveLength(preset.log.length + 1);
  });

  it("keeps a refusal with the engine's reason and changes nothing", async () => {
    const { state, net } = await openProject(newNetworkProjectData(NETWORK_PRESETS[0])!);
    const before = net();
    const result = state().act({ type: "set_interface", deviceId: "pc-1", interface: "nic", config: { mode: "static", address: "999.1.1.1", mask: "255.255.255.0" } });
    expect(result?.ok).toBe(false);
    expect(net()).toBe(before);
    expect(state().saveState).toBe("saved");
    expect(state().refusal?.diagnostic.code).toBe("invalid_address");
    state().act({ type: "set_power", deviceId: "pc-1", powered: false });
    expect(state().refusal).toBeNull();
  });

  it("a port list shows rejected ports with the engine's reason", async () => {
    const { state } = await openProject(newNetworkProjectData(NETWORK_PRESETS[0])!);
    const added = state().act({ type: "add_cable", medium: "rj45" });
    state().selectCableEnd(added?.ok ? added.created!.cableId! : "", "a", { en: "x", ar: "x" });
    const { cabling } = state();
    if (cabling.phase !== "choosing") throw new Error("expected a port list");
    const rejected = cabling.candidates.filter((candidate) => !candidate.ok);
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.every((candidate) => (candidate.reason?.en.length ?? 0) > 0)).toBe(true);
    state().send({ type: "cancel" });
    expect(state().cabling.phase).toBe("idle");
  });
});

describe("plug exercise helpers", () => {
  it("the loose wire order is a valid starting arrangement, stable per plug, that matches neither standard", () => {
    const order = looseWireOrder("cable-4/a");
    expect(() => createPlugState(order)).not.toThrow();
    expect(looseWireOrder("cable-4/a")).toEqual(order);
    expect(network.matchStandard(order)).toBeNull();
    expect(network.matchStandard(looseWireOrder())).toBeNull();
    expect(network.checkPlug({ standard: "T568B", order }).passed).toBe(false);
    expect(network.checkPlug({ standard: "T568B", order: network.STANDARD_ORDER.T568B }).passed).toBe(true);
  });

  it("splits addresses typed with commas or spaces", () => {
    expect(splitAddresses(" 203.0.113.53, 192.168.1.1  10.0.0.1 ")).toEqual(["203.0.113.53", "192.168.1.1", "10.0.0.1"]);
    expect(splitAddresses("")).toEqual([]);
  });
});
