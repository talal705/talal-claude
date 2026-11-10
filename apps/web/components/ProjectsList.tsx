"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSnapshot, ProjectSummary } from "@ytl/contracts";
import { getGuestProjectStore } from "@/lib/storage";
import { InfoIcon, WarningIcon } from "./icons";
import { LABS, isLab, labHref, modeLabelKey, type ActiveLab } from "./labs";
import { exportArchived } from "./project/archive";
import { exportFileName } from "./project/file-name";

type State =
  | { status: "loading" }
  | { status: "ready"; projects: ProjectSummary[]; corruptIds: string[] }
  | { status: "unavailable" }
  | { status: "error" };

// Stores throw ProjectStoreError; read `code` structurally so a foreign error is still handled.
function errorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

export function ProjectsList({ lab }: { lab: ActiveLab | null }) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, setState] = useState<State>({ status: "loading" });
  // A readable project, or an unreadable record known only by its ID.
  const [pending, setPending] = useState<{ id: string; title: string; isRecordId: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [exportFailed, setExportFailed] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Whichever heading follows a delete (the list's, or the empty state's) takes focus.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [refocus, setRefocus] = useState(0);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const result = await getGuestProjectStore().list();
      const projects = [...result.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setState({ status: "ready", projects, corruptIds: result.corruptIds });
    } catch (error) {
      setState({ status: errorCode(error) === "unavailable" ? "unavailable" : "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (pending && dialog && !dialog.open) dialog.showModal();
  }, [pending]);

  useEffect(() => {
    if (refocus > 0) headingRef.current?.focus();
  }, [refocus]);

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  function closeDialog() {
    dialogRef.current?.close();
  }

  async function confirmDelete() {
    if (!pending || deleting) return;
    setDeleting(true);
    setDeleteFailed(false);
    try {
      await getGuestProjectStore().remove(pending.id);
    } catch (error) {
      // Already gone counts as deleted; anything else is reported and the project stays listed.
      if (errorCode(error) !== "not_found") {
        setDeleting(false);
        setDeleteFailed(true);
        return;
      }
    }
    const removedId = pending.id;
    setDeleting(false);
    closeDialog();
    setState((current) =>
      current.status === "ready"
        ? {
            ...current,
            projects: current.projects.filter((p) => p.id !== removedId),
            corruptIds: current.corruptIds.filter((id) => id !== removedId),
          }
        : current,
    );
    setAnnouncement(t("projects.deleted"));
    // The button that opened the dialog is gone with its row.
    setRefocus((n) => n + 1);
  }

  /** An archived project is downloaded exactly as stored, with its snapshots. */
  async function exportArchivedProject(project: ProjectSummary, title: string) {
    setExportFailed(null);
    try {
      const store = getGuestProjectStore();
      const record = await store.get(project.id);
      const snapshots: ProjectSnapshot[] = [];
      for (const summary of await store.listSnapshots(project.id)) snapshots.push(await store.getSnapshot(project.id, summary.id));
      const name = exportFileName(title, "programming-project");
      const url = URL.createObjectURL(new Blob([JSON.stringify(exportArchived(record, snapshots, new Date()), null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
      setAnnouncement(t("projects.archived.exported", { name }));
    } catch {
      setExportFailed(project.id);
    }
  }

  const filter = (
    <nav aria-label={t("projects.filterLabel")} className="filter">
      <ul className="filter-list">
        <li>
          <Link href="/projects" scroll={false} className="filter-link" aria-current={lab ? undefined : "true"}>
            {t("projects.filterAll")}
          </Link>
        </li>
        {LABS.map((item) => (
          <li key={item}>
            <Link
              href={`/projects?lab=${item}`}
              scroll={false}
              className="filter-link"
              aria-current={lab === item ? "true" : undefined}
            >
              {t(`labs.${item}.title`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  if (state.status === "loading") {
    return (
      <p className="state-panel" role="status">
        <span className="spinner" aria-hidden="true" />
        {t("projects.loading")}
      </p>
    );
  }

  if (state.status === "unavailable" || state.status === "error") {
    return (
      <div className="state-panel state-panel-block" role="alert">
        <h2 className="section-heading state-heading">
          <WarningIcon />
          {t(`projects.${state.status}.heading`)}
        </h2>
        <p>{t(`projects.${state.status}.body`)}</p>
        <div className="button-row">
          <button type="button" className="button button-primary" onClick={() => void load()}>
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }

  const active = state.projects.filter((p) => isLab(p.lab));
  // Projects of the former Code Studio: kept and listed, never opened as a lab.
  const archived = state.projects.filter((p) => !isLab(p.lab));
  const visible = lab ? active.filter((p) => p.lab === lab) : active;

  return (
    <>
      {state.corruptIds.length > 0 && (
        <div className="state-panel state-panel-block state-panel-warning">
          <h2 className="section-heading state-heading">
            <WarningIcon />
            {t("projects.corrupt.heading", { count: state.corruptIds.length })}
          </h2>
          <p>{t("projects.corrupt.body")}</p>
          <p className="state-meta">{t("projects.corrupt.ids")}:</p>
          <ul className="record-list">
            {state.corruptIds.map((id) => (
              <li key={id}>
                <code dir="ltr">{id}</code>
                <button
                  type="button"
                  className="button button-danger"
                  aria-label={t("projects.item.deleteNamed", { title: id })}
                  onClick={() => {
                    setDeleteFailed(false);
                    setPending({ id, title: id, isRecordId: true });
                  }}
                >
                  {t("projects.item.delete")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.projects.length === 0 ? (
        <div className="state-panel state-panel-block">
          <h2 ref={headingRef} tabIndex={-1} className="section-heading state-heading">
            <InfoIcon />
            {t("projects.empty.heading")}
          </h2>
          <p>{t("projects.empty.body")}</p>
          <ul className="button-row">
            {LABS.map((item) => (
              <li key={item}>
                <Link href={`/${item}`} className="button">
                  {t(`labs.${item}.title`)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : active.length === 0 && !lab ? null : (
        <section aria-labelledby="projects-list-heading">
          <h2 id="projects-list-heading" ref={headingRef} tabIndex={-1} className="section-heading">
            {t("projects.listLabel")}
          </h2>
          {filter}
          {visible.length === 0 && lab ? (
            <div className="state-panel state-panel-block">
              <p>{t("projects.emptyFiltered", { lab: t(`labs.${lab}.title`) })}</p>
              <div className="button-row">
                <Link href={`/${lab}`} className="button">
                  {t("projects.openLab", { lab: t(`labs.${lab}.title`) })}
                </Link>
              </div>
            </div>
          ) : (
            <ul className="project-list">
              {visible.map((project) => {
                const title = project.title.trim() || t("projects.item.untitled");
                const projectLab = project.lab as ActiveLab;
                const labTitle = t(`labs.${projectLab}.title`);
                return (
                  // <bdi> keeps a title's own text order without moving the block to the other side of the page.
                  <li key={project.id} className="project">
                    <div className="project-main">
                      <h3 className="project-title">
                        <bdi>{title}</bdi>
                      </h3>
                      <p className="project-meta">
                        <span>{labTitle}</span>
                        <span>{t(`modes.${modeLabelKey(project.mode)}`)}</span>
                        <span>{t("projects.item.revision", { revision: project.revision })}</span>
                      </p>
                      <p className="project-meta">
                        {t("projects.item.updated")}:{" "}
                        <time dateTime={project.updatedAt}>{dateFormat.format(new Date(project.updatedAt))}</time>
                      </p>
                    </div>
                    <div className="button-row">
                      <Link
                        href={labHref(projectLab, { mode: project.mode, project: project.id })}
                        className="button button-primary"
                        aria-label={t("projects.item.openNamed", { title })}
                      >
                        {t("projects.item.open")}
                      </Link>
                      <button
                        type="button"
                        className="button button-danger"
                        aria-label={t("projects.item.deleteNamed", { title })}
                        onClick={() => {
                          setDeleteFailed(false);
                          setPending({ id: project.id, title, isRecordId: false });
                        }}
                      >
                        {t("projects.item.delete")}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {!lab && archived.length > 0 && (
        <section aria-labelledby="projects-archived-heading" className="choice-section">
          <h2
            id="projects-archived-heading"
            // Takes focus after a delete when no other list is shown.
            ref={active.length === 0 ? headingRef : undefined}
            tabIndex={-1}
            className="section-heading state-heading"
          >
            <InfoIcon />
            {t("projects.archived.heading", { count: archived.length })}
          </h2>
          <p>{t("projects.archived.body")}</p>
          <ul className="project-list">
            {archived.map((project) => {
              const title = project.title.trim() || t("projects.item.untitled");
              return (
                <li key={project.id} className="project">
                  <div className="project-main">
                    <h3 className="project-title">
                      <bdi>{title}</bdi>
                    </h3>
                    <p className="project-meta">
                      <span>{t("projects.archived.kind")}</span>
                      <span>{t("projects.item.revision", { revision: project.revision })}</span>
                    </p>
                    <p className="project-meta">
                      {t("projects.item.updated")}:{" "}
                      <time dateTime={project.updatedAt}>{dateFormat.format(new Date(project.updatedAt))}</time>
                    </p>
                    {exportFailed === project.id && (
                      <p className="notice notice-danger" role="alert">
                        <WarningIcon />
                        <span>{t("projects.archived.exportFailed")}</span>
                      </p>
                    )}
                  </div>
                  <div className="button-row">
                    <button
                      type="button"
                      className="button"
                      aria-label={t("projects.archived.exportNamed", { title })}
                      onClick={() => void exportArchivedProject(project, title)}
                    >
                      {t("projects.archived.export")}
                    </button>
                    <button
                      type="button"
                      className="button button-danger"
                      aria-label={t("projects.item.deleteNamed", { title })}
                      onClick={() => {
                        setDeleteFailed(false);
                        setPending({ id: project.id, title, isRecordId: false });
                      }}
                    >
                      {t("projects.item.delete")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="visually-hidden" role="status">
        {announcement}
      </p>

      <dialog
        ref={dialogRef}
        className="dialog"
        aria-labelledby="delete-heading"
        aria-describedby="delete-body"
        onClose={() => {
          setPending(null);
          setDeleteFailed(false);
        }}
        onCancel={(event) => {
          if (deleting) event.preventDefault();
        }}
      >
        <h2 id="delete-heading" className="section-heading">
          {t("projects.confirm.heading")}
        </h2>
        <p className="project-title">
          <bdi dir={pending?.isRecordId ? "ltr" : "auto"}>{pending?.title}</bdi>
        </p>
        <p id="delete-body">{t("projects.confirm.body")}</p>
        {deleteFailed && (
          <p className="notice notice-danger" role="alert">
            <WarningIcon />
            <span>{t("projects.confirm.failed")}</span>
          </p>
        )}
        <div className="button-row">
          <button type="button" className="button" autoFocus disabled={deleting} onClick={closeDialog}>
            {t("common.cancel")}
          </button>
          <button type="button" className="button button-danger" disabled={deleting} onClick={() => void confirmDelete()}>
            {deleting ? t("projects.confirm.deleting") : t("projects.confirm.confirm")}
          </button>
        </div>
      </dialog>
    </>
  );
}
