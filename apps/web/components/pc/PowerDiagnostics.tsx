"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { PCBuildState, StartupResult } from "@ytl/contracts";
import { pcCatalog } from "./catalog";
import styles from "./simple-pc.module.css";

const entry = (id: string) => pcCatalog.entries.find((e) => e.id === id);

/**
 * What a power-on attempt showed, stage by stage (power, POST, firmware, boot, load) as the learner
 * would observe it, without naming the cause; the cause is one tap further. When the self-test
 * passed, a firmware-style list of the detected hardware stands in for a monitor.
 */
export function PowerDiagnostics({ state, startup }: { state: PCBuildState; startup: StartupResult }) {
  const t = useTranslations("simplePc.diag");
  const locale = useLocale();
  const lang = locale === "ar" ? "ar" : "en";
  const [cause, setCause] = useState(false);
  const failed = startup.stages.find((s) => s.status === "failed");
  const postOk = startup.stages.find((s) => s.stage === "post")?.status === "passed";
  const lit = startup.observable.lighting.filter((l) => l.lit).length;
  const fitted = (category: string) => state.parts.filter((p) => p.attachments.some((a) => a.seating === "seated") && entry(p.catalogId)?.category === category);
  const ram = fitted("ram");
  const ramEntry = ram[0] ? entry(ram[0].catalogId) : undefined;
  const board = fitted("motherboard")[0];
  const gpu = fitted("gpu")[0];
  return (
    <div className={styles.diag}>
      <strong className={styles.diagTitle}>{t("title")}</strong>
      <ol className={styles.stages}>
        {startup.stages.map((s) => (
          <li key={s.stage} data-status={s.status}>
            <span className={styles.stageMark} aria-hidden="true">{s.status === "passed" ? "✓" : s.status === "failed" ? "✕" : "·"}</span>
            <span><b>{t(`stages.${s.stage}`)}</b> · {t(`status.${s.status}`)}{s.status !== "not_reached" && <small>{s.observation[lang]}</small>}</span>
          </li>
        ))}
      </ol>
      <p className={styles.diagLine}>{t("spinning", { count: startup.observable.spinning.length })} · {lit > 0 ? t("lit", { count: lit }) : t("noLights")}</p>
      <p className={styles.diagNote}>{t("note")}</p>
      {failed && failed.diagnostics[0] && <>
        <button type="button" className={styles.cancel} aria-expanded={cause} onClick={() => setCause(!cause)}>{cause ? t("hideCause") : t("showCause")}</button>
        {cause && <p className={styles.diagCause}>{failed.diagnostics[0].message[lang]}</p>}
      </>}
      {postOk && <div className={styles.bios} dir="ltr">
        <strong>{t("summary")}</strong>
        <dl>
          {fitted("cpu").map((p) => <div key={p.instanceId}><dt>{t("cpu")}</dt><dd>{entry(p.catalogId)?.model}</dd></div>)}
          {ramEntry?.category === "ram" && <div><dt>{t("memory")}</dt><dd>{ram.length} × {ramEntry.spec.capacityPerModuleGb} GB {ramEntry.spec.generation.toUpperCase()} = {ram.length * ramEntry.spec.capacityPerModuleGb} GB</dd></div>}
          {fitted("storage").map((p) => <div key={p.instanceId}><dt>{t("storage")}</dt><dd>{entry(p.catalogId)?.model}</dd></div>)}
          <div><dt>{t("gpu")}</dt><dd>{gpu ? entry(gpu.catalogId)?.model : t("gpuNone")}</dd></div>
          {board && <div><dt>{t("bios")}</dt><dd>{entry(board.catalogId)?.model} · {board.biosVersion === "unrecorded" ? "—" : board.biosVersion}</dd></div>}
        </dl>
        <p className={styles.diagNote}>{t("monitor")}</p>
      </div>}
    </div>
  );
}
