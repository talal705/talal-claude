// PC lab rule engine: pure, deterministic logic over @ytl/contracts data. No rendering, React or DOM.
export * from "./catalog";
export * from "./connectors";
export { applyAction, createBuild, DEFAULT_LIGHTING } from "./reducer";
export { checkMount, mountOptions } from "./placement";
export { cableEndOptions, checkConnect } from "./cabling";
export { canRedo, canUndo, createHistory, dispatch, redo, replay, timelineLog, toProjectData, undo } from "./history";
export type { ReplayResult } from "./history";
export { LOAD_MODEL, diagnoseBuild, evaluateStartup } from "./startup";
export { makeView } from "./view";
// Generated educational geometry and thumbnails (assets/pc/), and their validation.
export * as visual from "./visual";
