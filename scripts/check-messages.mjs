// Fails when EN and AR message files differ in keys, or when modules collide on a top-level key.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../apps/web/messages/", import.meta.url));
const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

let failed = false;
const owners = {};
for (const file of readdirSync(join(root, "en"))) {
  const en = JSON.parse(readFileSync(join(root, "en", file), "utf8"));
  const ar = JSON.parse(readFileSync(join(root, "ar", file), "utf8"));
  const enKeys = new Set(flatten(en));
  const arKeys = new Set(flatten(ar));
  for (const k of enKeys) if (!arKeys.has(k)) (failed = true), console.error(`${file}: missing in ar: ${k}`);
  for (const k of arKeys) if (!enKeys.has(k)) (failed = true), console.error(`${file}: missing in en: ${k}`);
  for (const top of Object.keys(en)) {
    if (owners[top]) (failed = true), console.error(`top-level key "${top}" in both ${owners[top]} and ${file}`);
    owners[top] = file;
  }
}
if (failed) process.exit(1);
console.log("messages: en/ar keys match, no module collisions");
