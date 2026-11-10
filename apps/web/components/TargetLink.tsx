"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import type { TargetId } from "@ytl/contracts";
import { useTutorTarget } from "@/lib/targets";

/** A link the tutor can point at. `targetId` must match TARGET_ID_PATTERN, e.g. `pc:ui:mode-learn`. */
export function TargetLink({ targetId, ...props }: ComponentProps<typeof Link> & { targetId: TargetId }) {
  const ref = useTutorTarget<HTMLAnchorElement>(targetId, "ui");
  return <Link ref={ref} {...props} />;
}
