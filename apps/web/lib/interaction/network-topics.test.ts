import { describe, expect, it } from "vitest";
import type { Journey, NetworkAction } from "@ytl/contracts";
import { network } from "@ytl/simulation";
import { createTutorService } from "./advisor";
import { topicFromJourney, topicFromNetworkDiagnostic, topicsFromConnectivity, topicsFromNetworkDiagnostics } from "./diagnostic-topics";
import { activeTopic, createHintLadderStore, isTopicStale } from "./hint-ladder";

// A real topology from the engine: provider, ONT, router, one computer; then one fault.
const plug = (cableId: string, a: [string, string], b: [string, string]): NetworkAction[] => [
  { type: "connect_cable_end", cableId, endId: "a", to: { deviceId: a[0], portId: a[1] } },
  { type: "connect_cable_end", cableId, endId: "b", to: { deviceId: b[0], portId: b[1] } },
];
const HOME: NetworkAction[] = [
  { type: "add_device", kind: "isp" },
  { type: "add_device", kind: "ont" },
  { type: "add_device", kind: "router" },
  { type: "add_device", kind: "wired_client" },
  { type: "add_cable", medium: "fiber" },
  { type: "add_cable", medium: "rj45" },
  { type: "add_cable", medium: "rj45" },
  ...plug("cable-1", ["isp-1", "drop-1"], ["ont-1", "pon"]),
  ...plug("cable-2", ["ont-1", "eth"], ["router-1", "wan"]),
  ...plug("cable-3", ["router-1", "lan-1"], ["pc-1", "eth0"]),
];
const home = network.replay(HOME).state;
const wrongGateway = network.replay([{ type: "set_interface", deviceId: "pc-1", interface: "nic", config: { mode: "static", address: "192.168.1.50", mask: "255.255.255.0", gateway: "192.168.1.254", dns: ["203.0.113.53"] } }], home).state;
const context = { projectRevision: 5, executionId: "ping-9" };
const failed = network.runConnectivity(wrongGateway, { kind: "ping", fromDeviceId: "pc-1", to: "203.0.113.10" }, context);

describe("topic from a NetworkDiagnostic", () => {
  it("maps the engine's symptom, message and rule to levels 1, 2 and 3 and points at the setting from level 2", () => {
    const diagnostic = failed.diagnostics[0];
    expect(diagnostic.code).toBe("gateway_wrong");
    const topic = topicFromNetworkDiagnostic(diagnostic);
    expect(topic.id).toBe("network:gateway_wrong:pc-1");
    expect(topic.levels[0]).toEqual({ text: diagnostic.observation });
    expect(topic.levels[0].target).toBeUndefined();
    expect(topic.levels[1]).toEqual({ text: diagnostic.message, target: diagnostic.target });
    expect(topic.levels[2]).toEqual({ text: diagnostic.explanation, target: diagnostic.target });
    expect(topic.levels[1].target?.id).toBe("network:setting:pc-1/nic.gateway");
    expect(topic.title).toEqual({ key: "hints.network.title.blocking" });
  });

  it("level 1 does not give the cause away", () => {
    const topic = topicFromNetworkDiagnostic(failed.diagnostics[0]);
    const first = topic.levels[0].text;
    expect("en" in first && first.en).not.toMatch(/gateway/i);
  });

  it("is tied to the revision and the test run stamped by the engine, and goes stale with either", () => {
    const topic = topicFromNetworkDiagnostic(failed.diagnostics[0]);
    expect(topic.madeFor).toEqual(context);
    expect(isTopicStale(topic, context)).toBe(false);
    expect(isTopicStale(topic, { projectRevision: 6, executionId: "ping-9" })).toBe(true);
    expect(isTopicStale(topic, { projectRevision: 5, executionId: "ping-10" })).toBe(true);
  });

  it("the standing check gives topics that survive a new test run of the same revision", () => {
    const standing = network.diagnoseNetwork(wrongGateway, { projectRevision: 5 });
    const topics = topicsFromNetworkDiagnostics(standing);
    expect(topics.map((t) => t.id)).toEqual(["network:gateway_wrong:pc-1"]);
    expect(isTopicStale(topics[0], { projectRevision: 5, executionId: "ping-10" })).toBe(false);
    expect(isTopicStale(topics[0], { projectRevision: 6 })).toBe(true);
  });

  it("orders blocking findings before warnings and falls back to a general question without a symptom", () => {
    const noDns = network.replay([{ type: "set_interface", deviceId: "pc-1", interface: "nic", config: { mode: "static", address: "192.168.1.50", mask: "255.255.255.0", gateway: "192.168.1.254" } }], home).state;
    const topics = topicsFromNetworkDiagnostics([...network.diagnoseNetwork(noDns)].reverse());
    expect(topics.map((t) => t.title)).toEqual([{ key: "hints.network.title.blocking" }, { key: "hints.network.title.warning" }]);
    const bare = topicFromNetworkDiagnostic({ ...failed.diagnostics[0], observation: undefined });
    expect(bare.levels[0]).toEqual({ text: { key: "hints.generic.symptom" } });
  });
});

describe("topics from a connectivity test", () => {
  it("a delivered test gives no topics", () => {
    const ok = network.runConnectivity(home, { kind: "ping", fromDeviceId: "pc-1", to: "203.0.113.10" });
    expect(ok.succeeded).toBe(true);
    expect(topicsFromConnectivity(ok)).toEqual([]);
    expect(topicFromJourney(ok.journey)).toBeNull();
  });

  it("a failed test gives one topic per diagnostic, the cause first", () => {
    const broken = network.replay([{ type: "set_interface", deviceId: "pc-1", interface: "nic", config: { mode: "static", address: "192.168.1.50", mask: "255.255.255.0", gateway: "192.168.1.1", dns: ["192.168.1.53"] } }], home).state;
    const byName = network.runConnectivity(broken, { kind: "ping", fromDeviceId: "pc-1", to: "school.test" }, context);
    expect(topicsFromConnectivity(byName).map((t) => t.id)).toEqual(["network:dns_unreachable:pc-1", "network:host_unreachable:192.168.1.53"]);
  });

  it("a failed journey without diagnostics is explained from the event where the packet stopped", () => {
    const topic = topicFromJourney(failed.journey)!;
    const stopped = failed.journey.events.at(-1)!;
    expect(topic.id).toBe("network:journey:ping-9");
    expect(topic.levels[0]).toEqual({ text: { key: "hints.network.journey.symptom" } });
    expect(topic.levels[1]).toEqual({ text: stopped.message, target: stopped.target });
    expect(topic.levels[2]).toEqual({ text: stopped.reason, target: stopped.target });
    expect(topic.levels[1].target?.id).toBe("network:component:pc-1");
    expect(topic.madeFor).toEqual(context);
    expect(topicsFromConnectivity({ succeeded: false, diagnostics: [], journey: failed.journey })).toEqual([topic]);
  });

  it("a journey that ended without a failed event falls back to the engine's summary and points at nothing", () => {
    const odd: Journey = { id: "j", outcome: "incomplete", events: [], summary: { en: "Nothing was sent.", ar: "ما انرسل شي." } };
    const topic = topicFromJourney(odd)!;
    expect(topic.levels[1]).toEqual({ text: odd.summary });
    expect(topic.levels.every((level) => level.target === undefined)).toBe(true);
  });
});

describe("through the tutor service", () => {
  it("a failed ping reaches the ladder as hints, and a change to the topology removes them", async () => {
    const ladder = createHintLadderStore();
    const service = createTutorService(ladder);
    const shown = await service.presentGuidance({ lab: "network", context, evidence: [{ kind: "network-connectivity", result: failed }] });
    expect(shown?.map((t) => t.id)).toEqual(["network:gateway_wrong:pc-1"]);
    expect(activeTopic(ladder.getState())?.levels[1].target?.id).toBe("network:setting:pc-1/nic.gateway");
    ladder.getState().setContext({ projectRevision: 6 });
    expect(ladder.getState()).toMatchObject({ pageTopics: [], notice: "stale" });
  });

  it("the standing check and a test result can be given together without duplicating a fault", async () => {
    const ladder = createHintLadderStore();
    const service = createTutorService(ladder);
    const standing = network.diagnoseNetwork(wrongGateway, context);
    const shown = await service.presentGuidance({ lab: "network", context, evidence: [{ kind: "network-connectivity", result: failed }, { kind: "network-diagnostics", diagnostics: standing }] });
    expect(shown?.map((t) => t.id)).toEqual(["network:gateway_wrong:pc-1"]);
  });
});
