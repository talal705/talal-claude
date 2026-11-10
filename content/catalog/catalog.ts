// The assembled PC lab catalog. Kept apart from index.ts so presets.ts can import it without a cycle.
import type { CatalogEntry, PCAction, PCCatalog } from "@ytl/contracts";
import { accessories } from "./accessories";
import { assetFor } from "./assets";
import { cases } from "./cases";
import { cooling } from "./cooling";
import { cpus } from "./cpus";
import { fans } from "./fans";
import { gpus } from "./gpus";
import { motherboards } from "./motherboards";
import { psus } from "./psus";
import { ram } from "./ram";
import { storage } from "./storage";

/**
 * Entries no longer offered to learners (owner decisions 10 and 11, 2026-10-27: two options per category,
 * no monitor or display cable). They stay in the catalog, unchanged, so saved builds that use them still
 * replay and open; the lab never lists them for adding and says when a build still contains one.
 */
export const ARCHIVED_CATALOG_IDS: ReadonlySet<string> = new Set([
  "intel-core-i9-14900k",
  "amd-ryzen-5-5600",
  "asus-tuf-gaming-b550-plus",
  "asus-rog-strix-rtx4090-o24g-gaming",
  "asus-dual-rtx3060-o12g-v2",
  "asus-tuf-rtx5090-o32g-gaming",
  "corsair-rm850x-shift",
  "generic-low-profile-air-cooler",
  // Every board now supplies its own SATA data cables.
  "generic-sata-data-cable",
  "generic-hdmi-cable",
  "generic-displayport-cable",
  "generic-monitor",
]);

export const pcCatalog: PCCatalog = {
  version: "2026.10.31-1",
  // Each data file starts every entry with "no asset"; the generated visuals are attached here.
  entries: [...cases, ...motherboards, ...cpus, ...ram, ...gpus, ...psus, ...storage, ...fans, ...cooling, ...accessories].map((e) => ({ ...e, asset: assetFor(e.id) })),
};

/**
 * Parts that come fitted in a case, by case: which fan entry, and the case's fan positions they arrive in.
 * They are ordinary parts once in the build (selectable, removable, movable); they are never offered on
 * their own. Positions: the North's page says "2x Aspect 14 PWM (front)"; the 4000D's page does not say.
 */
export const SUPPLIED_PARTS: Readonly<Record<string, readonly { catalogId: string; mountPointId: string }[]>> = {
  "corsair-4000d-airflow-black": [
    { catalogId: "corsair-airguide-120-4000d", mountPointId: "fan-front-1" },
    { catalogId: "corsair-airguide-120-4000d", mountPointId: "fan-front-2" },
  ],
  "fractal-north-charcoal-black-mesh": [
    { catalogId: "fractal-aspect-14-pwm-north", mountPointId: "fan-front-1" },
    { catalogId: "fractal-aspect-14-pwm-north", mountPointId: "fan-front-2" },
  ],
};
const SUPPLIED_IDS = new Set(Object.values(SUPPLIED_PARTS).flatMap((list) => list.map((item) => item.catalogId)));

/** Every entry the picker never lists: archived ones and the parts that only come fitted in a case. */
export const NOT_OFFERED_IDS: ReadonlySet<string> = new Set([...ARCHIVED_CATALOG_IDS, ...SUPPLIED_IDS]);

/** True when the lab offers the entry for adding to a build. */
export const isOffered = (catalogId: string): boolean => !ARCHIVED_CATALOG_IDS.has(catalogId) && !SUPPLIED_IDS.has(catalogId) && pcCatalog.entries.some((e) => e.id === catalogId);

/** The entries learners can choose from, in catalog order. */
export const offeredEntries: readonly CatalogEntry[] = pcCatalog.entries.filter((e) => isOffered(e.id));

/**
 * The steps that bring a case's fitted parts into a build, as the factory delivers them: each added, mounted
 * in its position, pushed home and screwed in. `caseInstanceId` is the case already in the build and
 * `nextSerial` the build's counter, so the instance IDs the engine will assign are known.
 */
export function suppliedPartActions(caseCatalogId: string, caseInstanceId: string, nextSerial: number): { actions: PCAction[]; instanceIds: string[] } {
  const actions: PCAction[] = [];
  const instanceIds: string[] = [];
  let serial = nextSerial;
  const caseEntry = pcCatalog.entries.find((e) => e.id === caseCatalogId);
  for (const item of SUPPLIED_PARTS[caseCatalogId] ?? []) {
    const entry = pcCatalog.entries.find((e) => e.id === item.catalogId);
    if (!entry) continue;
    const instanceId = `${entry.category}-${serial++}`;
    const fasteners = caseEntry?.mountPoints.find((m) => m.id === item.mountPointId)?.fastener?.count ?? 0;
    actions.push({ type: "add_part", catalogId: item.catalogId });
    actions.push({ type: "mount_part", instanceId, target: { hostInstanceId: caseInstanceId, mountPointId: item.mountPointId } });
    actions.push({ type: "set_seating", instanceId, seating: "seated" });
    if (fasteners > 0) actions.push({ type: "set_fasteners", instanceId, secured: fasteners });
    instanceIds.push(instanceId);
  }
  return { actions, instanceIds };
}
