import { describe, expect, it } from "vitest";
import { ProjectStoreError } from "@ytl/contracts";
import { conflict, corruptRecord, invalid, notFound, toStoreError } from "./validation";

// The messages are shown to learners and matched by callers, so they must not drift.
describe("shared store errors", () => {
  it("builds the fixed messages and codes", () => {
    expect(notFound("project", "p1")).toMatchObject({ code: "not_found", message: "project p1 was not found" });
    expect(conflict(2, 5)).toMatchObject({
      code: "revision_conflict",
      message: "expected revision 2 but the project is at revision 5; nothing was written",
    });
    expect(corruptRecord("progress for lesson a (learn)")).toMatchObject({
      code: "corrupt",
      message: "progress for lesson a (learn) is stored but failed validation; it was left in place",
    });
    expect(() => invalid("bad")).toThrow(expect.objectContaining({ code: "invalid_input", message: "bad" }));
    expect(notFound("project", "p1")).toBeInstanceOf(ProjectStoreError);
  });

  describe("toStoreError (account database failures)", () => {
    it("passes a ProjectStoreError through unchanged", () => {
      const original = notFound("project", "p1");
      expect(toStoreError(original, "project")).toBe(original);
      expect(toStoreError(original, "progress")).toBe(original);
    });

    it("reports constraint and data-exception failures (SQLSTATE 22/23) as invalid input with the database message", () => {
      for (const code of ["22P05", "23505", "23514"]) {
        const mapped = toStoreError(Object.assign(new Error("duplicate key"), { code }), "project");
        expect(mapped).toBeInstanceOf(ProjectStoreError);
        expect(mapped).toMatchObject({ code: "invalid_input", message: "duplicate key" });
      }
    });

    it("hides every other failure behind a generic unavailable message that names the database", () => {
      const error = Object.assign(new Error("connection refused"), { code: "08006" });
      expect(toStoreError(error, "project")).toMatchObject({
        code: "unavailable",
        message: "The project database is unavailable (connection refused)",
      });
      expect(toStoreError(error, "progress")).toMatchObject({
        code: "unavailable",
        message: "The progress database is unavailable (connection refused)",
      });
    });

    it("handles values that are not Error objects", () => {
      expect(toStoreError("boom", "progress")).toMatchObject({
        code: "unavailable",
        message: "The progress database is unavailable (boom)",
      });
      expect(toStoreError({ code: 23505 }, "project")).toMatchObject({ code: "invalid_input", message: "[object Object]" });
      expect(toStoreError(null, "project")).toMatchObject({ code: "unavailable", message: "The project database is unavailable (null)" });
    });
  });
});
