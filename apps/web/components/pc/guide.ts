// Where the guide robot points in the 3D view, decided only from the build and the simulation's own
// rules — never from a language model. The 3D view turns a `GuideTarget` into a scene position with
// the same mount and port frames it uses to draw parts and glowing places (see docs/PC_GUIDE.md).
//
//   selection (part)  → its place, or (when blocked) the earlier part or place it waits for
//   selection (lead)  → its port, or the part it waits for
//   nothing in hand   → the next step: the part to pick up, the port of the next lead, the power button
//   running, complete → celebrate beside the case
import type { PCBuildState } from "@ytl/contracts";
import { nextHandStep } from "./click-assembly";
import { nextAction, type Selection } from "./companion";
import {
  ALL_SIMPLE_CABLES, isPositionKey, isRamKey, partSpec, simpleAssemblyComplete, simpleBlock, simpleCableBlock, simpleCableConnected, simpleActiveEnd, simpleCableEnds, simpleCableMissingParts, simpleEndSocket, simplePortChoices,
  roleOf, simplePartInstalled, simplePrerequisites, simpleRetention, slotCovers, simpleRadiatorTarget, simpleSlotFilled, simpleSlotPart, simpleSwapBlock, simpleTarget, slotOf,
  type SimpleCableKey, type SimplePartKey,
} from "./simple-model";

/** A thing in the 3D view the robot can point at. */
export type GuideTarget =
  | { kind: "mount"; hostInstanceId: string; placeId: string }
  | { kind: "port"; hostInstanceId: string; placeId: string }
  | { kind: "part"; instanceId: string }
  /** A moving piece of a CPU socket: its lever, its load plate, or its orientation mark. */
  | { kind: "socket"; hostInstanceId: string; placeId: string; what: "lever" | "plate" | "mark"; socket: "lga" | "zif" }
  /** One drawn piece of a part (a memory slot's clip). */
  | { kind: "solid"; hostInstanceId: string; solidId: string; /** One plate of a stack (a case's expansion-slot cover), counted from the top. */ slice?: { index: number } }
  | { kind: "powerButton" };

export interface GuideFocus {
  /** What the robot points at; the second one (a radiator place) is highlighted too. */
  targets: GuideTarget[];
  /**
   * `place`: where the item in hand goes (already glowing). `prerequisite`: an earlier step comes
   * first. `next`: the next step, nothing in hand. `celebrate`: the build runs and is complete.
   */
  reason: "place" | "prerequisite" | "next" | "celebrate";
  /** The part or lead this is about, for the robot's caption. */
  subject?: { part: SimplePartKey } | { cable: SimpleCableKey };
}

const partId = (key: SimplePartKey) => partSpec(key).id;
/** The socket of the end being plugged now (or, for a lead that is in, the one to unplug first). */
const portTarget = (state: PCBuildState, key: SimpleCableKey, picked: { end: number | null; portId: string | null } | null = null): GuideTarget => {
  const ends = simpleCableEnds(key);
  const end = ends[simpleActiveEnd(state, key, picked?.end ?? null)] ?? ends.at(-1)!;
  // A free socket the learner has chosen for this end is the one the robot points at, ahead of the planned one.
  const chosen = picked?.portId && simplePortChoices(state, end).some((c) => c.portId === picked.portId && c.fits && !c.occupied) ? picked.portId : null;
  return { kind: "port", hostInstanceId: end.instanceId, placeId: chosen ?? simpleEndSocket(state, end) };
};

/** The places a part goes: its own, and a liquid cooler's radiator place in the case. */
function placesOf(state: PCBuildState, key: SimplePartKey, chosen: string | null): GuideTarget[] {
  // A memory module goes wherever the learner brings it: until it is in a slot, the place to look at is
  // the module itself (the page points at the slot it is held over). No default slot is implied.
  if (isRamKey(key) && !state.parts.find((p) => p.instanceId === partId(key))?.attachments.length) return [{ kind: "part", instanceId: partId(key) }];
  // A bay or fan place is the learner's choice: nothing is implied until one is chosen, then the chosen place is pointed at.
  const unplaced = !state.parts.find((p) => p.instanceId === partId(key))?.attachments.length;
  if (isPositionKey(key) && unplaced && !chosen) return [{ kind: "part", instanceId: partId(key) }];
  const target = simpleTarget(state, key, isPositionKey(key) && unplaced ? chosen ?? undefined : undefined);
  const radiator = simpleRadiatorTarget(key);
  return [
    { kind: "mount", hostInstanceId: target.hostInstanceId, placeId: target.mountPointId },
    ...(radiator ? [{ kind: "mount", hostInstanceId: radiator.hostInstanceId, placeId: radiator.mountPointId } as GuideTarget] : []),
  ];
}

/** The first part `key` still waits for (either CPU meets "cpu"), as the part to pick up. */
function missingBefore(state: PCBuildState, key: SimplePartKey): SimplePartKey | null {
  for (const need of simplePrerequisites(key)) {
    if (simpleSlotFilled(state, slotOf(need))) continue;
    // The earlier step may itself wait for one: go back to the first that can be done now.
    return simpleBlock(state, need) === null ? need : (missingBefore(state, need) ?? need);
  }
  return null;
}

/**
 * A graphics card: the robot points at what the next step works on. A rear cover is its own plate in the case's
 * rear wall, the latch is the slot's own, the screws are at the card's bracket; aligning and seating stay at the slot.
 */
function gpuTargets(state: PCBuildState, key: SimplePartKey): GuideTarget[] | null {
  const step = nextHandStep(state, key, null);
  const ret = simpleRetention(state, key);
  if (!step || !ret) return null;
  if (step.kind === "covers") {
    const covers = slotCovers(state);
    const caseId = state.parts.find((p) => p.instanceId === partSpec("motherboard").id)?.attachments[0]?.target.hostInstanceId;
    return caseId ? [{ kind: "solid", hostInstanceId: caseId, solidId: "slot-covers", slice: { index: covers.findIndex((c) => c.id === step.id) } }] : null;
  }
  if (step.kind === "mechanism") return [{ kind: "solid", hostInstanceId: ret.hostInstanceId, solidId: `${ret.mountPointId}-latch` }];
  if (step.kind === "fasten") return [{ kind: "part", instanceId: partId(key) }];
  return null;
}

function forPart(state: PCBuildState, key: SimplePartKey, chosen: string | null = null): GuideFocus {
  if (simplePartInstalled(state, key)) return { targets: [{ kind: "part", instanceId: partId(key) }], reason: "place", subject: { part: key } };
  // The other CPU or cooler is in: point at it, the one to swap (or to unplug first).
  const rival = simpleSlotPart(state, slotOf(key));
  if (rival && rival !== key) {
    const blocked = simpleSwapBlock(state, key);
    if (blocked === "unplugCoolerFirst") {
      const lead = ALL_SIMPLE_CABLES.find((cable) => cable.requires.some((k) => slotOf(k) === "cooler") && simpleCableConnected(state, cable.key))?.key;
      if (lead) return { targets: [portTarget(state, lead)], reason: "prerequisite", subject: { cable: lead } };
    }
    if (blocked === "removeCoolerFirst") {
      const cooler = simpleSlotPart(state, "cooler")!;
      return { targets: [{ kind: "part", instanceId: partId(cooler) }], reason: "prerequisite", subject: { part: cooler } };
    }
    return { targets: [{ kind: "part", instanceId: partId(rival) }], reason: "prerequisite", subject: { part: rival } };
  }
  const blocked = simpleBlock(state, key);
  if (blocked) {
    const first = missingBefore(state, key);
    if (first) return { targets: [{ kind: "part", instanceId: partId(first) }], reason: "prerequisite", subject: { part: first } };
  }
  const card = roleOf(key) === "gpu" ? gpuTargets(state, key) : null;
  return { targets: card ?? placesOf(state, key, chosen), reason: "place", subject: { part: key } };
}

function forCable(state: PCBuildState, key: SimpleCableKey, picked: { end: number | null; portId: string | null } | null = null): GuideFocus {
  if (simpleCableBlock(state, key) === "fitCableParts") {
    const missing = simpleCableMissingParts(state, key)[0];
    if (missing) {
      // The part the lead waits for may wait for another itself: the first one that can go in now.
      const part = simpleBlock(state, missing) ? (missingBefore(state, missing) ?? missing) : missing;
      return { targets: [{ kind: "part", instanceId: partId(part) }], reason: "prerequisite", subject: { part } };
    }
  }
  return { targets: [portTarget(state, key, picked)], reason: "place", subject: { cable: key } };
}

/**
 * Where the robot goes now. `null` keeps it parked out of sight: nothing in hand and the learner
 * has not asked for help (guidance only starts once they select something or ask).
 */
/** `chosen`: the bay or fan place the learner picked for the selected part, if any; `picked`: the end and socket the learner chose for the selected lead. */
export function guideFocus(state: PCBuildState, selection: Selection, powered: boolean, asked: boolean, chosen: string | null = null, picked: { end: number | null; portId: string | null } | null = null): GuideFocus | null {
  if (powered && simpleAssemblyComplete(state)) return { targets: [{ kind: "powerButton" }], reason: "celebrate" };
  if (selection?.kind === "part" && !powered) return forPart(state, selection.key, chosen);
  if (selection?.kind === "cable" && !powered) return forCable(state, selection.key, picked);
  if (!asked) return null;
  const next = nextAction(state, powered);
  switch (next.kind) {
    case "part": {
      const focus = forPart(state, next.key);
      // Nothing in hand yet: the part to pick up first, on the bench.
      return focus.reason === "prerequisite" ? focus : { targets: [{ kind: "part", instanceId: partId(next.key) }], reason: "next", subject: { part: next.key } };
    }
    case "cable":
      return { ...forCable(state, next.key), reason: "next" };
    case "swapCooler": {
      const lead = simpleCableConnected(state, "cpuFan") ? "cpuFan" : null;
      if (lead) return { targets: [portTarget(state, lead)], reason: "next", subject: { cable: lead } };
      return { targets: [{ kind: "part", instanceId: partId("cooler") }], reason: "next", subject: { part: "cooler" } };
    }
    case "power":
    case "turnOff":
      return { targets: [{ kind: "powerButton" }], reason: "next" };
    case "done":
      return { targets: [{ kind: "powerButton" }], reason: "celebrate" };
  }
}

