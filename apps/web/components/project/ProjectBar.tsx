"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CheckIcon, WarningIcon } from "../icons";
import { useSession, useSessionStore } from "./context";
import { SnapshotsDialog } from "./SnapshotsDialog";

function TitleField() {
  const t = useTranslations("project.bar");
  const store = useSessionStore();
  const title = useSession((state) => state.title);
  const [draft, setDraft] = useState(title);
  const [invalid, setInvalid] = useState(false);

  // A restore or a reload can change the stored title under the field.
  useEffect(() => {
    setDraft(title);
    setInvalid(false);
  }, [title]);

  function commit(event?: FormEvent) {
    event?.preventDefault();
    setInvalid(!store.getState().setTitle(draft.trim()));
  }

  return (
    <form onSubmit={commit} className="studio-title">
      <label htmlFor="studio-title" className="visually-hidden">
        {t("titleLabel")}
      </label>
      <input
        id="studio-title"
        className="input"
        dir="auto"
        autoComplete="off"
        value={draft}
        aria-invalid={invalid}
        aria-describedby={invalid ? "studio-title-problem" : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit()}
      />
      {invalid && (
        <p id="studio-title-problem" className="field-problem" role="alert">
          {t("titleInvalid")}
        </p>
      )}
    </form>
  );
}

function SaveStatus() {
  const t = useTranslations("project.save");
  const saveState = useSession((state) => state.saveState);
  const key = saveState === "dirty" ? "saving" : saveState;
  return (
    // Not a live region: it changes with every pause in typing. Failures are announced by their own alerts.
    <p className="save-status" data-state={key}>
      {key === "saved" ? <CheckIcon /> : key === "saving" ? <span className="spinner" aria-hidden="true" /> : <WarningIcon />}
      {t(key)}
    </p>
  );
}

/**
 * The bar above a lab workspace: project name, save status, the lab's own buttons (`children`),
 * snapshots and close; below it, the notices about recovery, a failed save and a conflict.
 * `onExport` adds an export button to the notices, for labs that can export.
 */
export function ProjectBar({
  closeHref,
  info,
  children,
  onExport,
  announce,
}: {
  closeHref: string;
  /** Short facts shown beside the name, e.g. the track. */
  info?: ReactNode;
  children?: ReactNode;
  onExport?: () => void;
  announce: (text: string) => void;
}) {
  const t = useTranslations("project");
  const store = useSessionStore();
  const saveState = useSession((state) => state.saveState);
  const recovered = useSession((state) => state.recovered);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [resolving, setResolving] = useState(false);

  async function resolve(choice: "mine" | "theirs") {
    setResolving(true);
    await store.getState().resolveConflict(choice);
    setResolving(false);
  }

  const exportButton = onExport && (
    <button type="button" className="button" onClick={onExport}>
      {t("export")}
    </button>
  );

  return (
    <>
      <div className="studio-bar">
        <TitleField />
        {info}
        <SaveStatus />
        <div className="button-row">
          {children}
          <button type="button" className="button button-small" aria-haspopup="dialog" onClick={() => setSnapshotsOpen(true)}>
            {t("bar.snapshots")}
          </button>
          <Link href={closeHref} className="button button-small">
            {t("bar.close")}
          </Link>
        </div>
      </div>

      {recovered && (
        <p className="notice studio-notice">
          <CheckIcon />
          <span>{t("save.recovered")}</span>
          <button type="button" className="button button-small" onClick={() => store.getState().dismissRecovered()}>
            {t("save.dismiss")}
          </button>
        </p>
      )}
      {saveState === "failed" && (
        <div className="state-panel state-panel-block state-panel-warning" role="alert">
          <p className="notice notice-danger">
            <WarningIcon />
            <span>{t("save.failedBody")}</span>
          </p>
          <div className="button-row">
            <button type="button" className="button button-primary" onClick={() => void store.getState().saveNow()}>
              {t("save.retry")}
            </button>
            {exportButton}
          </div>
        </div>
      )}
      {saveState === "conflict" && (
        <div className="state-panel state-panel-block state-panel-warning" role="alert">
          <h3 className="subheading state-heading">
            <WarningIcon />
            {t("conflict.heading")}
          </h3>
          <p>{t("conflict.body")}</p>
          <div className="button-row">
            <button type="button" className="button button-primary" disabled={resolving} onClick={() => void resolve("mine")}>
              {t("conflict.keepMine")}
            </button>
            <button type="button" className="button" disabled={resolving} onClick={() => void resolve("theirs")}>
              {t("conflict.loadTheirs")}
            </button>
            {exportButton}
          </div>
        </div>
      )}

      <SnapshotsDialog open={snapshotsOpen} onClose={() => setSnapshotsOpen(false)} announce={announce} />
    </>
  );
}
