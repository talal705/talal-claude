// The one place the web app reaches the PC catalog data from.
import type { CatalogEntry } from "@ytl/contracts";
import { pc } from "@ytl/simulation";
import { ARCHIVED_CATALOG_IDS, NOT_OFFERED_IDS, isOffered, suppliedPartActions, offeredEntries, pcCatalog, pcPresets, pcStarterKits, type PCStarterKit } from "@ytl/catalog";

export { ARCHIVED_CATALOG_IDS, NOT_OFFERED_IDS, isOffered, suppliedPartActions, offeredEntries, pcCatalog, pcPresets, pcStarterKits, type PCStarterKit };

export const catalogIndex = pc.indexCatalog(pcCatalog);

/** Brand and model as printed; the same in both languages. */
export function entryName(entry: CatalogEntry): string {
  return `${entry.brand} ${entry.model}`;
}
