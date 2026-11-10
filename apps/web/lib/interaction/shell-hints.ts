// Rule-based help for pages outside the labs, chosen from the route.
// Text lives in messages/{en,ar}/tutor.json under `tutor.hints`.
import type { HintTopic } from "./hint-ladder";

/** Target IDs the shell pages register (agreed with `frontend`). */
export const SHELL_TARGETS = {
  navPc: "shell:ui:nav-pc",
  navNetwork: "shell:ui:nav-network",
  navProjects: "shell:ui:nav-projects",
  localeSwitch: "shell:ui:locale-switch",
  homeLabPc: "home:ui:lab-pc",
  homeLabNetwork: "home:ui:lab-network",
} as const;

const HOME: HintTopic = {
  id: "shell.home",
  title: { key: "hints.home.title" },
  levels: [
    { text: { key: "hints.home.level1" } },
    { text: { key: "hints.home.level2" }, target: { id: SHELL_TARGETS.homeLabPc, kind: "ui" } },
    { text: { key: "hints.home.level3" }, target: { id: SHELL_TARGETS.homeLabPc, kind: "ui" } },
  ],
};

export function topicForPath(pathname: string): HintTopic | null {
  return pathname === "/" ? HOME : null;
}
