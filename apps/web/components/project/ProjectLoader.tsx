"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import type { LabMode } from "@ytl/contracts";
import { WarningIcon } from "../icons";
import { labHref, type EntryChoice, type ActiveLab } from "../labs";
import { SessionProvider, useStoreValue, type SessionStore } from "./context";

/**
 * Opens the project named in the URL in the lab's store and renders the workspace once it is
 * ready, or says plainly why it cannot. Also keeps the address in step with the project's mode and
 * saves when the page is hidden, closed or left.
 */
export function ProjectLoader({
  store,
  lab,
  projectId,
  mode,
  start,
  lessonId = null,
  children,
}: {
  store: SessionStore;
  lab: ActiveLab;
  projectId: string;
  mode: LabMode;
  start: EntryChoice | null;
  /** Kept in the address when the mode is corrected. */
  lessonId?: string | null;
  children: ReactNode;
}) {
  const t = useTranslations("project.load");
  const tc = useTranslations("common");
  const router = useRouter();
  const phase = useStoreValue(store, (state) => state.phase);
  const openId = useStoreValue(store, (state) => state.projectId);
  const recordMode = useStoreValue(store, (state) => state.mode);
  const current = openId === projectId;

  useEffect(() => {
    void store.getState().open(projectId);
  }, [store, projectId]);

  // The mode belongs to the project; the address follows it.
  useEffect(() => {
    if (current && phase === "ready" && recordMode !== mode) {
      router.replace(labHref(lab, { start, mode: recordMode, project: projectId, lesson: lessonId }), { scroll: false });
    }
  }, [current, phase, recordMode, mode, start, lab, projectId, lessonId, router]);

  // Closing, reloading or hiding the page: start a save, and keep a copy that survives if it cannot finish.
  // Leaving the workspace inside the site (unmount) saves too.
  useEffect(() => {
    const flush = () => {
      store.getState().writeDraft();
      void store.getState().saveNow();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      void store.getState().saveNow();
    };
  }, [store]);

  if (!current || phase === "idle" || phase === "loading") {
    return (
      <p className="state-panel" role="status">
        <span className="spinner" aria-hidden="true" />
        {t("loading")}
      </p>
    );
  }

  if (phase !== "ready") {
    return (
      <div className="state-panel state-panel-block" role="alert">
        <h2 id="workspace-heading" tabIndex={-1} className="section-heading state-heading">
          <WarningIcon />
          {t(`${phase}.heading`)}
        </h2>
        <p>{t(`${phase}.body`)}</p>
        <div className="button-row">
          {(phase === "unavailable" || phase === "error") && (
            <button type="button" className="button button-primary" onClick={() => void store.getState().open(projectId)}>
              {tc("retry")}
            </button>
          )}
          <Link href={labHref(lab, { start, mode })} className="button">
            {t("startNew")}
          </Link>
          {/* Archived projects are listed under all labs, not under this one. */}
          <Link href={phase === "archived" ? "/projects" : `/projects?lab=${lab}`} className="button">
            {t("allProjects")}
          </Link>
        </div>
      </div>
    );
  }

  return <SessionProvider value={store}>{children}</SessionProvider>;
}
