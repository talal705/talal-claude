"use client";

import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { pc } from "@ytl/simulation";
import { useReducedMotion } from "@/lib/interaction";
import { useTutorTarget } from "@/lib/targets";
import { CheckIcon, CrossIcon } from "../icons";
import { BuildCompanion, type CompanionMessage } from "./BuildCompanion";
import { pcCatalog } from "./catalog";
import { askCompanionAi, companionAskRequest, fetchTutorStatus, type AiStatus } from "./companion-ai";
import { buildContext, companionSay, intentOf, nextLine, topicOf, type CompanionEvent, type CompanionSay, type Selection } from "./companion";
import { moveCamera, selectPart } from "./scene/scene-store";
import {
  connectSimpleCable, createSimpleBuild, disconnectSimpleCable, emptySimpleSnapshot, installSimplePart, isRamKey, lastSimpleStep, parseSimpleSnapshot,
  SIMPLE_CABLES, SIMPLE_PARTS, SIMPLE_SAVE_KEY, simpleAssemblyComplete, simpleBlock, simpleBuildFromSnapshot, simpleCableBlock, simpleCableConnected,
  simplePartInstalled, simpleTarget, startSimplePC, undoSimpleStep, withCable, withoutCable, withPart,
  type SimpleCableKey, type SimplePartKey, type SimpleSnapshot,
} from "./simple-model";
import { cableOfPort, simpleBenchLayout, simpleSceneTargets } from "./simple-scene";
import styles from "./simple-pc.module.css";

const CABLE_IDS = SIMPLE_CABLES.map((c) => c.id);
const partSpec = (key: SimplePartKey) => SIMPLE_PARTS.find((p) => p.key === key)!;
const cableSpec = (key: SimpleCableKey) => SIMPLE_CABLES.find((c) => c.key === key)!;
// Computed once: where every part lies on the bench at the start, and the second stick beside the first.
const BENCH = simpleBenchLayout(createSimpleBuild());

const PcScene = dynamic(() => import("./scene/PcScene"), { ssr: false });

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode; resetKey: number }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: { resetKey: number }) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function supportsWebgl(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    // The capability probe is not a renderer; release it immediately.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(gl);
  } catch { return false; }
}

declare global {
  interface Window {
    /** Read-only view of the guided build for browser automation: what is fitted, selected and said. */
    __ytlSimplePc?: () => { placed: string[]; connected: string[]; history: string[]; powered: boolean; selection: Selection; complete: boolean; mood: string; lines: string[] };
  }
}

/** `aiConfigured` comes from the server (as for the page tutor): without a provider the page never asks the AI routes. */
export function SimplePcLab({ embedded = false, aiConfigured = false }: { embedded?: boolean; aiConfigured?: boolean }) {
  const t = useTranslations("simplePc");
  const locale = useLocale();
  const reducedMotion = useReducedMotion();
  const [saved, setSaved] = useState<SimpleSnapshot>(emptySimpleSnapshot);
  const [ready, setReady] = useState(false);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<"parts" | "cables">("parts");
  const [verdict, setVerdict] = useState<"success" | "failure" | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [message, setMessage] = useState<CompanionMessage>({ id: 0, say: { lines: [{ key: "hello" }], mood: "wave" } });
  const [ai, setAi] = useState<AiStatus>("unknown");
  const [thinking, setThinking] = useState(false);
  const cablesTarget = useTutorTarget<HTMLDivElement>("pc:ui:simple-cables", "ui");
  const partsTarget = useTutorTarget<HTMLDivElement>("pc:ui:simple-parts", "ui");
  const asking = useRef<AbortController | null>(null);

  const state = useMemo(() => simpleBuildFromSnapshot(saved), [saved]);
  const startup = useMemo(() => pc.evaluateStartup(state, pcCatalog), [state]);
  const targets = useMemo(() => simpleSceneTargets(state, selection), [state, selection]);
  const progress = SIMPLE_PARTS.filter((p) => simplePartInstalled(state, p.key)).length;
  const cableProgress = SIMPLE_CABLES.filter((c) => simpleCableConnected(state, c.key)).length;
  const complete = saved.powered && simpleAssemblyComplete(state);

  /** The robot speaks: a new bubble, from the build as it is after the action. */
  const speak = useCallback((say: CompanionSay, extra: Partial<CompanionMessage> = {}) => {
    setMessage((previous) => ({ id: previous.id + 1, say, ...extra }));
  }, []);
  const react = useCallback((event: CompanionEvent, after = state, powered = saved.powered, inHand: Selection = selection) => {
    speak(companionSay(event, after, powered, inHand));
  }, [speak, state, saved.powered, selection]);

  useEffect(() => {
    let restored: SimpleSnapshot | null = null;
    try {
      const raw = localStorage.getItem(SIMPLE_SAVE_KEY);
      restored = raw ? parseSimpleSnapshot(JSON.parse(raw)) : null;
    } catch { /* Storage is optional; assembly still works in memory. */ }
    const snapshot = restored ?? emptySimpleSnapshot();
    if (restored) {
      setSaved(restored);
      setVerdict(restored.powered ? "success" : null);
      if (restored.placed.length === SIMPLE_PARTS.length) setTab("cables");
    }
    speak(companionSay(snapshot.history.length > 0 ? { type: "resume" } : { type: "start" }, simpleBuildFromSnapshot(snapshot), snapshot.powered, null));
    setWebgl(supportsWebgl());
    setReady(true);
    const controller = new AbortController();
    if (aiConfigured) void fetchTutorStatus(fetch, controller.signal).then(setAi);
    else setAi("not_configured");
    return () => { controller.abort(); asking.current?.abort(); };
  }, [speak, aiConfigured]);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(SIMPLE_SAVE_KEY, JSON.stringify(saved)); } catch { /* Keep working. */ }
  }, [ready, saved]);

  // The 3D view marks the part in hand (and nothing while a lead or nothing is in hand).
  useEffect(() => {
    selectPart(selection?.kind === "part" ? partSpec(selection.key).id : null);
  }, [selection, sceneVersion]);

  useEffect(() => {
    window.__ytlSimplePc = () => ({
      placed: [...saved.placed], connected: [...saved.connected], history: [...saved.history], powered: saved.powered, selection, complete,
      mood: message.say.mood, lines: message.say.lines.map((line) => line.key),
    });
    return () => { delete window.__ytlSimplePc; };
  }, [saved, selection, complete, message]);

  // ---------- Learner actions ----------

  function choosePart(key: SimplePartKey) {
    setConfirmRestart(false);
    if (selection?.kind === "part" && selection.key === key) { cancel(); return; }
    const next: Selection = { kind: "part", key };
    setSelection(next);
    setTab("parts");
    if (saved.powered) { speak({ lines: [{ key: "blocked.turnOff" }], mood: "concerned", point: "power" }); return; }
    react({ type: "select", selection: next }, state, saved.powered, next);
  }

  function chooseCable(key: SimpleCableKey) {
    setConfirmRestart(false);
    if (selection?.kind === "cable" && selection.key === key) { cancel(); return; }
    const next: Selection = { kind: "cable", key };
    setSelection(next);
    setTab("cables");
    react({ type: "select", selection: next }, state, saved.powered, next);
  }

  function cancel() {
    if (!selection) return;
    setSelection(null);
    react({ type: "cancel" }, state, saved.powered, null);
  }

  function install(key: SimplePartKey) {
    if (saved.powered) return;
    const step = installSimplePart(state, key);
    if (!step.ok) { react({ type: "select", selection: { kind: "part", key } }); return; }
    if (simplePartInstalled(state, key)) return;
    setSaved((previous) => withPart(previous, key));
    setSelection(null);
    setVerdict(null);
    if (SIMPLE_PARTS.every((p) => simplePartInstalled(step.state, p.key))) setTab("cables");
    react({ type: "installed", key }, step.state, false, null);
  }

  function connect(key: SimpleCableKey) {
    if (saved.powered) { react({ type: "select", selection: { kind: "cable", key } }); return; }
    const step = connectSimpleCable(state, key);
    if (!step.ok) { react({ type: "select", selection: { kind: "cable", key } }); return; }
    if (simpleCableConnected(state, key)) return;
    setSaved((previous) => withCable(previous, key));
    setSelection(null);
    setVerdict(null);
    react({ type: "connected", key }, step.state, false, null);
  }

  function unplug(key: SimpleCableKey) {
    const step = disconnectSimpleCable(state, key);
    if (!step.ok) { speak({ lines: [{ key: "blocked.turnOff" }], mood: "concerned", point: "power" }); return; }
    setSaved((previous) => withoutCable(previous, key));
    setVerdict(null);
    react({ type: "unplugged", key }, step.state, false, selection);
  }

  function onTarget(id: string) {
    if (!selection) return;
    const [role, place] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
    if (role === "target") {
      if (selection.kind === "part") install(selection.key);
      else connect(selection.key);
      return;
    }
    if (selection.kind === "part") react({ type: "wrongPlace", key: selection.key, place });
    else react({ type: "wrongPort", key: selection.key, portOf: cableOfPort(place) });
  }

  function onScenePart(instanceId: string) {
    const part = SIMPLE_PARTS.find((p) => p.id === instanceId);
    if (part && !simplePartInstalled(state, part.key)) { choosePart(part.key); return; }
    // An installed part, the case or a case fan: not a place for what is in hand, and not something to pick up.
    if (selection?.kind === "part") react({ type: "wrongPlace", key: selection.key, place: instanceId });
    else if (selection?.kind === "cable") react({ type: "wrongPort", key: selection.key, portOf: null });
    else react({ type: "notSelectable" });
  }

  function onSceneCable(cableId: string) {
    const cable = SIMPLE_CABLES.find((c) => c.id === cableId);
    if (cable) chooseCable(cable.key);
  }

  function undo() {
    setConfirmRestart(false);
    const step = lastSimpleStep(saved);
    const next = undoSimpleStep(saved);
    if (!step || !next) { react({ type: "nothingToUndo" }); return; }
    const after = simpleBuildFromSnapshot(next);
    setSaved(next);
    setSelection(null);
    setVerdict(null);
    if (step.startsWith("part:")) setTab("parts");
    react({ type: "undo", step }, after, false, null);
  }

  function restart() {
    setSaved(emptySimpleSnapshot());
    setVerdict(null);
    setSelection(null);
    setTab("parts");
    setConfirmRestart(false);
    setSceneVersion((n) => n + 1);
    if (webgl === false) setWebgl(supportsWebgl());
    react({ type: "restart" }, createSimpleBuild(), false, null);
  }

  function power() {
    setConfirmRestart(false);
    if (saved.powered) {
      setSaved((previous) => ({ ...previous, powered: false }));
      setVerdict(null);
      const off = simpleBuildFromSnapshot({ ...saved, powered: false });
      react({ type: "powerOff" }, off, false, selection);
      return;
    }
    const result = startSimplePC(state);
    setVerdict(result.ok ? "success" : "failure");
    setSelection(null);
    if (result.ok) {
      setSaved((previous) => ({ ...previous, powered: true }));
      react({ type: "powerOn" }, result.state, true, null);
      return;
    }
    const missing = SIMPLE_CABLES.find((c) => c.essential && !simpleCableConnected(state, c.key))?.key ?? null;
    if (progress === SIMPLE_PARTS.length) setTab("cables");
    react({ type: "powerFail", missingCable: missing }, state, false, null);
  }

  function quick(intent: "next" | "help" | "explain") {
    react({ type: "ask", intent });
  }

  async function ask(text: string) {
    const intent = intentOf(text);
    if (intent === "undo") { undo(); return; }
    // A question that names a part or lead ("why does RAM go in A2?") is answered about that part.
    const topic = topicOf(text);
    if (topic && intent !== "next" && (intent || ai !== "available")) { speak({ lines: [{ key: `explain.${topic}` }], mood: "thinking", point: "scene" }, { question: text }); return; }
    if (intent) { speak(companionSay({ type: "ask", intent }, state, saved.powered, selection), { question: text }); return; }
    if (ai !== "available") { speak(companionSay({ type: "question", text }, state, saved.powered, selection), { question: text }); return; }
    asking.current?.abort();
    const controller = new AbortController();
    asking.current = controller;
    setThinking(true);
    const next = nextLine(state, saved.powered);
    const nextText = t(`companion.${next.key}`, next.values && "cable" in next.values && typeof next.values.cable === "object" && "cable" in next.values.cable ? { cable: t(`cables.${next.values.cable.cable}.name`) } : {});
    const answer = await askCompanionAi(companionAskRequest(text, locale === "ar" ? "ar" : "en", buildContext(state, saved.powered, selection), nextText), fetch, controller.signal);
    if (controller.signal.aborted) return;
    setThinking(false);
    if (answer.ok) speak({ lines: [], mood: "idle" }, { question: text, aiText: answer.text });
    else speak({ lines: [{ key: "aiError" }, next], mood: "thinking" }, { question: text });
  }

  // Escape puts down what is in hand, from anywhere in the lab.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && selection) { event.preventDefault(); cancel(); }
  };

  // ---------- What the panel shows ----------

  const selectedPart = selection?.kind === "part" ? selection.key : null;
  const selectedCable = selection?.kind === "cable" ? selection.key : null;
  const partInstalled = selectedPart ? simplePartInstalled(state, selectedPart) : false;
  const partBlocked = selectedPart ? simpleBlock(state, selectedPart) : null;
  const cableDone = selectedCable ? simpleCableConnected(state, selectedCable) : false;
  const cableBlocked = selectedCable ? simpleCableBlock(state, selectedCable) : null;
  const firstMissingCable = SIMPLE_CABLES.find((c) => c.essential && !simpleCableConnected(state, c.key));
  const missingMessage = progress < SIMPLE_PARTS.length ? t("missing") : firstMissingCable ? t("missingCable", { cable: t(`cables.${firstMissingCable.key}.name`) }) : t("checkCables");
  const placeName = (key: SimplePartKey) => t(`companion.places.${simpleTarget(state, key).mountPointId}`);
  const summary = complete ? {
    parts: SIMPLE_PARTS.map((p) => (isRamKey(p.key) ? `${t(`parts.${p.key}`)} · ${placeName(p.key)}` : t(`parts.${p.key}`))),
    cables: SIMPLE_CABLES.map((c) => t(`cables.${c.key}.name`)),
  } : null;
  const canUndo = Boolean(lastSimpleStep(saved));

  return (
    <section className={styles.lab} aria-labelledby="simple-pc-title" onKeyDown={onKeyDown}>
      <header className={styles.heading}>
        <div>{embedded ? <h2 id="simple-pc-title">{t("title")}</h2> : <h1 id="simple-pc-title">{t("title")}</h1>}<p>{t("intro")}</p></div>
        <span className={styles.progress} aria-label={t("progress", { count: progress, total: SIMPLE_PARTS.length })}>{progress}<span> / {SIMPLE_PARTS.length}</span></span>
      </header>

      <div className={styles.workspace}>
        <div className={styles.viewer}>
          <div className={styles.viewControls} role="group" aria-label={t("camera")}>
            <button type="button" onClick={() => moveCamera("fit")}>{t("center")}</button>
            <button type="button" aria-label={t("zoomIn")} onClick={() => moveCamera("in")}>+</button>
            <button type="button" aria-label={t("zoomOut")} onClick={() => moveCamera("out")}>−</button>
          </div>
          <div className={styles.canvas} role="group" tabIndex={0} aria-label={t("scene")} onKeyDown={(event) => {
            const commands = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", "+": "in", "-": "out" } as const;
            const command = commands[event.key as keyof typeof commands];
            if (command && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); moveCamera(command); }
          }}>
            {webgl === null ? <p className={styles.fallback}>{t("loading")}</p> : webgl === false ? <p className={styles.fallback}>{t("no3d")}</p> : (
              <SceneBoundary resetKey={sceneVersion} fallback={<p className={styles.fallback}>{t("no3d")}</p>}>
                <PcScene
                  simple
                  viewId={`simple-${sceneVersion}`}
                  state={state}
                  startup={startup}
                  reducedMotion={reducedMotion}
                  noModel={t("part")}
                  rtl={locale === "ar"}
                  onSelectPart={onScenePart}
                  simpleCableIds={CABLE_IDS}
                  selectedSimpleCableId={selectedCable ? cableSpec(selectedCable).id : null}
                  onSelectSimpleCable={onSceneCable}
                  simpleTargets={targets}
                  onSimpleTarget={onTarget}
                  onSimpleMiss={() => { if (selection) react({ type: "missedTarget" }); }}
                  benchOrder={BENCH.benchOrder}
                  beside={BENCH.beside}
                  onContextLost={() => setWebgl(false)}
                />
              </SceneBoundary>
            )}
          </div>
          <p className={styles.cameraHint}>{t("cameraHint")}</p>
        </div>

        <div className={styles.side}>
          <div className={styles.companionSlot}>
            <BuildCompanion message={message} ai={ai} thinking={thinking} reducedMotion={reducedMotion} onQuick={quick} onAsk={(text) => void ask(text)} summary={summary} />
          </div>

          <div className={styles.controls}>
            <div className={styles.tabs} role="group" aria-label={t("assemblySteps")}>
              <button type="button" aria-pressed={tab === "parts"} onClick={() => setTab("parts")}>{t("partsTab")} <span dir="ltr">{t("progressShort", { count: progress, total: SIMPLE_PARTS.length })}</span></button>
              <button type="button" aria-pressed={tab === "cables"} onClick={() => setTab("cables")}>{t("cablesTab")} <span dir="ltr">{t("progressShort", { count: cableProgress, total: SIMPLE_CABLES.length })}</span></button>
            </div>

            <div hidden={tab !== "parts"}>
              <div ref={partsTarget} className={styles.parts} role="group" aria-label={t("partsLabel")}>
                {SIMPLE_PARTS.map((part) => {
                  const done = simplePartInstalled(state, part.key);
                  const active = selectedPart === part.key;
                  return <button key={part.key} type="button" className={styles.part} data-selected={active} data-installed={done} aria-pressed={active} onClick={() => choosePart(part.key)}>
                    <img src={`/assets/pc/thumbnails/${part.catalogId}.svg`} alt="" width={58} height={44} />
                    <span>{t(`parts.${part.key}`)}</span>
                    {done && <CheckIcon />}
                  </button>;
                })}
              </div>

              <div className={styles.install}>
                {selectedPart ? <>
                  <div className={styles.selection}><strong>{t(`parts.${selectedPart}`)}</strong><span>{partInstalled ? t("installed") : placeName(selectedPart)}</span></div>
                  <button className={styles.installButton} type="button" onClick={() => install(selectedPart)} disabled={!ready || partInstalled || Boolean(partBlocked) || saved.powered}>{partInstalled ? t("installed") : t("install")}</button>
                  {partBlocked && !partInstalled && <p className={styles.hint}>{t(partBlocked)}</p>}
                  <button className={styles.cancel} type="button" onClick={cancel}>{t("cancel")}</button>
                </> : <p className={styles.hint}>{t("selectFirst")}</p>}
              </div>
            </div>

            <div ref={cablesTarget} hidden={tab !== "cables"}>
              <p className={styles.cablesIntro}>{t("cablesIntro")}</p>
              <div className={styles.cables} role="group" aria-label={t("cablesLabel")}>
                {SIMPLE_CABLES.map((item) => {
                  const done = simpleCableConnected(state, item.key);
                  const active = selectedCable === item.key;
                  return <button type="button" key={item.key} className={styles.cable} data-selected={active} data-connected={done} aria-pressed={active} onClick={() => chooseCable(item.key)}>
                    <span className={styles.wireIcon} aria-hidden="true">↳</span>
                    <span>{t(`cables.${item.key}.name`)}{!item.essential && <small>{t("fanOptional")}</small>}</span>
                    {done ? <CheckIcon /> : <span className={styles.unplugged}>{t("loose")}</span>}
                  </button>;
                })}
              </div>
              {selectedCable && <div className={styles.cableDetail}>
                <strong>{t(`cables.${selectedCable}.name`)}</strong>
                <p>{t(`cables.${selectedCable}.route`)}</p>
                <code dir="ltr">{t(`cables.${selectedCable}.connector`)}</code>
                <button className={styles.installButton} type="button" onClick={() => cableDone ? unplug(selectedCable) : connect(selectedCable)} disabled={!ready || saved.powered || (!cableDone && Boolean(cableBlocked))}>{cableDone ? t("disconnect") : t("connect")}</button>
                {cableBlocked && !cableDone && <p className={styles.hint}>{cableBlocked === "turnOffFirst" ? t("turnOffFirst") : t("fitCableParts", { parts: cableSpec(selectedCable).requires.map((key) => t(`parts.${key}`)).join(locale === "ar" ? "، " : ", ") })}</p>}
                {saved.powered && cableDone && <p className={styles.hint}>{t("turnOffFirst")}</p>}
                <button className={styles.cancel} type="button" onClick={cancel}>{t("cancel")}</button>
              </div>}
              <p className={styles.cablesNote}>{t("noStorageCable")}</p>
            </div>

            <div className={styles.power}>
              <div className={styles.result} data-result={verdict ?? "idle"} role="status" aria-live="polite">
                {verdict === "success" ? <><CheckIcon /><strong>{t("success")}</strong></> : verdict === "failure" ? <><CrossIcon /><div><strong>{t("failure")}</strong><p>{missingMessage}</p></div></> : <span>{t("readyToTry")}</span>}
              </div>
              <button className={styles.powerButton} type="button" onClick={power} disabled={!ready}><span aria-hidden="true">⏻</span>{t(saved.powered ? "powerOff" : "power")}</button>
              <div className={styles.steps}>
                <button type="button" onClick={undo} disabled={!ready || !canUndo}>{t("undo")}</button>
                {!confirmRestart ? <button type="button" onClick={() => setConfirmRestart(true)} disabled={!ready}>{t("reset")}</button> : null}
              </div>
              {confirmRestart && <div className={styles.confirm} role="alertdialog" aria-label={t("restartAsk")}>
                <p>{t("restartAsk")}</p>
                <div><button type="button" onClick={restart}>{t("restartYes")}</button><button type="button" onClick={() => setConfirmRestart(false)}>{t("restartNo")}</button></div>
              </div>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
