// Browser wiring for the target registry: element sources and the events that move things.
import type { TargetRect } from "@ytl/contracts";
import { createTargetRegistry, type TargetRegistry, type TargetSource } from "./registry";

/** Layout can change without any event (fonts, transitions); checked at this pace while someone subscribes. */
const SAFETY_POLL_MS = 300;

let registry: TargetRegistry | null = null;
let resizeObserver: ResizeObserver | null = null;
const observed = new Map<Element, number>();

function start(target: TargetRegistry) {
  const invalidate = () => target.invalidate();
  // Capture phase so scrolling inside any panel is seen, not only the page scroll.
  window.addEventListener("scroll", invalidate, { capture: true, passive: true });
  window.addEventListener("resize", invalidate, { passive: true });
  window.visualViewport?.addEventListener("resize", invalidate, { passive: true });
  window.visualViewport?.addEventListener("scroll", invalidate, { passive: true });
  document.addEventListener("visibilitychange", invalidate);
  document.fonts?.ready.then(invalidate, () => {});

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(invalidate);
    resizeObserver.observe(document.documentElement);
    if (document.body) resizeObserver.observe(document.body);
    for (const element of observed.keys()) resizeObserver.observe(element);
  }
  if (typeof MutationObserver !== "undefined") {
    // The language switch changes `dir` and `lang` on <html> without a reload.
    new MutationObserver(invalidate).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["dir", "lang", "class", "style"],
    });
  }
  window.setInterval(() => {
    if (!document.hidden && target.subscriptionCount() > 0) target.invalidate();
  }, SAFETY_POLL_MS);
}

/** The page-wide registry. Browser only: call it from effects and event handlers, not during render. */
export function getTargetRegistry(): TargetRegistry {
  if (registry) return registry;
  if (typeof window === "undefined") throw new Error("getTargetRegistry() is browser-only");
  registry = createTargetRegistry({
    getViewport: () => ({
      width: document.documentElement.clientWidth || window.innerWidth,
      height: window.innerHeight,
    }),
    schedule: (flush) => {
      const handle = window.requestAnimationFrame(flush);
      return () => window.cancelAnimationFrame(handle);
    },
  });
  start(registry);
  return registry;
}

function isRendered(element: Element): boolean {
  if (!element.isConnected) return false;
  if (typeof element.checkVisibility === "function") {
    return element.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true });
  }
  return true;
}

/** A target backed by one element. The rectangle is read fresh on every resolve. */
export function elementSource(element: Element): TargetSource {
  return {
    getRect(): TargetRect | null {
      if (!isRendered(element)) return null;
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    },
    reveal({ reducedMotion, block = "center" }) {
      element.scrollIntoView({ block, inline: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
    },
  };
}

/** Size changes of a registered element trigger a re-resolve. Returns the stop function. */
export function observeElement(element: Element): () => void {
  observed.set(element, (observed.get(element) ?? 0) + 1);
  resizeObserver?.observe(element);
  return () => {
    const count = (observed.get(element) ?? 1) - 1;
    if (count > 0) {
      observed.set(element, count);
      return;
    }
    observed.delete(element);
    resizeObserver?.unobserve(element);
  };
}
