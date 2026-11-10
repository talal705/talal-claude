"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LabMode } from "@ytl/contracts";
import { pc } from "@ytl/simulation";
import { useStore } from "zustand";
import { tutor } from "@/lib/interaction";
import { lessonActive } from "../lesson/lesson-active";
import { renderAnnouncement } from "@/lib/interaction/assembly";
import { InfoIcon, WarningIcon } from "../icons";
import { labHref, type EntryChoice } from "../labs";
import { ProjectBar } from "../project/ProjectBar";
import { ProjectLoader } from "../project/ProjectLoader";
import { BuildView } from "./BuildView";
import { ARCHIVED_CATALOG_IDS, entryName, pcCatalog } from "./catalog";
import { PartPicker } from "./PartPicker";
import { pcStore, usePC } from "./pc-client";
import { exportFileName } from "../project/file-name";
import { archivedInBuild, catalogDrift } from "./pc-model";
import { exportBuild } from "./pc-transfer";
import { PowerPanel } from "./PowerPanel";
import { Scene3D } from "./scene/Scene3D";
import { LessonSlot } from "./PcLesson";

/** Reads out what the selection machine reports. Always mounted, so screen readers keep watching it. */
function AssemblyAnnouncer() {
  const t = useTranslations("tutor.assembly.announce");
  const locale = useLocale() as "en" | "ar";
  const announcement = usePC((state) => state.assembly.announcement);
  const text = announcement ? renderAnnouncement(announcement, locale, (key, values) => t(key, values)) : "";
  const assertive = announcement?.politeness === "assertive";
  return (
    <>
      <p className="visually-hidden" aria-live="polite" data-testid="assembly-live-polite">
        {assertive ? "" : text}
      </p>
      <p className="visually-hidden" aria-live="assertive" data-testid="assembly-live-assertive">
        {assertive ? text : ""}
      </p>
    </>
  );
}

function PcView({ closeHref, lessonId }: { closeHref: string; lessonId: string | null }) {
  const t = useTranslations();
  const locale = useLocale() as "en" | "ar";
  const present = usePC((state) => state.history?.present);
  const revision = usePC((state) => state.revision);
  const projectId = usePC((state) => state.projectId);
  const refusal = usePC((state) => state.refusal);
  const canUndo = usePC((state) => state.canUndo);
  const canRedo = usePC((state) => state.canRedo);
  const [announcement, setAnnouncement] = useState("");
  const announce = useCallback((text: string) => setAnnouncement(text), []);
  // One ID per press of the power button: guidance about an earlier press is dropped when it changes.
  const [pressId, setPressId] = useState<string | null>(null);

  const diagnostics = useMemo(() => (present ? pc.diagnoseBuild(present, pcCatalog, { projectRevision: revision }) : []), [present, revision]);
  const startup = useMemo(
    () => (present ? pc.evaluateStartup(present, pcCatalog, { projectRevision: revision, executionId: present.power.pressed ? (pressId ?? undefined) : undefined }) : null),
    [present, revision, pressId],
  );
  // Checked once per opened build, against the data as it was stored.
  const drift = useMemo(() => {
    const { data } = pcStore.getState();
    return data ? catalogDrift(data, pcCatalog) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Parts the lab no longer offers (decision 10); the build keeps them and says so.
  const archived = useMemo(() => (present ? archivedInBuild(present, pcCatalog, ARCHIVED_CATALOG_IDS) : []), [present]);

  // Every change gives the tutor the engine's current findings; a refusal is the freshest of them.
  const lessonOpen = useStore(lessonActive, (state) => state.open);
  useEffect(() => {
    if (!present || !startup || lessonOpen) return;
    void tutor.presentGuidance({
      lab: "pc",
      context: { projectRevision: revision, executionId: present.power.pressed ? (pressId ?? undefined) : undefined },
      evidence: [
        { kind: "pc-diagnostics", diagnostics: refusal ? [refusal.diagnostic, ...diagnostics] : diagnostics },
        ...(present.power.pressed ? [{ kind: "pc-startup" as const, result: startup }] : []),
      ],
    });
  }, [present, revision, pressId, refusal, diagnostics, startup, lessonOpen]);

  useEffect(() => () => tutor.clearGuidance(), [projectId]);

  function download() {
    const { title, mode, data } = pcStore.getState();
    if (!data) return;
    const name = exportFileName(title, "pc-build");
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportBuild(title, mode, data, new Date()), null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    announce(t("pcLab.bar.exported", { name }));
  }

  if (!present || !startup) return null;
  const send = pcStore.getState().send;

  return (
    <section aria-labelledby="workspace-heading" className="studio">
      <h2 id="workspace-heading" tabIndex={-1} className="visually-hidden">
        {t("project.bar.heading")}
      </h2>
      <ProjectBar closeHref={closeHref} announce={announce} onExport={download}>
        <button type="button" className="button button-small" disabled={!canUndo} onClick={() => send({ type: "undo" })}>
          {t("pcLab.bar.undo")}
        </button>
        <button type="button" className="button button-small" disabled={!canRedo} onClick={() => send({ type: "redo" })}>
          {t("pcLab.bar.redo")}
        </button>
        <button type="button" className="button button-small" onClick={download}>
          {t("pcLab.bar.export")}
        </button>
      </ProjectBar>

      {drift && (
        <div className="state-panel state-panel-block state-panel-warning">
          <h3 className="subheading state-heading">
            <WarningIcon />
            {t("pcLab.drift.heading")}
          </h3>
          <p>{t("pcLab.drift.body")}</p>
          <p>{drift.message[locale]}</p>
        </div>
      )}

      {archived.length > 0 && (
        <div className="state-panel state-panel-block state-panel-warning">
          <h3 className="subheading state-heading">
            <InfoIcon />
            {t("pcLab.archived.heading", { count: archived.length })}
          </h3>
          <p>{t("pcLab.archived.body")}</p>
          <ul className="pc-facts">
            {archived.map((entry) => (
              <li key={entry.id}>
                <bdi dir="ltr">{entryName(entry)}</bdi> ({t(`pcLab.categories.${entry.category}`)})
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="lab-status-empty">{t("pcLab.starter.viewNote")}</p>

      <LessonSlot lessonId={lessonId} />

      <Scene3D state={present} startup={startup} diagnostics={diagnostics} announce={announce} onPress={() => setPressId(crypto.randomUUID())} />

      <div className="studio-grid pc-grid">
        <PartPicker announce={announce} />
        <BuildView diagnostics={diagnostics} announce={announce} />
        <PowerPanel startup={startup} diagnostics={diagnostics} announce={announce} onPress={() => setPressId(crypto.randomUUID())} />
      </div>

      <p className="visually-hidden" role="status">
        {announcement}
      </p>
      <AssemblyAnnouncer />
    </section>
  );
}

/** The PC lab workspace (list view) for the build named in the URL. */
export function PcWorkspace({ projectId, mode, start, lessonId }: { projectId: string; mode: LabMode; start: EntryChoice | null; lessonId: string | null }) {
  return (
    <ProjectLoader store={pcStore} lab="pc" projectId={projectId} mode={mode} start={start} lessonId={lessonId}>
      <PcView closeHref={labHref("pc", { start, mode })} lessonId={lessonId} />
    </ProjectLoader>
  );
}
