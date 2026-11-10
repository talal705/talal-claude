import { describe, expect, it } from "vitest";
import { TARGET_ID_PATTERN } from "@ytl/contracts";
import { ENTRIES, LABS, MODES, isEntry, isLab, isMode, labHref, modeLabelKey } from "./labs";

describe("labHref", () => {
  it("returns the bare lab route when nothing is chosen", () => {
    expect(labHref("pc")).toBe("/pc");
    expect(labHref("network", { start: null, mode: null })).toBe("/network");
  });

  it("keeps both choices in the query", () => {
    expect(labHref("pc", { mode: "free" })).toBe("/pc?mode=free");
    expect(labHref("network", { start: "guided", mode: "learn" })).toBe("/network?start=guided&mode=learn");
    expect(labHref("pc", { mode: "free", project: "a b" })).toBe("/pc?mode=free&project=a+b");
  });
});

describe("query guards", () => {
  it("accept only known values", () => {
    expect(isMode("test")).toBe(true);
    expect(isMode("freeLab")).toBe(false);
    expect(isMode(["learn"])).toBe(false);
    expect(isEntry("guided")).toBe(true);
    expect(isEntry(undefined)).toBe(false);
    expect(isLab("pc")).toBe(true);
    // The former Code Studio is archived: its stored projects are kept but it is no lab to open.
    expect(isLab("code")).toBe(false);
    expect(isLab("server")).toBe(false);
  });

  it("maps every mode to a message key", () => {
    expect(MODES.map((m) => modeLabelKey(m.mode))).toEqual(["learn", "freeLab", "testYourself"]);
  });
});

describe("tutor target IDs used by the lab pages", () => {
  it("match TARGET_ID_PATTERN", () => {
    const ids = LABS.flatMap((lab) => [
      ...ENTRIES.map((entry) => `${lab}:ui:${entry.target}`),
      ...MODES.map((item) => `${lab}:ui:mode-${item.mode}`),
      `home:ui:lab-${lab}`,
      `shell:ui:nav-${lab}`,
    ]);
    expect(ids).toHaveLength(14);
    for (const id of ids) expect(id).toMatch(TARGET_ID_PATTERN);
  });
});
