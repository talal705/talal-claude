export {
  TargetRegistryError,
  classifyRect,
  createTargetRegistry,
  isGuidanceStale,
  isValidTargetId,
  sameResolution,
  type GuidanceCheck,
  type GuidanceContext,
  type RegistryEnvironment,
  type ResolutionListener,
  type RevealOptions,
  type TargetRegistry,
  type TargetRegistryErrorCode,
  type TargetSource,
  type Viewport,
} from "./registry";
export { elementSource, getTargetRegistry, observeElement } from "./dom";
export { TutorTarget, useTutorTarget } from "./react";
