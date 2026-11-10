"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { LabMode, RgbPreference } from "@ytl/contracts";
import { WarningIcon } from "../icons";
import { labHref, type EntryChoice } from "../labs";
import { LessonList } from "../lesson/LessonList";
import { ContinueProjects } from "../project/ContinueProjects";
import { TITLE_MAX_LENGTH } from "../project/session";
import { pcCatalog, pcStarterKits } from "./catalog";
import { createPCProject } from "./pc-client";
import { kitProjectData } from "./pc-store";
import { importBuild } from "./pc-transfer";
import { pc } from "@ytl/simulation";
import type { Lesson, LessonMode } from "@ytl/curriculum";

const PREFERENCES = [
  { value: "with_rgb", key: "withRgb" },
  { value: "without_rgb", key: "withoutRgb" },
] as const satisfies readonly { value: RgbPreference; key: string }[];

/** Name and lighting preference for a new build. Creating leads into the workspace. */
/** A PC project at a lesson's starting state: its actions replayed by the engine on an empty build. */
export async function createLessonProject(lesson: Lesson, mode: LessonMode, title: string): Promise<string> {
  if (lesson.start.lab !== "pc") throw new Error(`${lesson.id} is not a PC lesson`);
  const replayed = pc.replay(lesson.start.actions, pcCatalog);
  if (!replayed.clean) throw new Error(`${lesson.id} does not replay under the current catalog`);
  const record = await createPCProject({ title, mode, data: { state: replayed.state, log: [...lesson.start.actions] } });
  return record.id;
}

export function PcStarter({ mode, start }: { mode: LabMode; start: EntryChoice | null }) {
  const t = useTranslations("pcLab.starter");
  const ts = useTranslations("labPage");
  const router = useRouter();
  const [name, setName] = useState("");
  const [rgbPreference, setRgbPreference] = useState<RgbPreference>("with_rgb");
  const locale = useLocale() as "en" | "ar";
  // "" is the empty workbench; otherwise the ID of a starter kit, whose parts arrive on the bench.
  const [presetId, setPresetId] = useState(pcStarterKits[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);

  const failure = (problem: unknown) => ((problem as { code?: unknown } | null)?.code === "unavailable" ? t("unavailable") : t("createFailed"));

  async function importFile(file: File | undefined, input: HTMLInputElement) {
    if (!file || busy || importing) return;
    setImporting(true);
    setImportError("");
    try {
      let text: string;
      try {
        text = await file.text();
      } catch {
        setImportError(t("importProblems.read_failed"));
        return;
      }
      const result = importBuild(text, pcCatalog);
      if (!result.ok) {
        // For a refused step, the engine's own sentence follows ours.
        setImportError(`${t(`importProblems.${result.problem}`)}${result.reason ? ` ${result.reason[locale]}` : ""}`);
        return;
      }
      try {
        const record = await createPCProject({ title: result.title, mode: result.mode, data: result.data });
        router.push(labHref("pc", { start, mode: result.mode, project: record.id }));
      } catch (problem) {
        setImportError(failure(problem));
      }
    } finally {
      input.value = "";
      setImporting(false);
    }
  }
  const tooLong = name.length > TITLE_MAX_LENGTH;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy || importing || tooLong) return;
    setBusy(true);
    setError("");
    try {
      const preset = pcStarterKits.find((item) => item.id === presetId);
      const data = preset ? kitProjectData(preset, pcCatalog) : null;
      if (preset && !data) {
        setError(t("kitFailed"));
        setBusy(false);
        return;
      }
      const title = name.trim() || (preset ? preset.title[locale] : t("defaultTitle"));
      const record = await createPCProject(data ? { title, mode, data } : { title, mode, rgbPreference });
      router.push(labHref("pc", { start, mode, project: record.id }));
    } catch (problem) {
      setError(failure(problem));
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="workspace-heading" className="panel studio-starter">
      <h2 id="workspace-heading" tabIndex={-1} className="section-heading">
        <span className="step-number">{ts(start === "guided" ? "steps.create3" : start === "direct" ? "steps.create2" : "steps.next")}</span>
        {t("heading")}
      </h2>
      <p className="step-cue">{ts(mode === "free" ? "steps.action.pc" : "steps.actionLesson")}</p>
      {mode !== "free" ? (
        // Learn and Test Yourself are lessons, not the free workspace.
        <LessonList lab="pc" mode={mode} start={start} createProject={createLessonProject} />
      ) : (
        <>
      <ContinueProjects lab="pc" />
      <p className="lab-status-empty">{t("viewNote")}</p>

      <form onSubmit={(event) => void create(event)} className="studio-form">
        <div className="field">
          <label htmlFor="build-name">{t("titleLabel")}</label>
          <input
            id="build-name"
            className="input"
            dir="auto"
            autoComplete="off"
            value={name}
            placeholder={t("defaultTitle")}
            aria-describedby="build-name-hint"
            aria-invalid={tooLong}
            onChange={(event) => setName(event.target.value)}
          />
          <p id="build-name-hint" className="settings-hint">
            {tooLong ? t("titleTooLong") : t("titleHint")}
          </p>
        </div>

        <fieldset className="settings-group">
          <legend>{t("startLegend")}</legend>
          {pcStarterKits.map((preset) => (
            <label key={preset.id} className="settings-option">
              <input type="radio" name="build-start" value={preset.id} checked={presetId === preset.id} onChange={() => setPresetId(preset.id)} />
              <span>
                {preset.title[locale]}
                <span className="settings-hint">{preset.description[locale]}</span>
              </span>
            </label>
          ))}
          <label className="settings-option">
            <input type="radio" name="build-start" value="" checked={presetId === ""} onChange={() => setPresetId("")} />
            <span>
              {t("startEmpty")}
              <span className="settings-hint">{t("startEmptyHint")}</span>
            </span>
          </label>
          {presetId !== "" && <p className="settings-hint">{t("kitHint")}</p>}
        </fieldset>

        {/* A starter kit brings its own lighting choice; it can be changed in the workspace. */}
        <fieldset className="settings-group" hidden={presetId !== ""} disabled={presetId !== ""}>
          <legend>{t("lightingLegend")}</legend>
          {PREFERENCES.map((item) => (
            <label key={item.value} className="settings-option">
              <input
                type="radio"
                name="rgb-preference"
                value={item.value}
                checked={rgbPreference === item.value}
                onChange={() => setRgbPreference(item.value)}
              />
              <span>
                {t(item.key)}
                <span className="settings-hint">{t(`${item.key}Hint`)}</span>
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
          <button type="submit" className="button button-primary" disabled={busy || importing || tooLong}>
            {busy ? t("creating") : t("create")}
          </button>
        </div>
      </form>

      <div className="studio-import">
        <h3 className="subheading">{t("importHeading")}</h3>
        <div className="field">
          <label htmlFor="build-import">{t("importLabel")}</label>
          <input
            id="build-import"
            type="file"
            accept=".json,application/json"
            className="input"
            disabled={busy || importing}
            aria-describedby="build-import-hint"
            onChange={(event) => void importFile(event.target.files?.[0], event.target)}
          />
          <p id="build-import-hint" className="settings-hint">
            {importing ? t("importing") : t("importHint")}
          </p>
        </div>
        {importError && (
          <p className="notice notice-danger" role="alert">
            <WarningIcon />
            <span>{importError}</span>
          </p>
        )}
      </div>
        </>
      )}
    </section>
  );
}
