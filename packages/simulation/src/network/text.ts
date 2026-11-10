// Sentences the engine produces, in both languages. Arabic is plain and conversational.
// Port labels, addresses and names are values, not translated; they are isolated so they read
// left to right inside Arabic text.
import type { Localized, NetworkDevice, NetworkPortSpec, WireColor } from "@ytl/contracts";

export const L = (en: string, ar: string): Localized => ({ en, ar });

/** Wraps a technical value (address, port label, name) so it keeps its direction inside Arabic. */
export const ltr = (value: string | number): string => `⁨${value}⁩`;

export const WIRE_NAMES: Record<WireColor, Localized> = {
  "white-orange": L("white-orange", "الأبيض البرتقالي"),
  orange: L("orange", "البرتقالي"),
  "white-green": L("white-green", "الأبيض الأخضر"),
  blue: L("blue", "الأزرق"),
  "white-blue": L("white-blue", "الأبيض الأزرق"),
  green: L("green", "الأخضر"),
  "white-brown": L("white-brown", "الأبيض البني"),
  brown: L("brown", "البني"),
};

/** "Router 1, WAN" */
export function portLabel(device: NetworkDevice, port: NetworkPortSpec): Localized {
  return L(`${device.name.en}, ${port.label}`, `${device.name.ar}، ${ltr(port.label)}`);
}

/** Fills `{name}` placeholders in both languages with the same Localized or plain values. */
export function fill(template: Localized, values: Record<string, Localized | string | number>): Localized {
  const one = (text: string, locale: "en" | "ar") =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => {
      const value = values[key];
      if (value === undefined) return `{${key}}`;
      if (typeof value === "object") return value[locale];
      return locale === "ar" ? ltr(value) : String(value);
    });
  return { en: one(template.en, "en"), ar: one(template.ar, "ar") };
}
