"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { NetworkCableEndId, WireColor, WiringStandard } from "@ytl/contracts";
import { network } from "@ytl/simulation";
import { createPlugState, keyToPlugEvent, plugReducer, renderPlugAnnouncement, type PlugEvent, type PlugState } from "@/lib/interaction/network-cabling";
import { CheckIcon, WarningIcon } from "../icons";
import { networkStore } from "./network-client";
import { looseWireOrder } from "./network-model";

const STANDARDS = ["T568A", "T568B"] as const satisfies readonly WiringStandard[];

/**
 * Making one RJ45 plug: eight wires in eight positions, moved with the keyboard or with the
 * "move" buttons, a standard chosen, the plug crimped and tested. The engine judges the plug
 * (`checkPlug`); this component only carries the learner's arrangement to it. The row is never
 * mirrored: pin 1 is on the left in Arabic too.
 */
export function PlugExercise({
  cable,
  startOrder,
  onClose,
  announce,
}: {
  /** The cable end this plug goes on; absent for a practice plug. */
  cable?: { id: string; number: number; endId: NetworkCableEndId };
  startOrder?: readonly WireColor[];
  onClose: () => void;
  announce: (text: string) => void;
}) {
  const t = useTranslations("netLab.plug");
  const tp = useTranslations("tutor.cabling.plug");
  const locale = useLocale() as "en" | "ar";
  const loose = looseWireOrder(cable ? `${cable.id}/${cable.endId}` : undefined);
  const [plug, setPlug] = useState<PlugState>(() => createPlugState(startOrder ?? loose));
  // The reducer is driven from event handlers that may fire twice before a render; the ref is the truth.
  const current = useRef(plug);
  const wires = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState<{ index: number; n: number } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    if (focusIndex) wires.current[focusIndex.index]?.focus();
  }, [focusIndex]);

  function send(event: PlugEvent) {
    const step = plugReducer(current.current, event);
    current.current = step.state;
    setPlug(step.state);
    for (const effect of step.effects) {
      if (effect.type === "focus-position") {
        setFocusIndex((previous) => ({ index: effect.index, n: (previous?.n ?? 0) + 1 }));
      } else {
        const wiremap = network.checkPlug(effect.attempt);
        send({ type: "result", wiremap });
        // On a cable, the plug as made goes onto that end, whether or not it passed: that is the cable the learner built.
        if (cable) {
          const saved = networkStore.getState().act({ type: "set_plug", cableId: cable.id, endId: cable.endId, plug: { order: [...effect.attempt.order] } });
          announce(saved?.ok ? t("saved") : t("notSaved"));
        }
      }
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    const plugEvent = keyToPlugEvent(event);
    if (!plugEvent) return;
    event.preventDefault();
    send(plugEvent);
  }

  const grabbed = plug.grabbedFrom !== null;
  const locked = plug.phase !== "arranging";
  const live = plug.announcement ? renderPlugAnnouncement(plug.announcement, locale, (key, values) => tp(key, values)) : "";
  const assertive = plug.announcement?.politeness === "assertive";

  return (
    <section aria-labelledby="plug-heading" className="panel net-plug">
      <h4 id="plug-heading" ref={heading} tabIndex={-1} className="subheading">
        {t("heading")}
      </h4>
      <p className="state-meta">{cable ? t("forCable", { number: cable.number, end: cable.endId.toUpperCase() }) : t("practice")}</p>
      <p>{t("intro")}</p>
      <p className="settings-hint">{t("standardsNote")}</p>

      <fieldset className="settings-group">
        <legend>{tp("controls.standard")}</legend>
        <div className="option-row">
          {STANDARDS.map((standard) => (
            <label key={standard} className="settings-option">
              <input
                type="radio"
                name="plug-standard"
                value={standard}
                checked={plug.standard === standard}
                disabled={locked}
                onChange={() => send({ type: "choose-standard", standard })}
              />
              <span dir="ltr">{standard}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="settings-hint">{tp("controls.keys")}</p>
      <p className="settings-hint">{t("layoutNote")}</p>
      <ol className="net-wires" dir="ltr" aria-label={tp("controls.row")}>
        {plug.order.map((wire, index) => {
          const pin = plug.result?.pins[index];
          return (
            <li key={wire} className="net-wire" data-wire={wire} data-ok={pin ? pin.ok : undefined}>
              <span className="net-pin">{index + 1}</span>
              <button
                ref={(element) => {
                  wires.current[index] = element;
                }}
                type="button"
                className="net-wire-button"
                tabIndex={index === plug.activeIndex ? 0 : -1}
                aria-pressed={grabbed && index === plug.activeIndex}
                aria-label={`${tp("controls.position", { position: index + 1 })}: ${tp(`wire.${wire}`)}`}
                onFocus={() => {
                  if (index !== current.current.activeIndex) send({ type: "focus", index });
                }}
                // Keys belong to the wire itself, so the move buttons beside it keep their own Enter and Space.
                onKeyDown={onKeyDown}
                onClick={() => send({ type: "toggle-grab" })}
              >
                <span className="net-swatch" aria-hidden="true" />
                <span lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
                  {tp(`wire.${wire}`)}
                </span>
              </button>
              <span className="net-wire-moves">
                <button type="button" className="button button-small" disabled={locked || index === 0} aria-label={`${tp(`wire.${wire}`)}: ${tp("controls.moveLeft")}`} onClick={() => send({ type: "shift", index, direction: "left" })}>
                  <span aria-hidden="true">←</span>
                </button>
                <button
                  type="button"
                  className="button button-small"
                  disabled={locked || index === plug.order.length - 1}
                  aria-label={`${tp(`wire.${wire}`)}: ${tp("controls.moveRight")}`}
                  onClick={() => send({ type: "shift", index, direction: "right" })}
                >
                  <span aria-hidden="true">→</span>
                </button>
              </span>
              {pin && (
                <span className="net-pin-result" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
                  {pin.ok ? <CheckIcon /> : <WarningIcon />}
                  {tp(pin.ok ? "controls.pinOk" : "controls.pinWrong", { position: index + 1 })}
                  {pin.detail && <> {pin.detail[locale]}</>}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {plug.result && (
        <p className={`notice${plug.result.passed ? " notice-success" : ""}`}>
          {plug.result.passed ? <CheckIcon /> : <WarningIcon />}
          <span>
            <strong>{t("result")}:</strong> {plug.result.summary[locale]}
          </span>
        </p>
      )}

      <div className="button-row">
        <button type="button" className="button button-primary" disabled={locked} onClick={() => send({ type: "crimp" })}>
          {tp("controls.crimp")}
        </button>
        <button type="button" className="button" onClick={() => send({ type: "reset", order: loose })}>
          {tp("controls.reset")}
        </button>
        <button type="button" className="button" onClick={onClose}>
          {t("close")}
        </button>
      </div>

      <p className="visually-hidden" aria-live="polite">
        {assertive ? "" : live}
      </p>
      <p className="visually-hidden" aria-live="assertive">
        {assertive ? live : ""}
      </p>
    </section>
  );
}
