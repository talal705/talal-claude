"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { networkTarget, type NetworkAction, type NetworkCableCategory, type NetworkCableEndId } from "@ytl/contracts";
import { network } from "@ytl/simulation";
import { renderAnnouncement } from "@/lib/interaction/selection";
import { TargetBox } from "../pc/TargetBox";
import { SelectionList } from "../project/SelectionList";
import { useHighlighted } from "./highlight";
import { networkStore, useNetwork } from "./network-client";
import type { CableEndRow, CableRow } from "./network-model";
import { PlugExercise } from "./PlugExercise";

const CATEGORIES = ["cat5e", "cat6", "cat6a"] as const satisfies readonly NetworkCableCategory[];
type Locale = "en" | "ar";
type Announce = (text: string) => void;
type PlugTarget = { cableId: string; endId: NetworkCableEndId } | "practice";

function CableEnd({
  row,
  end,
  register,
  onMakePlug,
  announce,
}: {
  row: CableRow;
  end: CableEndRow;
  register: (key: string) => (element: HTMLElement | null) => void;
  onMakePlug: () => void;
  announce: Announce;
}) {
  const t = useTranslations("netLab");
  const locale = useLocale() as Locale;
  const { cable, number } = row;
  const target = networkTarget.cableEnd(cable.id, end.endId);
  const highlighted = useHighlighted(target.id);
  const letter = end.endId.toUpperCase();
  const plug = cable.plugs?.[end.endId];
  const standard = plug ? network.matchStandard(plug.order) : null;

  return (
    <TargetBox as="li" target={target} className="pc-port" data-highlight={highlighted || undefined}>
      <span>
        <strong>{t("cables.end", { end: letter })}</strong>:{" "}
        {end.pluggedInto ? t("cables.pluggedInto", { device: end.pluggedInto.device[locale], port: `⁦${end.pluggedInto.portLabel}⁩` }) : t("cables.loose")}
      </span>
      {end.pluggedInto ? (
        <button
          type="button"
          className="button button-small"
          onClick={() => {
            if (networkStore.getState().act({ type: "disconnect_cable_end", cableId: cable.id, endId: end.endId })?.ok) announce(t("devices.unplugged"));
          }}
        >
          {t("cables.unplug")}
        </button>
      ) : (
        <button
          ref={register(`end:${cable.id}/${end.endId}`)}
          type="button"
          className="button button-small button-primary"
          aria-label={t("cables.connectNamed", { end: letter, number })}
          onClick={() =>
            networkStore.getState().selectCableEnd(cable.id, end.endId, {
              en: `Cable ${number}, end ${letter}`,
              ar: `الكيبل ${number}، الطرف ${letter}`,
            })
          }
        >
          {t("cables.connect")}
        </button>
      )}
      {cable.plugs && (
        <>
          <span className="state-meta">{!plug ? t("cables.plugNone") : standard ? t("cables.plugMade", { standard }) : t("cables.plugOther")}</span>
          <button type="button" className="button button-small" onClick={onMakePlug}>
            {plug ? t("cables.remakePlug") : t("cables.makePlug")}
          </button>
        </>
      )}
    </TargetBox>
  );
}

function CableCard({
  row,
  register,
  onMakePlug,
  announce,
}: {
  row: CableRow;
  register: (key: string) => (element: HTMLElement | null) => void;
  onMakePlug: (endId: NetworkCableEndId) => void;
  announce: Announce;
}) {
  const t = useTranslations("netLab");
  const locale = useLocale() as Locale;
  const { cable, number } = row;
  const target = networkTarget.cable(cable.id);
  const highlighted = useHighlighted(target.id);
  // A cable the learner terminated is tested end to end once both plugs exist.
  const wiremap = cable.plugs?.a && cable.plugs.b ? network.checkCable(cable) : null;

  return (
    <TargetBox as="li" target={target} className="pc-card" data-highlight={highlighted || undefined}>
      <h4 ref={register(`card:${cable.id}`)} tabIndex={-1} className="pc-card-name">
        {t("cables.name", { number })}
        <span className="pc-tag">{t(`medium.${cable.medium}`)}</span>
        {cable.medium === "rj45" && <span className="pc-tag">{cable.plugs ? t("cables.toTerminate") : t("cables.readyMade")}</span>}
        {cable.category && (
          <span className="pc-tag" dir="ltr">
            {cable.category}
          </span>
        )}
      </h4>
      <ul className="pc-facts">
        {row.ends.map((end) => (
          <CableEnd key={end.endId} row={row} end={end} register={register} onMakePlug={() => onMakePlug(end.endId)} announce={announce} />
        ))}
      </ul>
      {wiremap && (
        <>
          <p className={`notice${wiremap.passed ? " notice-success" : ""}`}>
            <span>
              <strong>{t("cables.wiremap")}:</strong> {wiremap.wiring && <>{t(`cables.wiring.${wiremap.wiring}`)}. </>}
              {wiremap.summary[locale]}
            </span>
          </p>
          {/* The per-pin result is the point of the exercise: every pin, in words. */}
          <ol className="pc-facts net-pins" aria-label={t("cables.pinsLabel")}>
            {wiremap.pins.map((pin) => (
              <li key={pin.pin} data-ok={pin.status === "ok"}>
                {pin.farPin === null ? t("cables.pinNowhere", { pin: pin.pin }) : t("cables.pinTo", { pin: pin.pin, far: pin.farPin })}: <strong>{t(`cables.pinStatus.${pin.status}`)}</strong>
                {pin.detail && <> — {pin.detail[locale]}</>}
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="button-row">
        <button
          type="button"
          className="button button-small button-danger"
          onClick={() => {
            if (!networkStore.getState().act({ type: "remove_cable", cableId: cable.id })?.ok) return;
            announce(t("cables.removed", { number }));
            document.getElementById("cables-heading")?.focus();
          }}
        >
          {t("cables.remove")}
        </button>
      </div>
    </TargetBox>
  );
}

/**
 * Cables: add one, connect an end by choosing it and then a port from the engine's list (ports
 * that cannot take it stay listed with the reason), unplug, and make the plugs of a cable you
 * terminate yourself. Nothing here needs dragging.
 */
export function CablePanel({ rows, announce }: { rows: CableRow[]; announce: Announce }) {
  const t = useTranslations("netLab");
  const tc = useTranslations("tutor.cabling.announce");
  const tl = useTranslations("tutor.assembly.list");
  const locale = useLocale() as Locale;
  const cabling = useNetwork((state) => state.cabling);
  const focus = useNetwork((state) => state.focus);
  const [category, setCategory] = useState<NetworkCableCategory>("cat6");
  const [plugTarget, setPlugTarget] = useState<PlugTarget | null>(null);
  const controls = useRef(new Map<string, HTMLElement>());
  const register = (key: string) => (element: HTMLElement | null) => {
    if (element) controls.current.set(key, element);
    else controls.current.delete(key);
  };

  // The machine hands focus back to the "Connect…" button the end was picked from; once the end is
  // plugged that button is gone, and the cable's card takes focus instead.
  useEffect(() => {
    if (focus?.to !== "subject") return;
    const { cableId, endId } = focus.subject;
    (controls.current.get(`end:${cableId}/${endId}`) ?? controls.current.get(`card:${cableId}`))?.focus();
  }, [focus]);

  function add(action: NetworkAction) {
    const result = networkStore.getState().act(action);
    if (result?.ok) announce(t("cables.added", { number: result.state.cables.length }));
  }

  const announcement = cabling.announcement ? renderAnnouncement(cabling.announcement, locale, (key, values) => tc(key, values)) : "";
  const assertive = cabling.announcement?.politeness === "assertive";
  const plugCable = plugTarget && plugTarget !== "practice" ? rows.find((row) => row.cable.id === plugTarget.cableId) : undefined;

  return (
    <section aria-labelledby="cables-heading" className="studio-editor net-cables">
      <h3 id="cables-heading" tabIndex={-1} className="subheading">
        {t("cables.heading")}
      </h3>
      <div className="button-row">
        <button type="button" className="button button-small" onClick={() => add({ type: "add_cable", medium: "rj45" })}>
          {t("cables.addPatch")}
        </button>
        <button type="button" className="button button-small" onClick={() => add({ type: "add_cable", medium: "fiber" })}>
          {t("cables.addFiber")}
        </button>
        <button type="button" className="button button-small" onClick={() => add({ type: "add_cable", medium: "rj45", category, terminated: true })}>
          {t("cables.addTerminated")}
        </button>
        <button type="button" className="button button-small" onClick={() => setPlugTarget("practice")}>
          {t("plug.open")}
        </button>
      </div>
      <div className="field">
        <label htmlFor="cable-category">{t("cables.category")}</label>
        <select id="cable-category" className="input" dir="ltr" value={category} onChange={(event) => setCategory(event.target.value as NetworkCableCategory)}>
          {CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <p className="settings-hint">{t("cables.categoryNote")}</p>
      </div>

      <SelectionList
        state={cabling}
        focus={focus}
        send={networkStore.getState().send}
        heading={(subject) => t("ports.heading", { subject })}
        keysHelp={tl("keys")}
        labels={{ available: tl("available"), unavailable: tl("unavailable"), cancel: t("ports.cancel"), placing: t("ports.placing") }}
      />

      {plugTarget && (
        <PlugExercise
          // A new exercise for each plug.
          key={plugTarget === "practice" ? "practice" : `${plugTarget.cableId}/${plugTarget.endId}`}
          cable={plugCable && plugTarget !== "practice" ? { id: plugCable.cable.id, number: plugCable.number, endId: plugTarget.endId } : undefined}
          startOrder={plugCable && plugTarget !== "practice" ? plugCable.cable.plugs?.[plugTarget.endId]?.order : undefined}
          announce={announce}
          onClose={() => {
            setPlugTarget(null);
            document.getElementById("cables-heading")?.focus();
          }}
        />
      )}

      {rows.length === 0 ? (
        <p className="lab-status-empty">{t("cables.empty")}</p>
      ) : (
        <ul className="pc-card-list" aria-labelledby="cables-heading">
          {rows.map((row) => (
            <CableCard key={row.cable.id} row={row} register={register} announce={announce} onMakePlug={(endId) => setPlugTarget({ cableId: row.cable.id, endId })} />
          ))}
        </ul>
      )}

      {/* Always mounted, so screen readers keep watching them. */}
      <p className="visually-hidden" aria-live="polite" data-testid="cabling-live-polite">
        {assertive ? "" : announcement}
      </p>
      <p className="visually-hidden" aria-live="assertive" data-testid="cabling-live-assertive">
        {assertive ? announcement : ""}
      </p>
    </section>
  );
}
