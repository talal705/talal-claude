"use client";

import { useEffect, useState } from "react";
import { parseGeometry, type PartGeometry } from "./geometry";
import { withVisualDetails } from "./visual-details";

const BASE = "/assets/";

interface Manifest {
  assets: { catalogId: string; geometry: string }[];
}

let manifest: Promise<Map<string, string>> | null = null;
// One request per part for the whole visit; `null` records a part with no usable geometry.
const loaded = new Map<string, Promise<PartGeometry | null>>();

/** Which parts have a geometry file. Read once; a failure counts as "none" and is retried on the next visit. */
function loadManifest(): Promise<Map<string, string>> {
  manifest ??= fetch(`${BASE}pc/manifest.json`)
    .then((response) => (response.ok ? (response.json() as Promise<Manifest>) : { assets: [] }))
    .then((data) => new Map(data.assets.map((asset) => [asset.catalogId, asset.geometry])))
    .catch(() => {
      manifest = null;
      return new Map<string, string>();
    });
  return manifest;
}

function loadGeometry(catalogId: string): Promise<PartGeometry | null> {
  let request = loaded.get(catalogId);
  if (!request) {
    request = loadManifest()
      .then(async (paths) => {
        const path = paths.get(catalogId);
        if (!path) return null;
        const response = await fetch(BASE + path);
        if (!response.ok) return null;
        const parsed = parseGeometry(await response.json(), catalogId);
        if (!parsed.ok) console.warn(`geometry for ${catalogId} was not used: ${parsed.problem}`, parsed.detail ?? "");
        return parsed.ok ? withVisualDetails(parsed.geometry) : null;
      })
      .catch(() => null);
    loaded.set(catalogId, request);
  }
  return request;
}

/**
 * Geometry for the parts in the build, loaded one file per part as each part appears (the whole
 * catalog is never downloaded). Parts still loading, or without a file, are simply absent from
 * the map and are drawn as a labelled outline.
 */
export function useGeometry(catalogIds: readonly string[]): { geometry: ReadonlyMap<string, PartGeometry>; ready: boolean } {
  const [geometry, setGeometry] = useState<ReadonlyMap<string, PartGeometry>>(() => new Map());
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const key = [...new Set(catalogIds)].sort().join("|");

  useEffect(() => {
    let current = true;
    const ids = key === "" ? [] : key.split("|");
    void Promise.all(ids.map(async (id) => [id, await loadGeometry(id)] as const)).then((entries) => {
      if (!current) return;
      setGeometry(new Map(entries.filter((entry): entry is readonly [string, PartGeometry] => entry[1] !== null)));
      setLoadedKey(key);
    });
    return () => {
      current = false;
    };
  }, [key]);

  return { geometry, ready: loadedKey === key };
}
