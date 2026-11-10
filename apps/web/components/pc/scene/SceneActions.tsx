"use client";

// Everything the engine can do to a build, offered for what is selected in the 3D view: the same
// controls as the list view's cards (shared from part-controls), plus the switches outside the
// build. The list stays in step because both views act on the one store. Each action's result is
// shown here as a green check or a red X; a red X opens one hint at a time.
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { pcTarget, type PCAction, type PCDiagnostic } from "@ytl/contracts";
import { pc } from "@ytl/simulation";
import { CheckIcon, CrossIcon } from "../../icons";
import { pcCatalog } from "../catalog";
import { pcStore, usePC } from "../pc-client";
import { AttachmentControls, PartSettings, type Run } from "../part-controls";
import { buildRows, type CableRow } from "../pc-model";
import { sceneStore, useScene } from "./scene-store";

type Locale = "en" | "ar";

/** The last change, as the engine answered it. */
type Result = { ok: true; text: string; n: number } | { ok: false; diagnostic: PCDiagnostic; n: number };

function ResultLine({ result }: { result: Result | null }) {
  const t = useTranslations("pcLab.sceneActions");
  const locale = useLocale() as Locale;
  const [level, setLevel] = useState(1);
  useEffect(() => setLevel(1), [result?.n]);
  if (!result) return null;
  if (result.ok) {
    return (
      <p className="notice notice-success pc-scene-result" role="status">
        <CheckIcon />
        <span>{t("done", { text: result.text })}</span>
      </p>
    );
  }
  const { diagnostic } = result;
  return (
    <div className="notice notice-danger pc-scene-result" role="alert">
      <CrossIcon />
      <div>
        <p>{t("refused")}</p>
        {/* One hint at a time: what is wrong, then the rule behind it. */}
        <p>{diagnostic.message[locale]}</p>
        {level >= 2 && <p>{diagnostic.explanation[locale]}</p>}
        {level < 2 && (
          <button type="button" className="button button-small" onClick={() => setLevel(2)}>
            {t("why")}
          </button>
        )}
      </div>
    </div>
  );
}

function CableEnds({ row, run, focusKey, suffix }: { row: CableRow; run: Run; focusKey: string; suffix: string }) {
  const t = useTranslations("pcLab.build");
  const locale = useLocale() as Locale;
  const { cable } = row;
  const label = row.label[locale];
  return (
    <li className="pc-attachment">
      <p>
        <strong>{label}</strong>
      </p>
      <ul className="pc-facts">
        {row.ends.map((end) => (
          <li key={end.spec.id} className="pc-port">
            <span>
              {end.label[locale]} · <bdi dir="ltr">{pc.CONNECTOR_NAME[end.spec.connector]}</bdi>
            </span>
            {end.pluggedInto ? (
              <button
                type="button"
                className="button button-small"
                aria-label={`${t("disconnectNamed", { end: end.label[locale], cable: label })}${suffix}`}
                onClick={() => run({ type: "disconnect_cable_end", cableId: cable.id, endId: end.spec.id }, t("done.disconnect"), focusKey)}
              >
                {t("disconnect")}
              </button>
            ) : (
              <button
                type="button"
                className="button button-small button-primary"
                aria-label={`${t("connectNamed", { end: end.label[locale], cable: label })}${suffix}`}
                onClick={() => {
                  // The ports it can go to light up in the picture, as when the end is clicked there.
                  sceneStore.setState({ pickInScene: true });
                  pcStore.getState().selectCableEnd(cable.id, end.spec.id);
                }}
              >
                {t("connect")}
              </button>
            )}
          </li>
        ))}
      </ul>
      <label className="settings-option">
        <input type="checkbox" checked={cable.tidied} onChange={(event) => run({ type: "set_cable_tidy", cableId: cable.id, tidied: event.target.checked }, t("done.tidy"), focusKey)} />
        <span>
          {t("tidy")}
          <span className="visually-hidden">
            {": "}
            {label}
            {suffix}
          </span>
        </span>
      </label>
      {!cable.ownerInstanceId && (
        <button type="button" className="button button-small button-danger" aria-label={`${t("removeCable")}: ${label}${suffix}`} onClick={() => run({ type: "remove_cable", cableId: cable.id }, t("done.removeCable"), focusKey)}>
          {t("removeCable")}
        </button>
      )}
    </li>
  );
}

export function SceneActions({ diagnostics, announce, onPress }: { diagnostics: readonly PCDiagnostic[]; announce: (text: string) => void; onPress: () => void }) {
  const t = useTranslations("pcLab");
  const ts = useTranslations("pcLab.sceneActions");
  const present = usePC((state) => state.history?.present);
  const refusal = usePC((state) => state.refusal);
  const selectedId = useScene((state) => state.selectedPartId);
  const selectedEnd = useScene((state) => state.selectedCableEnd);
  const rows = useMemo(() => (present ? buildRows(present, pcCatalog) : null), [present]);
  const heading = useRef<HTMLHeadingElement>(null);
  const [result, setResult] = useState<Result | null>(null);
  const counter = useRef(0);

  // A refusal from anywhere (a place clicked in the picture, a button here or in the list) is shown as a red X.
  useEffect(() => {
    if (refusal) setResult({ ok: false, diagnostic: refusal.diagnostic, n: (counter.current += 1) });
  }, [refusal]);

  if (!present || !rows) return null;
  const act = pcStore.getState().act;

  const run: Run = (action: PCAction, done: string) => {
    const outcome = act(action);
    if (!outcome?.ok) return;
    announce(done);
    setResult({ ok: true, text: done, n: (counter.current += 1) });
    // The button may be gone now (a seated part has no "push in"); the panel keeps focus.
    if (!document.activeElement || document.activeElement === document.body) heading.current?.focus();
  };

  const partRow = rows.parts.find((row) => row.part.instanceId === selectedId);
  // The cables that belong to the selected part or end at it; for a selected cable end, its own cable.
  const cableRows = selectedEnd
    ? rows.cables.filter((row) => row.cable.id === selectedEnd.slice(0, selectedEnd.lastIndexOf("/")))
    : partRow
      ? rows.cables.filter(
          (row) =>
            row.cable.ownerInstanceId === partRow.part.instanceId ||
            Object.values(row.cable.ends).some((to) => to?.kind === "part" && to.instanceId === partRow.part.instanceId),
        )
      : [];
  const lightingProblem = partRow
    ? diagnostics.find((item) => item.code === "lighting_not_connected" && item.relatedTargets.some((target) => target.id === pcTarget.part(partRow.part.instanceId).id))
    : undefined;
  const { power } = present;
  // Every control here also exists in the list or the power panel; this suffix keeps the names apart.
  const suffix = ts("inScene");
  const hidden = <span className="visually-hidden">{suffix}</span>;

  return (
    <section aria-labelledby="scene-actions-heading" className="panel pc-scene-actions">
      <h4 id="scene-actions-heading" ref={heading} tabIndex={-1} className="subheading">
        {ts("heading")}
      </h4>
      <ResultLine result={result} />

      {!partRow && cableRows.length === 0 && <p className="state-meta">{ts("none")}</p>}

      {partRow && (
        <div className="pc-scene-selection">
          <p>
            <strong>
              <bdi dir="ltr">{partRow.name}</bdi>
            </strong>{" "}
            <span className="pc-tag">{t(`categories.${partRow.entry.category}`)}</span>
          </p>
          {partRow.attachments.length === 0 && partRow.entry.mounting.length > 0 && <p className="state-meta">{t("build.onBench")}</p>}
          {partRow.attachments.length > 0 && <AttachmentControls row={partRow} run={run} focusKey="scene" nameSuffix={suffix} />}
          <PartSettings row={partRow} run={run} focusKey="scene" lightingProblem={lightingProblem} idPrefix="scene" nameSuffix={suffix} />
          <div className="button-row">
            {partRow.canPlace && (
              <button
                type="button"
                className="button button-small button-primary"
                aria-label={`${t("build.place")} ${partRow.name}${suffix}`}
                onClick={() => {
                  sceneStore.setState({ pickInScene: true });
                  pcStore.getState().selectPart(partRow.part.instanceId);
                }}
              >
                {t("build.place")}
              </button>
            )}
            <button
              type="button"
              className="button button-small button-danger"
              aria-label={`${t("build.remove")}: ${partRow.name}${suffix}`}
              onClick={() => {
                const name = partRow.name;
                run({ type: "remove_part", instanceId: partRow.part.instanceId }, t("build.done.remove", { name }), "scene");
                sceneStore.setState({ selectedPartId: null });
              }}
            >
              {t("build.remove")}
            </button>
          </div>
        </div>
      )}

      {cableRows.length > 0 && (
        <>
          <h5 className="output-label">{ts("cables")}</h5>
          <ul className="pc-facts">
            {cableRows.map((row) => (
              <CableEnds key={row.cable.id} row={row} run={run} focusKey="scene" suffix={suffix} />
            ))}
          </ul>
        </>
      )}

      <h5 className="output-label">{ts("switches")}</h5>
      <div className="pc-scene-switches">
        <label className="settings-option">
          <input type="checkbox" checked={present.sidePanelOpen} onChange={(event) => run({ type: "set_side_panel", open: event.target.checked }, t("build.done.panel"), "scene")} />
          <span>
            {t("power.sidePanel")}
            {hidden}
          </span>
        </label>
        <label className="settings-option">
          <input type="checkbox" checked={power.wallConnected} onChange={(event) => run({ type: "set_wall_power", connected: event.target.checked }, ts("doneWall"), "scene")} />
          <span>
            {t("power.wall")}
            {hidden}
          </span>
        </label>
        <label className="settings-option">
          <input type="checkbox" checked={power.psuSwitchOn} onChange={(event) => run({ type: "set_psu_switch", on: event.target.checked }, ts("donePsu"), "scene")} />
          <span>
            {t("power.psuSwitch")}
            {hidden}
          </span>
        </label>
        <div className="button-row">
          <button
            type="button"
            className="button button-small button-primary"
            disabled={power.pressed}
            onClick={() => {
              if (act({ type: "press_power" })?.ok) {
                onPress();
                announce(t("power.pressed"));
                setResult({ ok: true, text: t("power.pressed"), n: (counter.current += 1) });
              }
            }}
          >
            {t("power.press")}
            {hidden}
          </button>
          <button type="button" className="button button-small" disabled={!power.pressed} onClick={() => run({ type: "power_off" }, ts("doneOff"), "scene")}>
            {t("power.off")}
            {hidden}
          </button>
        </div>
      </div>
    </section>
  );
}
