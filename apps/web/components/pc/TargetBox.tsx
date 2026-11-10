"use client";

import type { HTMLAttributes, Ref } from "react";
import type { TutorTargetRef } from "@ytl/contracts";
import { useTutorTarget } from "@/lib/targets";

/** A list item or block the tutor can point at, registered under the engine's own target reference. */
export function TargetBox({
  as: Tag = "div",
  target,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: "div" | "li" | "section"; target: Pick<TutorTargetRef, "id" | "kind"> }) {
  const ref = useTutorTarget<HTMLElement>(target.id, target.kind);
  // `data-target` lets browser checks find the element by the engine's own ID; it changes no behaviour.
  return <Tag ref={ref as Ref<never>} data-target={target.id} {...props} />;
}
