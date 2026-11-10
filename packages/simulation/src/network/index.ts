// Network lab engine: pure, deterministic logic over @ytl/contracts data. No rendering, React or
// DOM, and no access to any real network (see README.md and no-real-network.test.ts).
export { ID_PREFIX, ROLES, createDevice } from "./devices";
export { applyAction, cablePortOptions, canRedo, canUndo, checkConnect, createHistory, createNetwork, dispatch, redo, replay, timelineLog, toProjectData, undo } from "./reducer";
export { STANDARD_ORDER, checkCable, checkPlug, isValidOrder, matchStandard, scrambledWireOrder } from "./wiremap";
export { HOME_WITH_GATEWAY, HOME_WITH_ONT, networkPresets } from "./presets";
export type { NetworkPreset } from "./presets";
export { resolveLinks } from "./links";
export type { Link, LinkProblem } from "./links";
export { HOP_LIMIT, runConnectivity } from "./connectivity";
export { diagnoseNetwork } from "./diagnose";
export { formatIpv4, isIpv4Literal, maskPrefix, parseIpv4 } from "./ip";

import type { NetworkEvaluationContext, NetworkResolvedInterface, NetworkState } from "@ytl/contracts";
import { publicInterfaces } from "./addressing";
import { makeWorld } from "./connectivity";

/** The address every interface has right now: typed by hand, or leased by DHCP (and by whom). */
export function resolveInterfaces(state: NetworkState, context: NetworkEvaluationContext = {}): NetworkResolvedInterface[] {
  return publicInterfaces(makeWorld(state, context).addressing);
}
