import { describe, expect, it } from "vitest";
import { exportFileName } from "./file-name";

describe("exportFileName", () => {
  it("is a plain ASCII download name", () => {
    expect(exportFileName("My first build!")).toBe("My-first-build.ytl.json");
    expect(exportFileName("حاسوبي", "pc-build")).toBe("pc-build.ytl.json");
    expect(exportFileName("  a/b\\c  ")).toBe("a-b-c.ytl.json");
  });
});
