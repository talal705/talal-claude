// Pure checkers: a completion condition plus evidence in, a rubric with outcomes out. Every
// verdict about a PC build or a network comes from that lab's engine. Nothing here reads the page.
import type { NetworkDevice, NetworkState } from "@ytl/contracts";
import { network, pc } from "@ytl/simulation";
import type { CheckLine, CheckResult, CheckSpec, DeviceSelector, LessonEvidence } from "./contract";

export function selectDevice(state: NetworkState, selector: DeviceSelector): NetworkDevice | undefined {
  if ("id" in selector) return state.devices.find((device) => device.id === selector.id);
  return state.devices.filter((device) => device.kind === selector.kind)[selector.index ?? 0];
}

const WRONG_LAB = "no evidence for this lab";

function leaf(spec: Exclude<CheckSpec, { type: "all" | "any" }>, evidence: LessonEvidence): CheckLine {
  const line = (passed: boolean, observed?: string): CheckLine => ({ label: spec.label, passed, ...(observed !== undefined ? { observed } : {}) });

  if (spec.type === "choice") {
    if (evidence.lab !== "choice") return line(false, WRONG_LAB);
    return line(evidence.optionId === spec.correctOptionId, evidence.optionId);
  }

  if (spec.type.startsWith("pc.")) {
    if (evidence.lab !== "pc") return line(false, WRONG_LAB);
    const { state, catalog } = evidence;
    const categoryOf = (catalogId: string) => catalog.entries.find((entry) => entry.id === catalogId)?.category;
    switch (spec.type) {
      case "pc.part_count": {
        const count = state.parts.filter((part) => categoryOf(part.catalogId) === spec.category && (!spec.mounted || part.attachments.some((a) => a.seating === "seated"))).length;
        return line(count >= (spec.min ?? 0) && count <= (spec.max ?? Number.POSITIVE_INFINITY), String(count));
      }
      case "pc.memory_slots": {
        const used = state.parts
          .filter((part) => categoryOf(part.catalogId) === "ram")
          .flatMap((part) => part.attachments.filter((a) => a.seating === "seated").map((a) => a.target.mountPointId))
          .sort();
        const wanted = [...spec.slots].sort();
        return line(used.length === wanted.length && wanted.every((slot, index) => used[index] === slot), used.join(", ") || "none");
      }
      case "pc.no_diagnostic": {
        const startup = pc.evaluateStartup(state, catalog);
        const found = [...pc.diagnoseBuild(state, catalog), ...startup.stages.flatMap((stage) => stage.diagnostics), ...startup.advisories].map((d) => d.code);
        const present = [...new Set(spec.codes.filter((code) => found.includes(code)))];
        return line(present.length === 0, present.join(", ") || "none");
      }
      case "pc.startup": {
        const startup = pc.evaluateStartup(state, catalog);
        const stage = spec.stagePassed ? startup.stages.find((s) => s.stage === spec.stagePassed)?.status === "passed" : true;
        const screen = spec.screen ? spec.screen.includes(startup.observable.screen) : true;
        const outcome = spec.outcome ? spec.outcome.includes(startup.outcome) : true;
        return line(state.power.pressed && stage && screen && outcome, `${startup.outcome}; screen ${startup.observable.screen}`);
      }
    }
  }

  if (spec.type.startsWith("net.")) {
    if (evidence.lab !== "network") return line(false, WRONG_LAB);
    const { state } = evidence;
    switch (spec.type) {
      case "net.device_count": {
        const count = state.devices.filter((device) => device.kind === spec.kind).length;
        return line(count >= spec.min, String(count));
      }
      case "net.link": {
        const a = selectDevice(state, spec.a);
        const b = selectDevice(state, spec.b);
        if (!a || !b) return line(false, "device missing");
        const roleOk = (device: NetworkDevice, portId: string | undefined, role: string | undefined) => !role || device.ports.find((port) => port.id === portId)?.role === role;
        const joined = network.resolveLinks(state).some((link) => {
          if (!link.up || !link.a || !link.b) return false;
          const ends = [link.a, link.b];
          const atA = ends.find((end) => end.deviceId === a.id);
          const atB = ends.find((end) => end.deviceId === b.id);
          return Boolean(atA && atB && roleOk(a, atA.portId, spec.a.portRole) && roleOk(b, atB.portId, spec.b.portRole));
        });
        return line(joined, joined ? "link up" : "no working link");
      }
      case "net.address": {
        const device = selectDevice(state, spec.device);
        if (!device) return line(false, "device missing");
        const resolved = network.resolveInterfaces(state).find((r) => r.deviceId === device.id && r.interface === spec.interface);
        const ok = Boolean(resolved?.address) && (!spec.source || resolved?.source === spec.source);
        return line(ok, resolved?.address ? `${resolved.address} (${resolved.source})` : "no address");
      }
      case "net.ping": {
        const from = selectDevice(state, spec.from);
        if (!from) return line(false, "device missing");
        const result = network.runConnectivity(state, { kind: "ping", fromDeviceId: from.id, to: spec.to });
        return line(result.succeeded === spec.succeeds, result.succeeded ? "reply received" : (result.diagnostics[0]?.code ?? "no reply"));
      }
      case "net.no_diagnostic": {
        const found = network.diagnoseNetwork(state);
        const present = spec.codes ? found.filter((d) => spec.codes!.includes(d.code)) : found.filter((d) => d.severity === "blocking");
        return line(present.length === 0, [...new Set(present.map((d) => d.code))].join(", ") || "none");
      }
    }
  }

  return line(false, "unknown condition");
}

/** Evaluates a condition. `all` needs every part, `any` at least one; the lines list every leaf either way. */
export function checkStep(spec: CheckSpec, evidence: LessonEvidence): CheckResult {
  if (spec.type === "all" || spec.type === "any") {
    const parts = spec.of.map((part) => checkStep(part, evidence));
    const passed = spec.type === "all" ? parts.every((part) => part.passed) : parts.some((part) => part.passed);
    return { passed, lines: parts.flatMap((part) => part.lines) };
  }
  const line = leaf(spec, evidence);
  return { passed: line.passed, lines: [line] };
}
