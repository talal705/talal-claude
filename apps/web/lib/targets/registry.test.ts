import { describe, expect, it, vi } from "vitest";
import type { TargetRect, TargetResolution } from "@ytl/contracts";
import {
  TargetRegistryError,
  classifyRect,
  createTargetRegistry,
  isGuidanceStale,
  isValidTargetId,
  type TargetSource,
} from "./registry";

/** A fake page: targets have document coordinates, the viewport has a size and a scroll offset. */
function setup(viewport = { width: 1000, height: 600 }) {
  const page = { ...viewport, scrollX: 0, scrollY: 0 };
  const pending: Array<() => void> = [];
  const registry = createTargetRegistry({
    getViewport: () => ({ width: page.width, height: page.height }),
    schedule: (flush) => {
      pending.push(flush);
      return () => {
        const index = pending.indexOf(flush);
        if (index >= 0) pending.splice(index, 1);
      };
    },
  });
  const at = (doc: TargetRect | null): TargetSource & { doc: TargetRect | null; revealed: number } => {
    const source = {
      doc,
      revealed: 0,
      getRect: () => (source.doc ? { ...source.doc, x: source.doc.x - page.scrollX, y: source.doc.y - page.scrollY } : null),
      reveal: () => {
        source.revealed += 1;
        if (source.doc) page.scrollY = source.doc.y - (page.height - source.doc.height) / 2;
      },
    };
    return source;
  };
  const runFrame = () => {
    for (const flush of pending.splice(0)) flush();
  };
  return { page, registry, at, runFrame, pending };
}

const box = (x: number, y: number, width = 100, height = 40): TargetRect => ({ x, y, width, height });

describe("target IDs", () => {
  it("accepts semantic IDs and rejects selectors and malformed IDs", () => {
    for (const id of ["shell:ui:nav-pc", "pc:port:mb-atx24", "pc:cable-end:psu-9.eps-1/device"]) {
      expect(isValidTargetId(id)).toBe(true);
    }
    for (const id of ["", "nav-pc", "#main", ".lab-card", "shell:ui:", "Shell:ui:nav", "shell:ui:a b", "a:b:c[href]", "a:b:c>d", "a:b:c\"]", 7, null]) {
      expect(isValidTargetId(id)).toBe(false);
    }
  });

  it("register throws on a malformed ID", () => {
    const { registry, at } = setup();
    expect(() => registry.register({ id: "div > a.nav-link", kind: "ui" }, at(box(0, 0)))).toThrow(TargetRegistryError);
    try {
      registry.register({ id: "#main", kind: "ui" }, at(box(0, 0)));
      expect.unreachable();
    } catch (error) {
      expect((error as TargetRegistryError).code).toBe("invalid_id");
    }
  });

  it("register throws on a kind outside the contract", () => {
    const { registry, at } = setup();
    expect(() => registry.register({ id: "shell:ui:x", kind: "selector" as never }, at(box(0, 0)))).toThrow(/kind/);
  });

  it("resolve returns unknown for a malformed ID without reading any source", () => {
    const { registry, at } = setup();
    const source = at(box(0, 0));
    const getRect = vi.spyOn(source, "getRect");
    registry.register({ id: "shell:ui:nav-pc", kind: "ui" }, source);
    getRect.mockClear();
    expect(registry.resolve("a[href='/pc']")).toEqual({ status: "unknown" });
    expect(registry.reveal("a[href='/pc']", { reducedMotion: false })).toBe(false);
    expect(getRect).not.toHaveBeenCalled();
  });
});

describe("register and unregister", () => {
  it("an ID that was never registered resolves to unknown", () => {
    const { registry } = setup();
    expect(registry.resolve("shell:ui:nav-pc")).toEqual({ status: "unknown" });
    expect(registry.has("shell:ui:nav-pc")).toBe(false);
  });

  it("resolves after register and is unknown again after unregister", () => {
    const { registry, at } = setup();
    const unregister = registry.register({ id: "shell:ui:nav-pc", kind: "ui" }, at(box(10, 20)));
    expect(registry.has("shell:ui:nav-pc")).toBe(true);
    expect(registry.kindOf("shell:ui:nav-pc")).toBe("ui");
    expect(registry.resolve("shell:ui:nav-pc")).toEqual({ status: "visible", rect: box(10, 20) });
    unregister();
    unregister();
    expect(registry.resolve("shell:ui:nav-pc")).toEqual({ status: "unknown" });
  });

  it("a duplicate ID: the newest registration wins and removing it falls back to the older one", () => {
    const { registry, at } = setup();
    const removeOld = registry.register({ id: "home:ui:lab-pc", kind: "ui" }, at(box(10, 10)));
    const removeNew = registry.register({ id: "home:ui:lab-pc", kind: "ui" }, at(box(300, 10)));
    expect(registry.duplicates()).toEqual(["home:ui:lab-pc"]);
    expect(registry.resolve("home:ui:lab-pc")).toMatchObject({ rect: { x: 300 } });
    removeNew();
    expect(registry.duplicates()).toEqual([]);
    expect(registry.resolve("home:ui:lab-pc")).toMatchObject({ rect: { x: 10 } });
    removeOld();
    expect(registry.has("home:ui:lab-pc")).toBe(false);
  });

  it("a remount (new registered before old removed) keeps the new element", () => {
    const { registry, at } = setup();
    const removeOld = registry.register({ id: "home:ui:lab-pc", kind: "ui" }, at(box(10, 10)));
    registry.register({ id: "home:ui:lab-pc", kind: "ui" }, at(box(300, 10)));
    removeOld();
    expect(registry.resolve("home:ui:lab-pc")).toMatchObject({ status: "visible", rect: { x: 300 } });
  });
});

describe("classification", () => {
  const viewport = { width: 1000, height: 600 };

  it("visible when inside the viewport", () => {
    expect(classifyRect(box(100, 100), viewport)).toEqual({ status: "visible", rect: box(100, 100) });
  });

  it("offscreen when below, above or beside the viewport", () => {
    expect(classifyRect(box(100, 900), viewport).status).toBe("offscreen");
    expect(classifyRect(box(100, -200), viewport).status).toBe("offscreen");
    expect(classifyRect(box(1200, 100), viewport).status).toBe("offscreen");
  });

  it("offscreen when less than half of it shows, visible when more than half shows", () => {
    expect(classifyRect(box(100, 590, 100, 40), viewport).status).toBe("offscreen");
    expect(classifyRect(box(100, 570, 100, 40), viewport).status).toBe("visible");
  });

  it("a target larger than the viewport is visible once it fills half of it", () => {
    expect(classifyRect(box(0, 100, 1000, 5000), viewport).status).toBe("visible");
    expect(classifyRect(box(0, 500, 1000, 5000), viewport).status).toBe("offscreen");
  });

  it("hidden when not rendered, zero-sized or not finite", () => {
    expect(classifyRect(null, viewport)).toEqual({ status: "hidden" });
    expect(classifyRect(box(10, 10, 0, 0), viewport)).toEqual({ status: "hidden" });
    expect(classifyRect(box(Number.NaN, 10), viewport)).toEqual({ status: "hidden" });
  });

  it("a source that throws is treated as hidden", () => {
    const { registry } = setup();
    registry.register({ id: "pc:port:mb-atx24", kind: "port" }, { getRect: () => { throw new Error("detached"); } });
    expect(registry.resolve("pc:port:mb-atx24")).toEqual({ status: "hidden" });
  });
});

describe("re-resolution", () => {
  it("resolve reads the current rectangle after a scroll", () => {
    const { registry, at, page } = setup();
    registry.register({ id: "home:ui:projects-link", kind: "ui" }, at(box(100, 1500)));
    expect(registry.resolve("home:ui:projects-link").status).toBe("offscreen");
    page.scrollY = 1300;
    expect(registry.resolve("home:ui:projects-link")).toEqual({ status: "visible", rect: box(100, 200) });
  });

  it("subscribers hear the new rectangle after a scroll, once per frame", () => {
    const { registry, at, page, runFrame, pending } = setup();
    registry.register({ id: "home:ui:lab-pc", kind: "ui" }, at(box(100, 300)));
    const seen: TargetResolution[] = [];
    registry.subscribe("home:ui:lab-pc", (resolution) => seen.push(resolution));
    expect(seen).toEqual([{ status: "visible", rect: box(100, 300) }]);

    page.scrollY = 50;
    registry.invalidate();
    page.scrollY = 120;
    registry.invalidate();
    registry.invalidate();
    expect(pending).toHaveLength(1);
    expect(seen).toHaveLength(1);
    runFrame();
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual({ status: "visible", rect: box(100, 180) });
  });

  it("subscribers are not called when nothing moved", () => {
    const { registry, at, runFrame } = setup();
    registry.register({ id: "home:ui:lab-pc", kind: "ui" }, at(box(100, 300)));
    const listener = vi.fn();
    registry.subscribe("home:ui:lab-pc", listener);
    registry.invalidate();
    runFrame();
    registry.invalidate();
    runFrame();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("a resize that pushes the target out of the viewport reports offscreen", () => {
    const { registry, at, page, runFrame } = setup();
    registry.register({ id: "home:ui:projects-link", kind: "ui" }, at(box(800, 300)));
    const seen: string[] = [];
    registry.subscribe("home:ui:projects-link", (resolution) => seen.push(resolution.status));
    page.width = 375;
    registry.invalidate();
    runFrame();
    expect(seen).toEqual(["visible", "offscreen"]);
  });

  it("a direction change that moves the target reports the mirrored rectangle", () => {
    const { registry, at, runFrame } = setup();
    const source = at(box(40, 20));
    registry.register({ id: "shell:ui:nav-pc", kind: "ui" }, source);
    const seen: TargetResolution[] = [];
    registry.subscribe("shell:ui:nav-pc", (resolution) => seen.push(resolution));
    source.doc = box(1000 - 40 - 100, 20);
    registry.invalidate();
    runFrame();
    expect(seen.at(-1)).toEqual({ status: "visible", rect: box(860, 20) });
  });

  it("subscribers hear unknown on unregister and the rectangle again on register", () => {
    const { registry, at } = setup();
    const seen: string[] = [];
    registry.subscribe("pc:connector:cpu-eps8", (resolution) => seen.push(resolution.status));
    const unregister = registry.register({ id: "pc:connector:cpu-eps8", kind: "connector" }, at(box(10, 10)));
    unregister();
    expect(seen).toEqual(["unknown", "visible", "unknown"]);
  });

  it("an unsubscribed listener is not called and layout listeners run on every flush", () => {
    const { registry, at, page, runFrame } = setup();
    registry.register({ id: "home:ui:lab-pc", kind: "ui" }, at(box(100, 300)));
    const listener = vi.fn();
    const layout = vi.fn();
    const unsubscribe = registry.subscribe("home:ui:lab-pc", listener);
    registry.subscribeLayout(layout);
    expect(registry.subscriptionCount()).toBe(1);
    unsubscribe();
    expect(registry.subscriptionCount()).toBe(0);
    page.scrollY = 80;
    registry.invalidate();
    runFrame();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(layout).toHaveBeenCalledTimes(1);
  });
});

describe("other targets", () => {
  it("rectsInView lists the other targets that are on screen, not the excepted one, hidden ones or ones scrolled away", () => {
    const { registry, at } = setup();
    registry.register({ id: "home:ui:lab-pc", kind: "ui" }, at(box(100, 300)));
    registry.register({ id: "home:ui:lab-network", kind: "ui" }, at(box(300, 300)));
    registry.register({ id: "home:ui:projects-link", kind: "ui" }, at(box(500, 580)));
    registry.register({ id: "shell:ui:nav-pc", kind: "ui" }, at(box(100, 2000)));
    registry.register({ id: "pc:setting:xmp", kind: "setting" }, at(null));
    expect(registry.rectsInView("home:ui:lab-pc")).toEqual([box(300, 300), box(500, 580)]);
    expect(registry.rectsInView()).toHaveLength(3);
  });
});

describe("reveal", () => {
  it("scrolls an offscreen target into view and subscribers then see it visible", () => {
    const { registry, at, runFrame } = setup();
    const source = at(box(100, 2000));
    registry.register({ id: "home:ui:projects-link", kind: "ui" }, source);
    const seen: string[] = [];
    registry.subscribe("home:ui:projects-link", (resolution) => seen.push(resolution.status));
    expect(registry.reveal("home:ui:projects-link", { reducedMotion: true })).toBe(true);
    runFrame();
    expect(source.revealed).toBe(1);
    expect(seen).toEqual(["offscreen", "visible"]);
  });

  it("passes the reduced-motion choice to the source", () => {
    const { registry } = setup();
    const reveal = vi.fn();
    registry.register({ id: "home:ui:projects-link", kind: "ui" }, { getRect: () => box(0, 2000), reveal });
    registry.reveal("home:ui:projects-link", { reducedMotion: true });
    expect(reveal).toHaveBeenCalledWith({ reducedMotion: true });
  });

  it("refuses an unknown target and a hidden target", () => {
    const { registry, at } = setup();
    const hidden = at(null);
    registry.register({ id: "pc:setting:xmp", kind: "setting" }, hidden);
    expect(registry.reveal("pc:setting:missing", { reducedMotion: false })).toBe(false);
    expect(registry.reveal("pc:setting:xmp", { reducedMotion: false })).toBe(false);
    expect(hidden.revealed).toBe(0);
  });
});

describe("stale guidance", () => {
  it("isGuidanceStale compares projectRevision and executionId only when the guidance carries them", () => {
    expect(isGuidanceStale({ id: "shell:ui:nav-pc", kind: "ui" }, { projectRevision: 9 })).toBe(false);
    expect(isGuidanceStale({ id: "pc:port:mb-atx24", kind: "port", projectRevision: 4 }, { projectRevision: 4 })).toBe(false);
    expect(isGuidanceStale({ id: "pc:port:mb-atx24", kind: "port", projectRevision: 4 }, { projectRevision: 5 })).toBe(true);
    expect(isGuidanceStale({ id: "pc:port:mb-atx24", kind: "port", projectRevision: 4 }, {})).toBe(true);
    expect(isGuidanceStale({ id: "pc:port:motherboard-2/eps-1", kind: "port", executionId: "run-1" }, { executionId: "run-2" })).toBe(true);
  });

  it("checkGuidance accepts current guidance and returns its resolution", () => {
    const { registry, at } = setup();
    registry.register({ id: "pc:port:mb-atx24", kind: "port" }, at(box(10, 10)));
    const check = registry.checkGuidance(
      { id: "pc:port:mb-atx24", kind: "port", projectRevision: 4, executionId: "run-1" },
      { projectRevision: 4, executionId: "run-1" },
    );
    expect(check).toEqual({ ok: true, resolution: { status: "visible", rect: box(10, 10) } });
  });

  it("checkGuidance rejects guidance from an older revision or another execution", () => {
    const { registry, at } = setup();
    registry.register({ id: "pc:port:mb-atx24", kind: "port" }, at(box(10, 10)));
    expect(registry.checkGuidance({ id: "pc:port:mb-atx24", kind: "port", projectRevision: 4 }, { projectRevision: 5 })).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(
      registry.checkGuidance({ id: "pc:port:mb-atx24", kind: "port", executionId: "run-1" }, { projectRevision: 5, executionId: "run-2" }),
    ).toEqual({ ok: false, reason: "stale" });
  });

  it("checkGuidance rejects malformed IDs, unregistered IDs and a wrong kind", () => {
    const { registry, at } = setup();
    registry.register({ id: "pc:port:mb-atx24", kind: "port" }, at(box(10, 10)));
    expect(registry.checkGuidance({ id: "document.body", kind: "ui" })).toEqual({ ok: false, reason: "invalid_id" });
    expect(registry.checkGuidance({ id: "pc:port:gpu-12v", kind: "port" })).toEqual({ ok: false, reason: "unknown" });
    expect(registry.checkGuidance({ id: "pc:port:mb-atx24", kind: "connector" })).toEqual({ ok: false, reason: "kind_mismatch" });
  });
});

describe("two registrations of one target (the list row and the 3D view)", () => {
  it("the newest answers while it can be shown; when it is hidden the older one answers and is revealed", () => {
    const { registry, at } = setup();
    const row = at(box(40, 1400));
    const scene = at(box(500, 200));
    registry.register({ id: "pc:port:storage-6/sata-data", kind: "port" }, row);
    registry.register({ id: "pc:port:storage-6/sata-data", kind: "port" }, scene);
    expect(registry.resolve("pc:port:storage-6/sata-data")).toEqual({ status: "visible", rect: box(500, 200) });

    // The 3D port is now behind the case wall: hidden there, so the list row answers.
    scene.doc = null;
    expect(registry.resolve("pc:port:storage-6/sata-data").status).toBe("offscreen");
    expect(registry.reveal("pc:port:storage-6/sata-data", { reducedMotion: true })).toBe(true);
    expect([row.revealed, scene.revealed]).toEqual([1, 0]);
    expect(registry.resolve("pc:port:storage-6/sata-data").status).toBe("visible");

    // Both hidden: hidden, as before.
    row.doc = null;
    expect(registry.resolve("pc:port:storage-6/sata-data").status).toBe("hidden");
  });
});
