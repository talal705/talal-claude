"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { LabMode } from "@ytl/contracts";
import { InfoIcon, WarningIcon } from "../icons";
import { labHref, type EntryChoice } from "../labs";
import { LessonList } from "../lesson/LessonList";
import { ContinueProjects } from "../project/ContinueProjects";
import { TITLE_MAX_LENGTH } from "../project/session";
import { createNetworkProject } from "./network-client";
import { network } from "@ytl/simulation";
import type { Lesson, LessonMode } from "@ytl/curriculum";
import { NETWORK_PRESETS, newNetworkProjectData } from "./network-model";

/** Name and starting point for a new network. Creating leads into the workspace. */
/** A network project at a lesson's starting state: its actions replayed by the engine on an empty network. */
export async function createLessonProject(lesson: Lesson, mode: LessonMode, title: string): Promise<string> {
  if (lesson.start.lab !== "network") throw new Error(`${lesson.id} is not a network lesson`);
  const replayed = network.replay(lesson.start.actions);
  if (replayed.rejection) throw new Error(`${lesson.id} does not replay`);
  const record = await createNetworkProject({ title, mode, data: { state: replayed.state, log: [...lesson.start.actions] } });
  return record.id;
}

export function NetworkStarter({ mode, start }: { mode: LabMode; start: EntryChoice | null }) {
  const t = useTranslations("netLab.starter");
  const ts = useTranslations("labPage");
  const router = useRouter();
  const locale = useLocale() as "en" | "ar";
  const [name, setName] = useState("");
  // "" is the empty table; otherwise the ID of a ready network.
  const [presetId, setPresetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tooLong = name.length > TITLE_MAX_LENGTH;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy || tooLong) return;
    setBusy(true);
    setError("");
    try {
      const preset = NETWORK_PRESETS.find((item) => item.id === presetId);
      const data = newNetworkProjectData(preset);
      if (!data) {
        setError(t("presetFailed"));
        setBusy(false);
        return;
      }
      const record = await createNetworkProject({ title: name.trim() || t("defaultTitle"), mode, data });
      router.push(labHref("network", { start, mode, project: record.id }));
    } catch (problem) {
      setError((problem as { code?: unknown } | null)?.code === "unavailable" ? t("unavailable") : t("createFailed"));
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="workspace-heading" className="panel studio-starter">
      <h2 id="workspace-heading" tabIndex={-1} className="section-heading">
        <span className="step-number">{ts(start === "guided" ? "steps.create3" : start === "direct" ? "steps.create2" : "steps.next")}</span>
        {t("heading")}
      </h2>
      <p className="step-cue">{ts(mode === "free" ? "steps.action.network" : "steps.actionLesson")}</p>
      {mode !== "free" ? (
        // Learn and Test Yourself are lessons, not the free workspace.
        <LessonList lab="network" mode={mode} start={start} createProject={createLessonProject} />
      ) : (
        <>
      <ContinueProjects lab="network" />
      <p className="lab-status-empty">{t("viewNote")}</p>
      <p className="notice">
        <InfoIcon />
        <span>{t("simNote")}</span>
      </p>

      <form onSubmit={(event) => void create(event)} className="studio-form">
        <div className="field">
          <label htmlFor="network-name">{t("titleLabel")}</label>
          <input
            id="network-name"
            className="input"
            dir="auto"
            autoComplete="off"
            value={name}
            placeholder={t("defaultTitle")}
            aria-describedby="network-name-hint"
            aria-invalid={tooLong}
            onChange={(event) => setName(event.target.value)}
          />
          <p id="network-name-hint" className="settings-hint">
            {tooLong ? t("titleTooLong") : t("titleHint")}
          </p>
        </div>

        <fieldset className="settings-group">
          <legend>{t("startLegend")}</legend>
          <label className="settings-option">
            <input type="radio" name="network-start" value="" checked={presetId === ""} onChange={() => setPresetId("")} />
            <span>
              {t("startEmpty")}
              <span className="settings-hint">{t("startEmptyHint")}</span>
            </span>
          </label>
          {NETWORK_PRESETS.map((preset) => (
            <label key={preset.id} className="settings-option">
              <input type="radio" name="network-start" value={preset.id} checked={presetId === preset.id} onChange={() => setPresetId(preset.id)} />
              <span>
                {preset.title[locale]}
                <span className="settings-hint">{preset.description[locale]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {error && (
          <p className="notice notice-danger" role="alert">
            <WarningIcon />
            <span>{error}</span>
          </p>
        )}
        <div className="button-row">
          <button type="submit" className="button button-primary" disabled={busy || tooLong}>
            {busy ? t("creating") : t("create")}
          </button>
        </div>
      </form>
        </>
      )}
    </section>
  );
}
