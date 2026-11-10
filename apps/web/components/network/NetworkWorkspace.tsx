"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LabMode } from "@ytl/contracts";
import { network } from "@ytl/simulation";
import { useStore } from "zustand";
import { tutor } from "@/lib/interaction";
import { lessonActive } from "../lesson/lesson-active";
import { InfoIcon, WarningIcon } from "../icons";
import { labHref, type EntryChoice } from "../labs";
import { ProjectBar } from "../project/ProjectBar";
import { ProjectLoader } from "../project/ProjectLoader";
import { LessonSlot } from "../lesson/LessonSlot";
import { lessonById } from "../lesson/lesson-catalog";
import { createLessonProject } from "./NetworkStarter";
import { CablePanel } from "./CablePanel";
import { DevicePanel } from "./DevicePanel";
import { networkStore, useNetwork } from "./network-client";
import { networkRows } from "./network-model";
import { TestPanel, runTest, type TestRun } from "./TestPanel";

function NetworkView({ closeHref, lessonId }: { closeHref: string; lessonId: string | null }) {
  const t = useTranslations();
  const locale = useLocale() as "en" | "ar";
  const net = useNetwork((state) => state.history?.present);
  const revision = useNetwork((state) => state.revision);
  const projectId = useNetwork((state) => state.projectId);
  const refusal = useNetwork((state) => state.refusal);
  const canUndo = useNetwork((state) => state.canUndo);
  const canRedo = useNetwork((state) => state.canRedo);
  const [announcement, setAnnouncement] = useState("");
  const announce = useCallback((text: string) => setAnnouncement(text), []);
  const [run, setRun] = useState<TestRun | null>(null);

  const rows = useMemo(() => (net ? networkRows(net) : null), [net]);
  const diagnostics = useMemo(() => (net ? network.diagnoseNetwork(net, { projectRevision: revision }) : []), [net, revision]);
  const interfaces = useMemo(() => (net ? network.resolveInterfaces(net, { projectRevision: revision }) : []), [net, revision]);
  // A test result speaks for the network it ran on; after a change only the standing check is current.
  const currentRun = run && run.state === net ? run : null;

  // Every change gives the tutor the engine's current findings; a refusal is the freshest of them.
  const lessonOpen = useStore(lessonActive, (state) => state.open);
  useEffect(() => {
    if (!net || lessonOpen) return;
    void tutor.presentGuidance({
      lab: "network",
      context: { projectRevision: revision, executionId: currentRun?.id },
      evidence: [
        { kind: "network-diagnostics", diagnostics: refusal ? [refusal.diagnostic, ...diagnostics] : diagnostics },
        ...(currentRun ? [{ kind: "network-connectivity" as const, result: currentRun.result }] : []),
      ],
    });
  }, [net, revision, refusal, diagnostics, currentRun, lessonOpen]);

  useEffect(
    () => () => {
      setRun(null);
      tutor.clearGuidance();
    },
    [projectId],
  );

  if (!net || !rows) return null;
  const send = networkStore.getState().send;

  return (
    <section aria-labelledby="workspace-heading" className="studio">
      <h2 id="workspace-heading" tabIndex={-1} className="visually-hidden">
        {t("project.bar.heading")}
      </h2>
      <ProjectBar closeHref={closeHref} announce={announce}>
        <button type="button" className="button button-small" disabled={!canUndo} onClick={() => send({ type: "undo" })}>
          {t("netLab.bar.undo")}
        </button>
        <button type="button" className="button button-small" disabled={!canRedo} onClick={() => send({ type: "redo" })}>
          {t("netLab.bar.redo")}
        </button>
      </ProjectBar>

      <p className="notice">
        <InfoIcon />
        <span>
          {t("netLab.starter.simNote")} {t("netLab.starter.viewNote")}
        </span>
      </p>

      {/* The checker gets the network exactly as the engine holds it now. */}
      <LessonSlot
        lab="network"
        lessonId={lessonId}
        store={networkStore}
        evidence={async () => ({ lab: "network", state: networkStore.getState().history!.present })}
        createProject={createLessonProject}
        proof={() => {
          const lesson = lessonById(lessonId ?? "");
          const log = networkStore.getState().data?.log ?? [];
          return lesson?.start.lab === "network" ? log.slice(lesson.start.actions.length) : log;
        }}
      />

      {refusal && (
        <div key={refusal.seq} className="state-panel state-panel-block state-panel-warning" role="alert">
          <h3 className="subheading state-heading">
            <WarningIcon />
            {t("netLab.refusal.heading")}
          </h3>
          <p>{refusal.diagnostic.message[locale]}</p>
          <details className="pc-details">
            <summary>{t("netLab.refusal.why")}</summary>
            <p>{refusal.diagnostic.explanation[locale]}</p>
            {refusal.diagnostic.evidence.length > 0 && (
              <>
                <h4 className="output-label">{t("netLab.refusal.evidence")}</h4>
                <ul className="pc-facts">
                  {refusal.diagnostic.evidence.map((item, index) => (
                    <li key={index}>
                      {item.label[locale]}: {t("netLab.refusal.observed")} <bdi dir="ltr">{item.observed}</bdi>
                      {item.expected !== undefined && (
                        <>
                          , {t("netLab.refusal.expected")} <bdi dir="ltr">{item.expected}</bdi>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </details>
        </div>
      )}

      <div className="studio-grid pc-grid">
        <DevicePanel rows={rows.devices} announce={announce} />
        <CablePanel rows={rows.cables} announce={announce} />
        <TestPanel net={net} run={run} diagnostics={diagnostics} interfaces={interfaces} onRun={(request) => setRun(runTest(net, request, revision))} />
      </div>

      <p className="visually-hidden" role="status">
        {announcement}
      </p>
    </section>
  );
}

/** The network lab workspace (list view) for the project named in the URL. */
export function NetworkWorkspace({ projectId, mode, start, lessonId }: { projectId: string; mode: LabMode; start: EntryChoice | null; lessonId: string | null }) {
  return (
    <ProjectLoader store={networkStore} lab="network" projectId={projectId} mode={mode} start={start} lessonId={lessonId}>
      <NetworkView closeHref={labHref("network", { start, mode })} lessonId={lessonId} />
    </ProjectLoader>
  );
}
