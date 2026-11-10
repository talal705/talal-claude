"use client";

// The controls that change one part, shared by the list view's part card and the 3D view's
// selection panel, so both offer exactly the same engine actions. Nothing here decides what is
// allowed: every button runs one PCAction and the engine accepts or refuses it.
import { useLocale, useTranslations } from "next-intl";
import type { PCAction, PCDiagnostic, PartLightingState } from "@ytl/contracts";
import type { PartRow } from "./pc-model";

type Locale = "en" | "ar";

/** Runs an action; on success announces `done` and moves focus to the element registered under `focusKey`. */
export type Run = (action: PCAction, done: string, focusKey: string) => void;

/** Wraps a product name or printed label in left-to-right isolate marks, so it reads correctly inside an Arabic sentence. */
export const ltr = (text: string) => `\u2066${text}\u2069`;

const LIGHT_COLORS = ["#00e5ff", "#ffffff", "#ff0033", "#00ff66", "#0066ff", "#a855f7"];
const LIGHT_EFFECTS = ["static", "breathing", "rainbow"] as const satisfies readonly PartLightingState["effect"][];

/** Where each mounted role sits, how far it is seated and secured, and the buttons that change that or take it out. */
export function AttachmentControls({ row, run, focusKey, nameSuffix = "" }: { row: PartRow; run: Run; focusKey: string; /** Appended to every accessible name, so a second copy of these controls (the 3D panel) is told apart. */ nameSuffix?: string }) {
  const t = useTranslations("pcLab");
  const locale = useLocale() as Locale;
  const { part, name } = row;
  const id = part.instanceId;
  // The visible words first, then the part, so voice control and button lists both work.
  const named = (label: string) => `${label}: ${name}${nameSuffix}`;
  return (
    <ul className="pc-facts">
      {row.attachments.map(({ attachment, roleLabel, hostName, mountLabel, fastenersTotal }) => {
        const role = attachment.role;
        return (
          <li key={role} className="pc-attachment">
            <p>
              {t("build.location", { role: roleLabel[locale], mount: mountLabel[locale], host: ltr(hostName) })}
            </p>
            <p>
              {t("build.seatingLabel")}: <strong>{t(`build.seating.${attachment.seating}`)}</strong>
            </p>
            <p>{fastenersTotal > 0 ? t("build.fasteners", { secured: attachment.fastenersSecured, total: fastenersTotal }) : t("build.noFasteners")}</p>
            <div className="button-row">
              {attachment.seating === "placed" && (
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => run({ type: "set_seating", instanceId: id, role, seating: "partial" }, t("build.done.partial", { name }), focusKey)}
                  aria-label={named(t("build.seatPartly"))}
                >
                  {t("build.seatPartly")}
                </button>
              )}
              {attachment.seating !== "seated" && (
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => run({ type: "set_seating", instanceId: id, role, seating: "seated" }, t("build.done.seat", { name }), focusKey)}
                  aria-label={named(t("build.seat"))}
                >
                  {t("build.seat")}
                </button>
              )}
              {attachment.seating !== "placed" && (
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => run({ type: "set_seating", instanceId: id, role, seating: "placed" }, t("build.done.unseat", { name }), focusKey)}
                  aria-label={named(t("build.unseat"))}
                >
                  {t("build.unseat")}
                </button>
              )}
              {/* One at a time where the position has several fasteners, as the engine counts them. */}
              {fastenersTotal > 1 && attachment.fastenersSecured < fastenersTotal && (
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => run({ type: "set_fasteners", instanceId: id, role, secured: attachment.fastenersSecured + 1 }, t("build.done.secure", { name }), focusKey)}
                  aria-label={named(t("build.secureOne"))}
                >
                  {t("build.secureOne")}
                </button>
              )}
              {fastenersTotal > 0 && attachment.fastenersSecured < fastenersTotal && (
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => run({ type: "set_fasteners", instanceId: id, role, secured: fastenersTotal }, t("build.done.secure", { name }), focusKey)}
                  aria-label={named(fastenersTotal > 1 ? t("build.secureAll") : t("build.secure"))}
                >
                  {fastenersTotal > 1 ? t("build.secureAll") : t("build.secure")}
                </button>
              )}
              {fastenersTotal > 1 && attachment.fastenersSecured > 0 && (
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => run({ type: "set_fasteners", instanceId: id, role, secured: attachment.fastenersSecured - 1 }, t("build.done.loosen", { name }), focusKey)}
                  aria-label={named(t("build.loosenOne"))}
                >
                  {t("build.loosenOne")}
                </button>
              )}
              {attachment.fastenersSecured > 0 && (
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => run({ type: "set_fasteners", instanceId: id, role, secured: 0 }, t("build.done.loosen", { name }), focusKey)}
                  aria-label={named(fastenersTotal > 1 ? t("build.loosenAll") : t("build.loosen"))}
                >
                  {fastenersTotal > 1 ? t("build.loosenAll") : t("build.loosen")}
                </button>
              )}
              <button
                type="button"
                className="button button-small"
                onClick={() => run({ type: "unmount_part", instanceId: id, role }, t("build.done.unmount", { name }), focusKey)}
                aria-label={named(t("build.unmount"))}
              >
                {t("build.unmount")}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** BIOS version, operating system on a drive, and lighting: settings of the part itself. */
export function PartSettings({
  row,
  run,
  focusKey,
  lightingProblem,
  idPrefix,
  nameSuffix = "",
}: {
  row: PartRow;
  run: Run;
  focusKey: string;
  /** The engine's finding that this part's lighting is not connected, when there is one. */
  lightingProblem: PCDiagnostic | undefined;
  /** Keeps element IDs unique when the same part's controls are on the page twice. */
  idPrefix: string;
  /** Appended (hidden from sight) to every label, so a second copy of these controls is told apart by name. */
  nameSuffix?: string;
}) {
  const t = useTranslations("pcLab");
  const locale = useLocale() as Locale;
  const { part, entry } = row;
  const id = part.instanceId;
  return (
    <>
      {entry.category === "motherboard" && (
        <div className="field">
          <label htmlFor={`${idPrefix}-bios-${id}`}>{t("build.bios")}{nameSuffix && <span className="visually-hidden">{nameSuffix}</span>}</label>
          <select
            id={`${idPrefix}-bios-${id}`}
            className="input code-name"
            dir="ltr"
            value={part.biosVersion ?? entry.spec.factoryBiosVersion}
            onChange={(event) => run({ type: "update_bios", instanceId: id, version: event.target.value }, t("build.done.bios"), focusKey)}
          >
            {entry.spec.biosVersions.map((bios) => (
              <option key={bios.version} value={bios.version}>
                {bios.releasedOn ? `${bios.version} (${bios.releasedOn})` : bios.version}
              </option>
            ))}
          </select>
        </div>
      )}
      {entry.category === "storage" && (
        <label className="settings-option">
          <input
            type="checkbox"
            checked={part.bootable ?? false}
            onChange={(event) => run({ type: "set_storage_bootable", instanceId: id, bootable: event.target.checked }, t("build.done.bootable"), focusKey)}
          />
          <span>{t("build.bootable")}{nameSuffix && <span className="visually-hidden">{nameSuffix}</span>}</span>
        </label>
      )}
      {part.lighting && (
        <div className="pc-lighting">
          <label className="settings-option">
            <input
              type="checkbox"
              checked={part.lighting.enabled}
              onChange={(event) =>
                run({ type: "set_part_lighting", instanceId: id, lighting: { enabled: event.target.checked } }, t("build.done.lighting"), focusKey)
              }
            />
            <span>{t("build.lightingOn")}{nameSuffix && <span className="visually-hidden">{nameSuffix}</span>}</span>
          </label>
          {lightingProblem ? (
            // Colour and effect mean nothing until the lighting lead is connected; the engine's sentence says what is missing.
            <p className="state-meta">
              {t("build.lightingBlocked")} {lightingProblem.message[locale]}
            </p>
          ) : (
            <>
              <div className="field">
                <label htmlFor={`${idPrefix}-light-color-${id}`}>{t("build.lightingColor")}{nameSuffix && <span className="visually-hidden">{nameSuffix}</span>}</label>
                <select
                  id={`${idPrefix}-light-color-${id}`}
                  className="input"
                  value={part.lighting.color.toLowerCase()}
                  onChange={(event) => run({ type: "set_part_lighting", instanceId: id, lighting: { color: event.target.value } }, t("build.done.lighting"), focusKey)}
                >
                  {!LIGHT_COLORS.includes(part.lighting.color.toLowerCase()) && <option value={part.lighting.color.toLowerCase()}>{part.lighting.color}</option>}
                  {LIGHT_COLORS.map((color) => (
                    <option key={color} value={color}>
                      {t(`build.colors.${color}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`${idPrefix}-light-effect-${id}`}>{t("build.lightingEffect")}{nameSuffix && <span className="visually-hidden">{nameSuffix}</span>}</label>
                <select
                  id={`${idPrefix}-light-effect-${id}`}
                  className="input"
                  value={part.lighting.effect}
                  onChange={(event) =>
                    run(
                      { type: "set_part_lighting", instanceId: id, lighting: { effect: event.target.value as PartLightingState["effect"] } },
                      t("build.done.lighting"),
                      focusKey,
                    )
                  }
                >
                  {LIGHT_EFFECTS.map((effect) => (
                    <option key={effect} value={effect}>
                      {t(`build.effects.${effect}`)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
