// Target registry core: no React, no DOM. Rect and viewport readers are injected so the
// logic runs under plain Node in tests. The DOM wiring lives in ./dom.ts.
import {
  TARGET_ID_PATTERN,
  type TargetId,
  type TargetRect,
  type TargetResolution,
  type TutorTargetKind,
  type TutorTargetRef,
} from "@ytl/contracts";

const KINDS: readonly TutorTargetKind[] = ["ui", "component", "connector", "port", "cable-end", "setting"];

/** Share of the target's area that must be inside the viewport to count as visible. */
const VISIBLE_FRACTION = 0.5;

export interface Viewport {
  width: number;
  height: number;
}

export interface RevealOptions {
  /** When true the scroll jumps instead of animating. */
  reducedMotion: boolean;
  /** Where the target ends up in the viewport. `start` is for when the lower part is covered. Default `center`. */
  block?: "center" | "start";
}

/**
 * Where a target is on screen. A DOM element, a projected 3D part or an editor line
 * each supply one of these; the registry never looks anything up by itself.
 */
export interface TargetSource {
  /** Current viewport rectangle, or `null` when the target is not rendered. */
  getRect(): TargetRect | null;
  /** Bring the target into the viewport. Optional: a source that cannot scroll omits it. */
  reveal?(options: RevealOptions): void;
}

export type TargetRegistryErrorCode = "invalid_id" | "invalid_kind";

export class TargetRegistryError extends Error {
  readonly code: TargetRegistryErrorCode;
  constructor(code: TargetRegistryErrorCode, message: string) {
    super(message);
    this.name = "TargetRegistryError";
    this.code = code;
  }
}

/** What the active project looks like now; guidance made for another revision or run is stale. */
export interface GuidanceContext {
  projectRevision?: number;
  executionId?: string;
}

export type GuidanceCheck =
  | { ok: true; resolution: TargetResolution }
  | { ok: false; reason: "invalid_id" | "unknown" | "kind_mismatch" | "stale" };

export type ResolutionListener = (resolution: TargetResolution) => void;

export interface RegistryEnvironment {
  getViewport(): Viewport;
  /** Runs `flush` once, soon (one animation frame in the browser). Returns a cancel function. */
  schedule(flush: () => void): () => void;
}

export interface TargetRegistry {
  /** Throws TargetRegistryError for a malformed ID or kind. Returns the unregister function. */
  register(ref: { id: TargetId; kind: TutorTargetKind }, source: TargetSource): () => void;
  has(id: TargetId): boolean;
  kindOf(id: TargetId): TutorTargetKind | undefined;
  /** Never throws: a malformed or unregistered ID resolves to `unknown`. */
  resolve(id: TargetId): TargetResolution;
  /** Validates guidance before the tutor acts on it: ID shape, registration, kind, revision and execution. */
  checkGuidance(ref: TutorTargetRef, context?: GuidanceContext): GuidanceCheck;
  /** Scrolls an offscreen target into view. Returns false when there is nothing to reveal. */
  reveal(id: TargetId, options: RevealOptions): boolean;
  /**
   * Calls `listener` with the current resolution, then again whenever it changes
   * (after `invalidate`, a register or an unregister). Unchanged results are not re-sent.
   */
  subscribe(id: TargetId, listener: ResolutionListener): () => void;
  /** Called after every flush; for things that depend on layout but not on one target. */
  subscribeLayout(listener: () => void): () => void;
  /** Something moved (scroll, resize, layout, direction). Coalesced through `environment.schedule`. */
  invalidate(): void;
  /** Re-resolves now instead of waiting for the scheduled flush. */
  flush(): void;
  /**
   * Rectangles of every registered target that is at least partly inside the viewport, without
   * `exceptId`. The robot keeps off these while it points at something else.
   */
  rectsInView(exceptId?: TargetId): TargetRect[];
  /** IDs registered more than once at this moment; a sign of two elements claiming one ID. */
  duplicates(): TargetId[];
  /** Number of active per-target subscriptions; the DOM wiring uses it to idle when nobody listens. */
  subscriptionCount(): number;
}

export function isValidTargetId(id: unknown): id is TargetId {
  return typeof id === "string" && id.length <= 200 && TARGET_ID_PATTERN.test(id);
}

/** `guidance` is a target ref or anything else stamped with the revision and run it was made for. */
export function isGuidanceStale(guidance: TutorTargetRef | GuidanceContext, context: GuidanceContext): boolean {
  if (guidance.projectRevision !== undefined && guidance.projectRevision !== context.projectRevision) return true;
  if (guidance.executionId !== undefined && guidance.executionId !== context.executionId) return true;
  return false;
}

/** Classifies a rectangle against the viewport. Exported for tests and for non-DOM sources. */
export function classifyRect(rect: TargetRect | null, viewport: Viewport): TargetResolution {
  if (!rect) return { status: "hidden" };
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (!values.every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return { status: "hidden" };
  const clean: TargetRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  const overlapX = Math.min(clean.x + clean.width, viewport.width) - Math.max(clean.x, 0);
  const overlapY = Math.min(clean.y + clean.height, viewport.height) - Math.max(clean.y, 0);
  if (overlapX <= 0 || overlapY <= 0) return { status: "offscreen", rect: clean };
  const inView = overlapX * overlapY;
  const enough =
    inView >= clean.width * clean.height * VISIBLE_FRACTION ||
    // A target larger than the viewport is visible once it fills half of the viewport.
    inView >= viewport.width * viewport.height * VISIBLE_FRACTION;
  return enough ? { status: "visible", rect: clean } : { status: "offscreen", rect: clean };
}

export function sameResolution(a: TargetResolution, b: TargetResolution): boolean {
  if (a.status !== b.status) return false;
  if ("rect" in a && "rect" in b) {
    return a.rect.x === b.rect.x && a.rect.y === b.rect.y && a.rect.width === b.rect.width && a.rect.height === b.rect.height;
  }
  return true;
}

interface Entry {
  kind: TutorTargetKind;
  source: TargetSource;
}

interface Subscription {
  listener: ResolutionListener;
  last: TargetResolution;
}

export function createTargetRegistry(environment: RegistryEnvironment): TargetRegistry {
  // Each ID keeps a stack: the newest registration is the active one, and removing it
  // falls back to the one before (a remount registers the new element before the old one leaves).
  const entries = new Map<TargetId, Entry[]>();
  const subscriptions = new Map<TargetId, Set<Subscription>>();
  const layoutListeners = new Set<() => void>();
  let cancelScheduled: (() => void) | null = null;

  const rectOf = (entry: Entry): TargetRect | null => {
    try {
      return entry.source.getRect();
    } catch {
      return null;
    }
  };

  /**
   * The registration that answers for an ID: the newest one, unless it is hidden (a 3D target behind
   * another part, or facing away) while an older one (the same thing's row in the list) can be shown.
   * Then the older one answers, so "Show me where" always has somewhere to point.
   */
  const active = (id: TargetId): Entry | undefined => {
    const stack = entries.get(id);
    if (!stack || stack.length === 0) return undefined;
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const entry = stack[i]!;
      if (classifyRect(rectOf(entry), environment.getViewport()).status !== "hidden") return entry;
    }
    return stack[stack.length - 1];
  };

  function resolve(id: TargetId): TargetResolution {
    if (!isValidTargetId(id)) return { status: "unknown" };
    const entry = active(id);
    if (!entry) return { status: "unknown" };
    return classifyRect(rectOf(entry), environment.getViewport());
  }

  function notify(id: TargetId) {
    const set = subscriptions.get(id);
    if (!set) return;
    const next = resolve(id);
    for (const subscription of [...set]) {
      if (sameResolution(subscription.last, next)) continue;
      subscription.last = next;
      subscription.listener(next);
    }
  }

  function flush() {
    cancelScheduled?.();
    cancelScheduled = null;
    for (const id of [...subscriptions.keys()]) notify(id);
    for (const listener of [...layoutListeners]) listener();
  }

  function invalidate() {
    if (cancelScheduled) return;
    cancelScheduled = environment.schedule(() => {
      cancelScheduled = null;
      flush();
    });
  }

  return {
    register(ref, source) {
      if (!isValidTargetId(ref.id)) {
        throw new TargetRegistryError("invalid_id", `Not a tutor target ID: ${JSON.stringify(ref.id)}`);
      }
      if (!KINDS.includes(ref.kind)) {
        throw new TargetRegistryError("invalid_kind", `Not a tutor target kind: ${JSON.stringify(ref.kind)}`);
      }
      const entry: Entry = { kind: ref.kind, source };
      const stack = entries.get(ref.id);
      if (stack) stack.push(entry);
      else entries.set(ref.id, [entry]);
      notify(ref.id);
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        const current = entries.get(ref.id);
        if (!current) return;
        const index = current.indexOf(entry);
        if (index >= 0) current.splice(index, 1);
        if (current.length === 0) entries.delete(ref.id);
        notify(ref.id);
      };
    },
    has: (id) => isValidTargetId(id) && entries.has(id),
    kindOf: (id) => (isValidTargetId(id) ? active(id)?.kind : undefined),
    resolve,
    checkGuidance(ref, context = {}) {
      if (!isValidTargetId(ref.id)) return { ok: false, reason: "invalid_id" };
      const entry = active(ref.id);
      if (!entry) return { ok: false, reason: "unknown" };
      if (entry.kind !== ref.kind) return { ok: false, reason: "kind_mismatch" };
      if (isGuidanceStale(ref, context)) return { ok: false, reason: "stale" };
      return { ok: true, resolution: resolve(ref.id) };
    },
    reveal(id, options) {
      if (!isValidTargetId(id)) return false;
      const entry = active(id);
      if (!entry?.source.reveal) return false;
      if (resolve(id).status === "hidden") return false;
      entry.source.reveal(options);
      invalidate();
      return true;
    },
    subscribe(id, listener) {
      const subscription: Subscription = { listener, last: resolve(id) };
      let set = subscriptions.get(id);
      if (!set) subscriptions.set(id, (set = new Set()));
      set.add(subscription);
      listener(subscription.last);
      return () => {
        const current = subscriptions.get(id);
        if (!current) return;
        current.delete(subscription);
        if (current.size === 0) subscriptions.delete(id);
      };
    },
    subscribeLayout(listener) {
      layoutListeners.add(listener);
      return () => {
        layoutListeners.delete(listener);
      };
    },
    rectsInView(exceptId) {
      const viewport = environment.getViewport();
      const rects: TargetRect[] = [];
      for (const id of entries.keys()) {
        if (id === exceptId) continue;
        const resolution = resolve(id);
        if (!("rect" in resolution)) continue;
        const { rect } = resolution;
        const inView = rect.x < viewport.width && rect.x + rect.width > 0 && rect.y < viewport.height && rect.y + rect.height > 0;
        if (inView) rects.push(rect);
      }
      return rects;
    },
    invalidate,
    flush,
    duplicates: () => [...entries].filter(([, stack]) => stack.length > 1).map(([id]) => id),
    subscriptionCount: () => {
      let count = 0;
      for (const set of subscriptions.values()) count += set.size;
      return count;
    },
  };
}
