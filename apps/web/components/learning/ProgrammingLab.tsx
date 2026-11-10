"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CodeTrack, ExecutionResult, ExecutionStatus } from "@ytl/contracts";
import { createRunAdapters, type RunHandle } from "@/lib/runtime";
import { useTutorTarget } from "@/lib/targets";
import { tutor } from "@/lib/interaction/advisor";
import { hintLadder } from "@/lib/interaction/hint-ladder";
import { CODE_SAVE_KEY, MAX_CODE_LENGTH, suggestTypo, TRACKS } from "./tracks";
import styles from "./learning.module.css";

type Review = { explanation: string; correctedCode: string | null; line: number | null; source: "ai" | "rule_based" };
type Drafts = Partial<Record<CodeTrack, string>>;
const ACTIVE = new Set<ExecutionStatus>(["queued", "compiling", "running"]);

export function ProgrammingLab({ guided, onGuidedChange }: { guided: boolean; onGuidedChange(value: boolean): void }) {
  const t = useTranslations("learning");
  const locale = useLocale();
  const [track, setTrack] = useState<CodeTrack>("javascript");
  const [drafts, setDrafts] = useState<Drafts>({});
  const [ready, setReady] = useState(false);
  const [level, setLevel] = useState(0);
  const [status, setStatus] = useState<ExecutionStatus | "idle">("idle");
  const [output, setOutput] = useState("");
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewNotice, setReviewNotice] = useState("");
  const [previousCode, setPreviousCode] = useState<string | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const editorTarget = useTutorTarget<HTMLTextAreaElement>("code:ui:editor", "ui");
  const setEditor = useCallback((node: HTMLTextAreaElement | null) => {
    editor.current = node;
    return editorTarget(node);
  }, [editorTarget]);
  const preview = useRef<HTMLDivElement>(null);
  const running = useRef<RunHandle | null>(null);
  const abortReview = useRef<AbortController | null>(null);
  const version = useRef(0);
  const projectId = useRef("");
  const adapters = useRef<ReturnType<typeof createRunAdapters> | null>(null);
  const meta = TRACKS.find((item) => item.id === track)!;
  const code = drafts[track] ?? meta.samples[0];
  const busy = status !== "idle" && ACTIVE.has(status);

  useEffect(() => {
    projectId.current = crypto.randomUUID();
    try {
      const raw = JSON.parse(localStorage.getItem(CODE_SAVE_KEY) ?? "null");
      if (raw && typeof raw === "object") {
        const safe: Drafts = {};
        for (const item of TRACKS) if (typeof raw.drafts?.[item.id] === "string" && raw.drafts[item.id].length <= MAX_CODE_LENGTH) safe[item.id] = raw.drafts[item.id];
        setDrafts(safe);
        if (TRACKS.some((item) => item.id === raw.track)) setTrack(raw.track);
      }
    } catch { /* Optional local drafts. */ }
    setReady(true);
    return () => { version.current++; running.current?.stop(); abortReview.current?.abort(); tutor.clearGuidance(); };
  }, []);

  useEffect(() => {
    if (ready) try { localStorage.setItem(CODE_SAVE_KEY, JSON.stringify({ drafts, track })); } catch { /* Keep editing. */ }
  }, [drafts, track, ready]);

  useEffect(() => {
    // A review is written in one language. Do not leave a stale translated answer or request open.
    abortReview.current?.abort();
    setReview(null); setReviewNotice(""); setReviewing(false);
    tutor.clearGuidance();
  }, [locale]);

  function invalidate() {
    version.current++;
    running.current?.stop(); running.current = null;
    abortReview.current?.abort(); abortReview.current = null;
    setStatus("idle"); setResult(null); setOutput(""); setRuntimeLoading(false);
    setReview(null); setReviewNotice(""); setReviewing(false);
    tutor.clearGuidance();
  }
  function changeCode(value: string, keepUndo = false) {
    invalidate();
    setDrafts((old) => ({ ...old, [track]: value }));
    if (!keepUndo) setPreviousCode(null);
  }
  function changeTrack(value: CodeTrack) { invalidate(); setTrack(value); setLevel(0); setPreviousCode(null); }

  async function run() {
    invalidate();
    const revision = version.current;
    adapters.current ??= createRunAdapters();
    const handle = adapters.current[track]({ projectId: projectId.current, track, revision, files: [{ id: `${track}-main`, name: meta.file, language: track, content: code, order: 0 }] }, {
      previewContainer: preview.current ?? undefined,
      onOutput: (chunk) => { if (version.current === revision) setOutput((old) => (old + chunk.text).slice(-65000)); },
      onRuntimeLoading: (value) => { if (version.current === revision) setRuntimeLoading(value); },
    });
    running.current = handle; setStatus(handle.status());
    const unsubscribe = handle.subscribe((value) => { if (version.current === revision) setStatus(value); });
    const final = await handle.result;
    unsubscribe();
    if (version.current !== revision) return;
    setResult(final); setStatus(final.status); setRuntimeLoading(false);
    setOutput([final.stdout, final.stderr, final.compilerOutput].filter(Boolean).join("\n"));
    running.current = null;
  }

  function showRobot(answer: Review) {
    const revision = version.current;
    const text = { en: answer.explanation, ar: answer.explanation };
    void tutor.presentGuidance({ lab: "shell", context: {}, evidence: [{ kind: "topics", topics: [{
      id: `code.review.${version.current}`, title: { en: "Your code", ar: "الكود حقك" }, source: answer.source,
      levels: [{ text }, { text, target: { id: "code:ui:editor", kind: "ui" } }, { text, target: { id: "code:ui:editor", kind: "ui" } }],
    }] }] }).then((topics) => { if (topics && version.current === revision) { hintLadder.getState().setPanelOpen(true); hintLadder.getState().requestNextLevel(); } });
  }

  async function help() {
    const revision = version.current;
    abortReview.current?.abort();
    const controller = new AbortController(); abortReview.current = controller;
    setReviewing(true); setReviewNotice(""); setReview(null);
    const typo = suggestTypo(track, code);
    const diagnostic = result?.diagnostics.find((item) => item.severity === "error");
    const evidence = (diagnostic?.message ?? output).slice(0, 3000);
    const local: Review = {
      explanation: typo ? t("typoHelp", { token: typo.token }) : diagnostic ? t("errorHelp", { line: diagnostic.line ?? "?", message: diagnostic.message.slice(0, 600) }) : t("generalHelp"),
      correctedCode: typo?.code ?? null,
      line: typo?.line ?? diagnostic?.line ?? null,
      source: "rule_based",
    };
    let answer = local;
    try {
      const response = await fetch("/api/code/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ track, code, locale, diagnostic: evidence }), signal: controller.signal });
      const data = await response.json();
      if (version.current !== revision || controller.signal.aborted) return;
      if (response.ok && data.status === "reviewed") answer = { ...data.review, source: "ai" };
      else setReviewNotice(t(data.status === "not_configured" ? "aiNotConfigured" : "aiUnavailable"));
    } catch { if (controller.signal.aborted || version.current !== revision) return; setReviewNotice(t("aiUnavailable")); }
    if (version.current !== revision) return;
    setReview(answer); setReviewing(false); showRobot(answer);
  }

  function pointToError() {
    const line = review?.line ?? result?.diagnostics[0]?.line ?? 1;
    const lines = code.split("\n");
    const start = lines.slice(0, line - 1).reduce((n, part) => n + part.length + 1, 0);
    editor.current?.focus(); editor.current?.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
    hintLadder.getState().requestPoint({ id: "code:ui:editor", kind: "ui" });
  }

  function sample() { setPreviousCode(code); changeCode(meta.samples[level], true); }
  const statusKey = runtimeLoading ? "runtimeLoading" : busy ? (track === "html_css" && status === "running" ? "previewReady" : "running") : result ? result.status === "success" ? "runSuccess" : result.status === "runner_unavailable" ? "runnerUnavailable" : result.status === "cancelled" ? "stopped" : "runError" : "runReady";

  return <section id="programming" className={styles.programming} aria-labelledby="programming-title">
    <div className={styles.sectionLabel}><span>01 /</span> {t("codeSection")}</div>
    <div className={styles.sectionHeading}><div><h2 id="programming-title">{t("codeTitle")}</h2><p>{t("codeIntro")}</p></div><span className={styles.saved}>{t("autoSave")}</span></div>
    <div className={styles.toolbar}>
      <label>{t("language")}<select value={track} onChange={(event) => changeTrack(event.target.value as CodeTrack)}>{TRACKS.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <div className={styles.segmented} role="group" aria-label={t("learningMode")}><button type="button" aria-pressed={guided} onClick={() => onGuidedChange(true)}>{t("learn")}</button><button type="button" aria-pressed={!guided} onClick={() => onGuidedChange(false)}>{t("free")}</button></div>
    </div>
    {guided ? <div className={styles.lesson}>
      <label>{t("level")}<select value={level} onChange={(event) => setLevel(Number(event.target.value))}>{[0, 1, 2, 3].map((value) => <option value={value} key={value}>{t(`levels.${value}`)}</option>)}</select></label>
      <p>{t(track === "html_css" ? `webTasks.${level}` : `tasks.${level}`)}</p><button type="button" className={styles.secondary} onClick={sample}>{t("showExample")}</button>
    </div> : <p className={styles.freeNote}>{t("freeNote")}</p>}
    <div className={styles.editorGrid}>
      <div className={styles.editorPane}>
        <div className={styles.fileBar}><span dir="ltr">{meta.file}</span><span>{t("editable")}</span></div>
        <textarea ref={setEditor} value={code} onChange={(event) => changeCode(event.target.value)} maxLength={MAX_CODE_LENGTH} dir="ltr" aria-label={t("editor")} spellCheck={false} autoCapitalize="off" autoCorrect="off" onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void run(); }
        }} />
        <div className={styles.runBar}><button type="button" className={styles.primary} disabled={!ready || !code.trim()} onClick={() => void run()}>{t("run")} <span aria-hidden="true">▶</span></button>{busy && <button type="button" className={styles.secondary} onClick={() => running.current?.stop()}>{t("stop")}</button>}<button type="button" className={styles.helpButton} disabled={reviewing || !ready || !code.trim()} onClick={() => void help()}>{t(reviewing ? "reviewing" : "askRobot")}</button></div>
      </div>
      <div className={styles.outputPane}><h3>{t(track === "html_css" ? "preview" : "output")}</h3><p role="status" data-status={status} className={styles.runStatus}>{t(statusKey)}</p>
        <div ref={preview} className={styles.preview} hidden={track !== "html_css"} />
        {output ? <pre dir="ltr" className={styles.output}>{output}</pre> : track !== "html_css" && <p className={styles.emptyOutput}>{t("outputEmpty")}</p>}
        {result && result.status !== "success" && result.status !== "cancelled" && <button type="button" className={styles.secondary} disabled={reviewing} onClick={() => void help()}>{t("explainError")}</button>}
      </div>
    </div>
    {(review || reviewNotice) && <aside className={styles.review} aria-label={t("reviewTitle")} aria-live="polite">
      <div className={styles.reviewHeading}><span aria-hidden="true">✦</span><strong>{t("reviewTitle")}</strong><small>{t(review?.source === "ai" ? "aiReview" : "builtInReview")}</small></div>
      {reviewNotice && <p className={styles.notice}>{reviewNotice}</p>}
      {review && <><p>{review.explanation}</p><div className={styles.links}>
        {review.line && <button type="button" className={styles.secondary} onClick={pointToError}>{t("showWhere", { line: review.line })}</button>}
        {review.correctedCode && review.correctedCode !== code && <button type="button" className={styles.primary} onClick={() => { const correction = review.correctedCode!; setPreviousCode(code); changeCode(correction, true); }}>{t("applyFix")}</button>}
      </div>{review.correctedCode && review.correctedCode !== code && <details><summary>{t("seeFix")}</summary><pre dir="ltr">{review.correctedCode}</pre></details>}</>}
    </aside>}
    {previousCode !== null && <button type="button" className={styles.undo} onClick={() => { const old = previousCode; changeCode(old); }}>{t("undo")}</button>}
    <p className={styles.privacy}>{t("privacy")}</p>
  </section>;
}
