"use client";

// The build companion: the site's robot, with a speech bubble over its head, guiding the single-PC
// page. What it says comes from `companion.ts` (the real build state); this file only shows it.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CompanionLine, CompanionSay, CompanionValue } from "./companion";
import styles from "./companion.module.css";

export interface CompanionMessage {
  /** Changes on every new message, even one with the same words, so the robot reacts again. */
  id: number;
  say: CompanionSay;
  /** The learner's own words, when this message answers a typed question. */
  question?: string;
  /** Text from the AI tutor, shown as it came (already validated by the server). */
  aiText?: string;
}

export function BuildCompanion({ message, ai, thinking, reducedMotion, onQuick, onAsk, summary }: {
  message: CompanionMessage;
  ai: "available" | "not_configured" | "unknown";
  thinking: boolean;
  reducedMotion: boolean;
  onQuick: (intent: "next" | "help" | "explain") => void;
  onAsk: (text: string) => void;
  /** The parts and leads of the finished build, shown once it is complete. */
  summary: { parts: string[]; cables: string[] } | null;
}) {
  const t = useTranslations("simplePc");
  const locale = useLocale();
  const [draft, setDraft] = useState("");
  const bubble = useRef<HTMLDivElement>(null);
  const [bump, setBump] = useState(0);

  // A new message makes the bubble pop once; the words stay until the next event.
  useEffect(() => { setBump((n) => n + 1); }, [message.id]);

  const name = (value: CompanionValue): string => {
    if (typeof value !== "object") return String(value);
    if ("part" in value) return t(`parts.${value.part}`);
    if ("cable" in value) return t(`cables.${value.cable}.name`);
    if ("place" in value) return t(`companion.places.${value.place}`);
    return value.parts.map((key) => t(`parts.${key}`)).join(locale === "ar" ? "، " : ", ");
  };
  const speak = (line: CompanionLine) =>
    t(`companion.${line.key}`, Object.fromEntries(Object.entries(line.values ?? {}).map(([key, value]) => [key, name(value)])));

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || thinking) return;
    onAsk(text);
    setDraft("");
  }

  const mood = thinking ? "thinking" : message.say.mood;
  return (
    <section className={styles.companion} aria-label={t("companion.name")} data-reduced={reducedMotion}>
      <div ref={bubble} key={bump} className={styles.bubble} data-mood={mood} role="status" aria-live="polite" aria-atomic="true">
        {message.question && <p className={styles.asked}><span>{t("companion.you")}:</span> {message.question}</p>}
        {thinking ? <p className={styles.thinking}>{t("companion.thinking")}</p> : message.aiText ? <p>{message.aiText}</p> : message.say.lines.map((line, index) => <p key={index}>{speak(line)}</p>)}
      </div>
      <div className={styles.row}>
        <Bot mood={mood} point={message.say.point} reducedMotion={reducedMotion} />
        <div className={styles.talk}>
          <div className={styles.quick} role="group" aria-label={t("companion.listening")}>
            {(["next", "help", "explain"] as const).map((intent) => (
              <button key={intent} type="button" onClick={() => onQuick(intent)} disabled={thinking}>{t(`companion.quick.${intent}`)}</button>
            ))}
          </div>
          <form className={styles.ask} onSubmit={submit}>
            <input value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 300))} maxLength={300} placeholder={t("companion.inputPlaceholder")} aria-label={t("companion.inputLabel")} enterKeyHint="send" />
            <button type="submit" disabled={!draft.trim() || thinking}>{t("companion.send")}</button>
          </form>
          <p className={styles.note}>{t(ai === "available" ? "companion.aiOn" : "companion.aiOff")}</p>
        </div>
      </div>
      {summary && (
        <div className={styles.summary}>
          <strong>{t("companion.complete.heading")}</strong>
          <div>
            <span>{t("companion.complete.parts")}</span>
            <ul>{summary.parts.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
          <div>
            <span>{t("companion.complete.cables")}</span>
            <ul>{summary.cables.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The site's robot, drawn as a small hovering helper: a white shell, a dark visor with two eyes, an
 * antenna light, a glowing core and a hover glow under it. CSS poses it for each mood (idle float,
 * wave, point, think, worry, cheer). Decorative: the bubble carries every word.
 */
function Bot({ mood, point, reducedMotion }: { mood: string; point?: string; reducedMotion: boolean }) {
  return (
    <div className={styles.bot} data-mood={mood} data-point={point ?? "none"} data-reduced={reducedMotion} aria-hidden="true" data-testid="companion-robot">
      <svg viewBox="0 0 120 164" width="100%" height="100%" focusable="false">
        <defs>
          <linearGradient id="ytl-companion-shell" x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.55" stopColor="#eef2f7" />
            <stop offset="1" stopColor="#b9c2d0" />
          </linearGradient>
          <linearGradient id="ytl-companion-trim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d5dbe5" />
            <stop offset="1" stopColor="#a3adbd" />
          </linearGradient>
          <linearGradient id="ytl-companion-face" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1a1d24" />
            <stop offset="1" stopColor="#030406" />
          </linearGradient>
          <radialGradient id="ytl-companion-eye" cx="0.45" cy="0.38" r="0.75">
            <stop offset="0" stopColor="#e0fbff" />
            <stop offset="0.45" stopColor="#5fd4fb" />
            <stop offset="1" stopColor="#1d6fe0" />
          </radialGradient>
          <radialGradient id="ytl-companion-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#22d3ee" stopOpacity="0.55" />
            <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse className={styles.shadow} cx="60" cy="158" rx="24" ry="4.5" fill="url(#ytl-companion-glow)" />
        <g className={styles.body}>
          <g className={styles.armLeft}>
            <path d="M31 76c5 0 8 4 7.4 10l-3 28c-.5 5-3 8-6.4 8s-5.6-3-5.4-8l1.4-28c.3-6 2.2-10 6-10z" fill="url(#ytl-companion-shell)" stroke="#a9b2c1" strokeWidth="0.8" />
            <circle cx="29" cy="121" r="5.2" fill="url(#ytl-companion-trim)" />
          </g>
          <g className={styles.armRight}>
            <path d="M89 76c-5 0-8 4-7.4 10l3 28c.5 5 3 8 6.4 8s5.6-3 5.4-8l-1.4-28c-.3-6-2.2-10-6-10z" fill="url(#ytl-companion-shell)" stroke="#a9b2c1" strokeWidth="0.8" />
            <circle cx="91" cy="121" r="5.2" fill="url(#ytl-companion-trim)" />
          </g>
          <path d="M60 66c22 0 32 13 30 35-2.2 25-15.5 47-30 47s-27.8-22-30-47c-2-22 8-35 30-35z" fill="url(#ytl-companion-shell)" stroke="#a9b2c1" strokeWidth="0.8" />
          <path d="M33 86c8 4 18 6 27 6s19-2 27-6" fill="none" stroke="#c7cfdb" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M43 77c-6 6-8 16-6 28" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" opacity="0.85" />
          <circle cx="60" cy="104" r="8" fill="#0d1218" stroke="#c7cfdb" strokeWidth="1.2" />
          <circle className={styles.core} cx="60" cy="104" r="4" fill="#22d3ee" />
          <g className={styles.head}>
            <g className={styles.antenna}>
              <path d="M60 12V3" stroke="#a9b2c1" strokeWidth="2.4" strokeLinecap="round" />
              <circle className={styles.antennaLight} cx="60" cy="3" r="3.4" fill="#22d3ee" />
            </g>
            <ellipse cx="24.5" cy="37" rx="4.5" ry="8" fill="url(#ytl-companion-trim)" />
            <ellipse cx="95.5" cy="37" rx="4.5" ry="8" fill="url(#ytl-companion-trim)" />
            <ellipse cx="60" cy="36" rx="35" ry="27" fill="url(#ytl-companion-shell)" stroke="#a9b2c1" strokeWidth="0.8" />
            <path d="M33 23c5-8 15-12.5 25-13" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" opacity="0.9" />
            <rect x="34" y="24" width="52" height="31" rx="15.5" fill="url(#ytl-companion-face)" />
            <path d="M40 28c4-2 10-2.6 16-2.4" fill="none" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" opacity="0.16" />
            <g className={styles.eyes}>
              <ellipse cx="49" cy="40" rx="5.6" ry="6.8" fill="url(#ytl-companion-eye)" transform="rotate(-8 49 40)" />
              <ellipse cx="71" cy="40" rx="5.6" ry="6.8" fill="url(#ytl-companion-eye)" transform="rotate(8 71 40)" />
              <circle cx="47" cy="37.5" r="1.6" fill="#ffffff" opacity="0.9" />
              <circle cx="69" cy="37.5" r="1.6" fill="#ffffff" opacity="0.9" />
            </g>
            <path className={styles.smile} d="M53 48.5c4 3 10 3 14 0" fill="none" stroke="#38bdf8" strokeWidth="1.8" strokeLinecap="round" />
          </g>
        </g>
        <g className={styles.confetti}>
          <rect x="14" y="20" width="5" height="5" rx="1" fill="#22d3ee" />
          <rect x="100" y="16" width="5" height="5" rx="1" fill="#facc15" />
          <rect x="8" y="58" width="4" height="4" rx="1" fill="#a78bfa" />
          <rect x="106" y="56" width="4" height="4" rx="1" fill="#4ade80" />
          <rect x="24" y="4" width="4" height="4" rx="1" fill="#fb923c" />
          <rect x="92" y="2" width="4" height="4" rx="1" fill="#f472b6" />
        </g>
      </svg>
    </div>
  );
}
