"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { usePreferences, type PreferencesPatch } from "@/lib/interaction";
import { useTutorTarget } from "@/lib/targets";
import { AvatarPicker } from "./AvatarPicker";
import { WarningIcon } from "./icons";

const MOTION_OPTIONS = ["system", "on", "off"] as const;

/** Header button plus the settings dialog it opens. Changes apply at once and are stored on this device. */
export function SettingsDialog() {
  const t = useTranslations();
  const { preferences, ready, error, update } = usePreferences();
  const [changed, setChanged] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useTutorTarget<HTMLButtonElement>("shell:ui:nav-settings", "ui");

  // The learner's own motion setting goes on <html>; globals.css reads it. Absent means "follow the device".
  useEffect(() => {
    const root = document.documentElement;
    if (preferences.reducedMotion === "system") root.removeAttribute("data-reduced-motion");
    else root.setAttribute("data-reduced-motion", preferences.reducedMotion);
  }, [preferences.reducedMotion]);

  async function change(patch: PreferencesPatch) {
    setChanged(false);
    await update(patch);
    setChanged(true);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="locale-switch"
        aria-haspopup="dialog"
        onClick={() => {
          setChanged(false);
          dialogRef.current?.showModal();
        }}
      >
        {t("nav.settings")}
      </button>

      <dialog ref={dialogRef} className="dialog" aria-labelledby="settings-heading">
        <h2 id="settings-heading" className="section-heading">
          {t("settings.title")}
        </h2>

        {!ready && (
          <p className="settings-status" role="status">
            {t("settings.loading")}
          </p>
        )}

        <fieldset className="settings-group" disabled={!ready}>
          <legend>{t("settings.motion.legend")}</legend>
          {MOTION_OPTIONS.map((option) => (
            <label key={option} className="settings-option">
              <input
                type="radio"
                name="reduced-motion"
                value={option}
                checked={preferences.reducedMotion === option}
                onChange={() => void change({ reducedMotion: option })}
              />
              <span>{t(`settings.motion.${option}`)}</span>
            </label>
          ))}
        </fieldset>

        <label className="settings-option">
          <input
            type="checkbox"
            disabled={!ready}
            checked={preferences.soundEnabled}
            onChange={(event) => void change({ soundEnabled: event.target.checked })}
          />
          <span>
            {t("settings.sound.label")}
            <span className="settings-hint">{t("settings.sound.hint")}</span>
          </span>
        </label>

        <label className="settings-option">
          <input
            type="checkbox"
            disabled={!ready}
            checked={preferences.robotVisible}
            onChange={(event) => void change({ robotVisible: event.target.checked })}
          />
          <span>
            {t("settings.robot.label")}
            <span className="settings-hint">{t("settings.robot.hint")}</span>
          </span>
        </label>

        <fieldset className="settings-group" disabled={!ready}>
          <legend>{t("settings.frameRate.legend")}</legend>
          {([60, 30] as const).map((rate) => (
            <label key={rate} className="settings-option">
              <input
                type="radio"
                name="robot-frame-rate"
                value={rate}
                checked={preferences.robotFrameRate === rate}
                onChange={() => void change({ robotFrameRate: rate })}
              />
              <span>
                {t(`settings.frameRate.fps${rate}`)}
                {rate === 30 && <span className="settings-hint">{t("settings.frameRate.hint")}</span>}
              </span>
            </label>
          ))}
        </fieldset>

        <AvatarPicker
          name="settings-avatar"
          value={preferences.avatar}
          disabled={!ready}
          onChange={(avatar) => void change({ avatar })}
        />

        <div className="settings-status" role="status">
          {error ? (
            <p className="notice notice-danger">
              <WarningIcon />
              <span>{t("settings.notSaved")}</span>
            </p>
          ) : (
            changed && <p>{t("settings.saved")}</p>
          )}
        </div>

        <div className="button-row">
          <button type="button" className="button" onClick={() => dialogRef.current?.close()}>
            {t("common.close")}
          </button>
        </div>
      </dialog>
    </>
  );
}
