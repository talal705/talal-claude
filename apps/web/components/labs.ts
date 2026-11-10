import type { LabMode, LabType } from "@ytl/contracts";

/**
 * The labs of the active product. `code` (the former Code Studio, removed 2026-10-27) stays a valid
 * stored LabType so learners' saved programming projects are kept, but it is archived: never opened.
 */
export type ActiveLab = Exclude<LabType, "code">;

export const LABS = ["pc", "network"] as const satisfies readonly ActiveLab[];

export const MODES = [
  { mode: "learn", labelKey: "learn" },
  { mode: "free", labelKey: "freeLab" },
  { mode: "test", labelKey: "testYourself" },
] as const satisfies readonly { mode: LabMode; labelKey: string }[];

export const ENTRIES = [
  { start: "direct", labelKey: "iKnow", target: "entry-know" },
  { start: "guided", labelKey: "helpMe", target: "entry-help" },
] as const;

export type EntryChoice = (typeof ENTRIES)[number]["start"];

export function isLab(value: unknown): value is ActiveLab {
  return typeof value === "string" && (LABS as readonly string[]).includes(value);
}

export function isMode(value: unknown): value is LabMode {
  return MODES.some((m) => m.mode === value);
}

export function isEntry(value: unknown): value is EntryChoice {
  return ENTRIES.some((e) => e.start === value);
}

export function modeLabelKey(mode: LabMode) {
  return MODES.find((m) => m.mode === mode)!.labelKey;
}

/** The lab's choices live in the URL so they survive a language switch, a reload and sharing. */
export function labHref(
  lab: ActiveLab,
  choice: { start?: EntryChoice | null; mode?: LabMode | null; project?: string | null; lesson?: string | null } = {},
): string {
  const params = new URLSearchParams();
  if (choice.start) params.set("start", choice.start);
  if (choice.mode) params.set("mode", choice.mode);
  if (choice.project) params.set("project", choice.project);
  if (choice.lesson) params.set("lesson", choice.lesson);
  const query = params.toString();
  return query ? `/${lab}?${query}` : `/${lab}`;
}
