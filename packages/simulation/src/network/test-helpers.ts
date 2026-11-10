import type { NetworkAction, NetworkState } from "@ytl/contracts";
import { applyAction, createNetwork } from "./reducer";

/** Applies actions in order and fails loudly on the first rejection. */
export function build(actions: NetworkAction[], from: NetworkState = createNetwork()): NetworkState {
  let state = from;
  for (const action of actions) {
    const result = applyAction(state, action);
    if (!result.ok) throw new Error(`rejected ${JSON.stringify(action)}: ${result.rejection.message.en}`);
    state = result.state;
  }
  return state;
}

export { HOME_WITH_GATEWAY, HOME_WITH_ONT } from "./presets";
