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

/** The site's robot (same drawing as the page tutor), posed by CSS for each mood. Decorative. */
function Bot({ mood, point, reducedMotion }: { mood: string; point?: string; reducedMotion: boolean }) {
  return (
    <div className={styles.bot} data-mood={mood} data-point={point ?? "none"} data-reduced={reducedMotion} aria-hidden="true" data-testid="companion-robot">
      <svg viewBox="0 0 120 164" width="100%" height="100%" focusable="false">
        <defs>
          <linearGradient id="ytl-companion-shell" x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.6" stopColor="#eef1f6" />
            <stop offset="1" stopColor="#c3cad6" />
          </linearGradient>
          <linearGradient id="ytl-companion-face" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#15171c" />
            <stop offset="1" stopColor="#030304" />
          </linearGradient>
          <radialGradient id="ytl-companion-eye" cx="0.5" cy="0.4" r="0.7">
            <stop offset="0" stopColor="#b9f3ff" />
            <stop offset="0.55" stopColor="#38bdf8" />
            <stop offset="1" stopColor="#1d6fe0" />
          </radialGradient>
        </defs>
        <ellipse className={styles.shadow} cx="60" cy="158" rx="22" ry="4" fill="#000000" opacity="0.35" />
        <g className={styles.body}>
          <g className={styles.armLeft}>
            <path d="M31 76c5 0 8 4 7.4 10l-3 30c-.5 5-3 8-6.4 8s-5.6-3-5.4-8l1.4-30c.3-6 2.2-10 6-10z" fill="url(#ytl-companion-shell)" stroke="#aab2c0" strokeWidth="0.8" />
          </g>
          <g className={styles.armRight}>
            <path d="M89 76c-5 0-8 4-7.4 10l3 30c.5 5 3 8 6.4 8s5.6-3 5.4-8l-1.4-30c-.3-6-2.2-10-6-10z" fill="url(#ytl-companion-shell)" stroke="#aab2c0" strokeWidth="0.8" />
          </g>
          <path d="M60 68c21 0 31 13 29 34-2.2 25-15 48-29 48s-26.8-23-29-48c-2-21 8-34 29-34z" fill="url(#ytl-companion-shell)" stroke="#aab2c0" strokeWidth="0.8" />
          <path d="M44 78c-6 6-8 16-6 28" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" opacity="0.85" />
          <circle className={styles.core} cx="60" cy="92" r="3.2" fill="#22d3ee" opacity="0.9" />
          <g className={styles.head}>
            <ellipse cx="60" cy="36" rx="35" ry="27" fill="url(#ytl-companion-shell)" stroke="#aab2c0" strokeWidth="0.8" />
            <path d="M34 24c5-8 14-12 24-12.5" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" opacity="0.9" />
            <rect x="35" y="25" width="50" height="30" rx="15" fill="url(#ytl-companion-face)" />
            <g className={styles.eyes}>
              <ellipse cx="49" cy="40" rx="5.5" ry="6.5" fill="url(#ytl-companion-eye)" transform="rotate(-8 49 40)" />
              <ellipse cx="71" cy="40" rx="5.5" ry="6.5" fill="url(#ytl-companion-eye)" transform="rotate(8 71 40)" />
            </g>
            <path className={styles.smile} d="M53 48c4 3 10 3 14 0" fill="none" stroke="#38bdf8" strokeWidth="1.8" strokeLinecap="round" />
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
