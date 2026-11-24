// Where the guide robot points in the 3D view, decided only from the build and the simulation's own
// rules — never from a language model. The 3D view turns a `GuideTarget` into a scene position with
// the same mount and port frames it uses to draw parts and glowing places (see docs/PC_GUIDE.md).
//
//   selection (part)  → its place, or (when blocked) the earlier part or place it waits for
//   selection (lead)  → its port, or the part it waits for
//   nothing in hand   → the next step: the part to pick up, the port of the next lead, the power button
//   running, complete → celebrate beside the case
import type { PCBuildState } from "@ytl/contracts";
import { nextAction, type Selection } from "./companion";
import {
  ALL_SIMPLE_CABLES, cableSpec, isRamKey, partSpec, simpleAssemblyComplete, simpleBlock, simpleCableBlock, simpleCableConnected, simpleCableMissingParts,
  simplePartInstalled, simplePrerequisites, simpleRadiatorTarget, simpleSlotFilled, simpleSlotPart, simpleSwapBlock, simpleTarget, slotOf,
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
  | { kind: "solid"; hostInstanceId: string; solidId: string }
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
const portTarget = (key: SimpleCableKey): GuideTarget => ({ kind: "port", hostInstanceId: cableSpec(key).instanceId, placeId: cableSpec(key).portId });

/** The places a part goes: its own, and a liquid cooler's radiator place in the case. */
function placesOf(state: PCBuildState, key: SimplePartKey): GuideTarget[] {
  // A memory module goes wherever the learner brings it: until it is in a slot, the place to look at is
  // the module itself (the page points at the slot it is held over). No default slot is implied.
  if (isRamKey(key) && !state.parts.find((p) => p.instanceId === partId(key))?.attachments.length) return [{ kind: "part", instanceId: partId(key) }];
  const target = simpleTarget(state, key);
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

function forPart(state: PCBuildState, key: SimplePartKey): GuideFocus {
  if (simplePartInstalled(state, key)) return { targets: [{ kind: "part", instanceId: partId(key) }], reason: "place", subject: { part: key } };
  // The other CPU or cooler is in: point at it, the one to swap (or to unplug first).
  const rival = simpleSlotPart(state, slotOf(key));
  if (rival && rival !== key) {
    const blocked = simpleSwapBlock(state, key);
    if (blocked === "unplugCoolerFirst") {
      const lead = ALL_SIMPLE_CABLES.find((cable) => cable.requires.some((k) => slotOf(k) === "cooler") && simpleCableConnected(state, cable.key))?.key;
      if (lead) return { targets: [portTarget(lead)], reason: "prerequisite", subject: { cable: lead } };
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
  return { targets: placesOf(state, key), reason: "place", subject: { part: key } };
}

function forCable(state: PCBuildState, key: SimpleCableKey): GuideFocus {
  if (simpleCableBlock(state, key) === "fitCableParts") {
    const missing = simpleCableMissingParts(state, key)[0];
    if (missing) {
      // The part the lead waits for may wait for another itself: the first one that can go in now.
      const part = simpleBlock(state, missing) ? (missingBefore(state, missing) ?? missing) : missing;
      return { targets: [{ kind: "part", instanceId: partId(part) }], reason: "prerequisite", subject: { part } };
    }
  }
  return { targets: [portTarget(key)], reason: "place", subject: { cable: key } };
}

/**
 * Where the robot goes now. `null` keeps it parked out of sight: nothing in hand and the learner
 * has not asked for help (guidance only starts once they select something or ask).
 */
export function guideFocus(state: PCBuildState, selection: Selection, powered: boolean, asked: boolean): GuideFocus | null {
  if (powered && simpleAssemblyComplete(state)) return { targets: [{ kind: "powerButton" }], reason: "celebrate" };
  if (selection?.kind === "part" && !powered) return forPart(state, selection.key);
  if (selection?.kind === "cable" && !powered) return forCable(state, selection.key);
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
      if (lead) return { targets: [portTarget(lead)], reason: "next", subject: { cable: lead } };
      return { targets: [{ kind: "part", instanceId: partId("cooler") }], reason: "next", subject: { part: "cooler" } };
    }
    case "power":
    case "turnOff":
      return { targets: [{ kind: "powerButton" }], reason: "next" };
    case "done":
      return { targets: [{ kind: "powerButton" }], reason: "celebrate" };
  }
}

