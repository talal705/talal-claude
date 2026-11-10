"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ProjectSnapshotSummary } from "@ytl/contracts";
import { WarningIcon } from "../icons";
import { Modal } from "../Modal";
import { useSessionStore } from "./context";
import { TITLE_MAX_LENGTH } from "./session";

function Snapshots({ onClose, announce }: { onClose: () => void; announce: (text: string) => void }) {
  const t = useTranslations("project.snapshots");
  const session = useSessionStore();
  const tc = useTranslations("common");
  const locale = useLocale();
  // undefined: loading. null: could not be read.
  const [list, setList] = useState<ProjectSnapshotSummary[] | null | undefined>(undefined);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<"take" | "restore" | null>(null);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const [confirming, setConfirming] = useState<ProjectSnapshotSummary | null>(null);
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }), [locale]);
  const tooLong = label.length > TITLE_MAX_LENGTH;

  useEffect(() => {
    let current = true;
    void session
      .getState()
      .listSnapshots()
      .then((snapshots) => {
        if (current) setList(snapshots);
      });
    return () => {
      current = false;
    };
  }, [session]);

  async function take(event: FormEvent) {
    event.preventDefault();
    if (busy || tooLong) return;
    setBusy("take");
    setMessage(null);
    const snapshot = await session.getState().createSnapshot(label.trim());
    setBusy(null);
    if (!snapshot) {
      setMessage({ text: t("takeFailed"), failed: true });
      return;
    }
    setLabel("");
    setList((previous) => [snapshot, ...(previous ?? [])]);
    setMessage({ text: t("taken"), failed: false });
  }

  async function restore(snapshot: ProjectSnapshotSummary) {
    setBusy("restore");
    setMessage(null);
    const ok = await session.getState().restoreSnapshot(snapshot.id);
    setBusy(null);
    setConfirming(null);
    if (!ok) {
      setMessage({ text: t("restoreFailed"), failed: true });
      return;
    }
    announce(t("restored"));
    onClose();
  }

  if (confirming) {
    return (
      <>
        <h2 id="snapshots-heading" className="section-heading">
          {t("confirmHeading")}
        </h2>
        <p className="project-title">
          <bdi>{confirming.label || t("unnamed")}</bdi>
        </p>
        <p>{t("confirmBody")}</p>
        <div className="button-row">
          <button type="button" className="button" autoFocus disabled={busy !== null} onClick={() => setConfirming(null)}>
            {tc("cancel")}
          </button>
          <button type="button" className="button button-primary" disabled={busy !== null} onClick={() => void restore(confirming)}>
            {busy === "restore" ? t("restoring") : t("confirm")}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <h2 id="snapshots-heading" className="section-heading">
        {t("heading")}
      </h2>
      <p className="settings-hint">{t("note")}</p>

      <form onSubmit={(event) => void take(event)} className="field">
        <label htmlFor="snapshot-name">{t("nameLabel")}</label>
        <input
          id="snapshot-name"
          className="input"
          dir="auto"
          autoComplete="off"
          value={label}
          aria-invalid={tooLong}
          aria-describedby={tooLong ? "snapshot-name-problem" : undefined}
          onChange={(event) => setLabel(event.target.value)}
        />
        {tooLong && (
          <p id="snapshot-name-problem" className="field-problem">
            {t("nameTooLong")}
          </p>
        )}
        <div className="button-row">
          <button type="submit" className="button button-primary" disabled={busy !== null || tooLong}>
            {busy === "take" ? t("taking") : t("take")}
          </button>
        </div>
      </form>

      <div role="status" className="settings-status">
        {message &&
          (message.failed ? (
            <p className="notice notice-danger">
              <WarningIcon />
              <span>{message.text}</span>
            </p>
          ) : (
            <p>{message.text}</p>
          ))}
      </div>

      {list === undefined && <p className="lab-status-empty">{t("loading")}</p>}
      {list === null && (
        <p className="notice notice-danger">
          <WarningIcon />
          <span>{t("loadFailed")}</span>
        </p>
      )}
      {list && list.length === 0 && <p className="lab-status-empty">{t("empty")}</p>}
      {list && list.length > 0 && (
        <ul className="snapshot-list" aria-label={t("listLabel")}>
          {list.map((snapshot) => {
            const name = snapshot.label || t("unnamed");
            return (
              <li key={snapshot.id} className="snapshot">
                <div className="project-main">
                  <p className="project-title">
                    <bdi>{name}</bdi>
                  </p>
                  <p className="project-meta">
                    <span>{t("meta", { revision: snapshot.revision })}</span>
                    <time dateTime={snapshot.createdAt}>{dateFormat.format(new Date(snapshot.createdAt))}</time>
                  </p>
                </div>
                <button
                  type="button"
                  className="button button-small"
                  aria-label={t("restoreNamed", { name })}
                  disabled={busy !== null}
                  onClick={() => setConfirming(snapshot)}
                >
                  {t("restore")}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="button-row">
        <button type="button" className="button" onClick={onClose}>
          {tc("close")}
        </button>
      </div>
    </>
  );
}

/** Named snapshots of the open project: take one, list them, go back to one. */
export function SnapshotsDialog({ open, onClose, announce }: { open: boolean; onClose: () => void; announce: (text: string) => void }) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="snapshots-heading">
      <Snapshots onClose={onClose} announce={announce} />
    </Modal>
  );
}
