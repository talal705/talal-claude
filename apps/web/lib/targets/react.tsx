"use client";

import { useCallback, type ReactNode } from "react";
import type { TargetId, TutorTargetKind } from "@ytl/contracts";
import { elementSource, getTargetRegistry, observeElement } from "./dom";

function registerElement(id: TargetId, kind: TutorTargetKind, element: Element): () => void {
  const unregister = getTargetRegistry().register({ id, kind }, elementSource(element));
  const unobserve = observeElement(element);
  return () => {
    unobserve();
    unregister();
  };
}

/**
 * Marks an element as a tutor target. Returns a ref callback:
 * `const ref = useTutorTarget("shell:ui:locale-switch", "ui"); <button ref={ref} />`.
 * A malformed ID throws on mount so the mistake is caught in development.
 */
export function useTutorTarget<T extends Element = Element>(id: TargetId, kind: TutorTargetKind) {
  return useCallback(
    (element: T | null) => {
      if (!element) return;
      return registerElement(id, kind, element);
    },
    [id, kind],
  );
}

/**
 * Marks its single child element as a tutor target from a server component:
 * `<TutorTarget id="home:ui:lab-pc" kind="ui"><Link … /></TutorTarget>`.
 * Renders a `display: contents` span, so it adds no box and does not change layout.
 */
export function TutorTarget({ id, kind, children }: { id: TargetId; kind: TutorTargetKind; children: ReactNode }) {
  const ref = useCallback(
    (wrapper: HTMLSpanElement | null) => {
      const element = wrapper?.firstElementChild;
      if (!element) return;
      return registerElement(id, kind, element);
    },
    [id, kind],
  );
  return (
    <span ref={ref} style={{ display: "contents" }}>
      {children}
    </span>
  );
}
