"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TargetLink } from "../TargetLink";
import { SimplePcLab } from "../pc/SimplePcLab";
import { ProgrammingLab } from "./ProgrammingLab";
import styles from "./learning.module.css";

export function LearningHome() {
  const t = useTranslations("learning");
  const [guided, setGuided] = useState(true);
  const [started, setStarted] = useState(false);
  return <div className={styles.home}>
    <section className={styles.hero} id="welcome" aria-labelledby="welcome-title">
      <span className={styles.eyebrow}>{t("eyebrow")}</span>
      <h1 id="welcome-title">{t("name")}</h1>
      <p className={styles.tagline}>{t("tagline")}</p>
      <p className={styles.intro}>{t("intro")}</p>
      <div className={styles.entryCards}>
        <button type="button" className={styles.entry} aria-pressed={started && guided} onClick={() => { setGuided(true); setStarted(true); }}><span aria-hidden="true">01</span><strong>{t("helpStart")}</strong><small>{t("helpStartDetail")}</small><b aria-hidden="true">↗</b></button>
        <button type="button" className={styles.entry} aria-pressed={started && !guided} onClick={() => { setGuided(false); setStarted(true); }}><span aria-hidden="true">02</span><strong>{t("selfStart")}</strong><small>{t("selfStartDetail")}</small><b aria-hidden="true">↗</b></button>
      </div>
      {started && <div className={styles.startPanel} aria-live="polite">
        <h2>{t(guided ? "startTitle" : "chooseTitle")}</h2>
        {guided && <p>{t("startSteps")}</p>}
        <div className={styles.links}>
          <TargetLink href="#programming" targetId="home:ui:lab-code" className={styles.primary}>{t("startCoding")}</TargetLink>
          <TargetLink href="#pc-builder" targetId="home:ui:lab-pc" className={styles.secondary}>{t("startPc")}</TargetLink>
        </div>
      </div>}
      {!started && <div className={styles.links}><TargetLink targetId="home:ui:lab-code" href="#programming">{t("codeNav")} ↓</TargetLink><TargetLink targetId="home:ui:lab-pc" href="#pc-builder">{t("pcNav")} ↓</TargetLink></div>}
      <p className={styles.helperNote}>{t("helperNote")}</p>
    </section>
    <ProgrammingLab guided={guided} onGuidedChange={setGuided} />
    <section id="pc-builder" className={styles.pcSection} aria-label={t("pcNav")}>
      <div className={styles.sectionLabel}><span>02 /</span> {t("pcSection")}</div>
      <SimplePcLab embedded />
    </section>
    <footer className={styles.footer}>{t("footer")}</footer>
  </div>;
}
