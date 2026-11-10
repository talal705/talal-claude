"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { pc } from "@ytl/simulation";
import { useReducedMotion } from "@/lib/interaction";
import { tutor } from "@/lib/interaction/advisor";
import { useTutorTarget } from "@/lib/targets";
import { CheckIcon, CrossIcon } from "../icons";
import { pcCatalog } from "./catalog";
import { moveCamera, selectPart } from "./scene/scene-store";
import { connectSimpleCable, disconnectSimpleCable, emptySimpleSnapshot, installSimplePart, parseSimpleSnapshot, SIMPLE_CABLES, SIMPLE_PARTS, SIMPLE_SAVE_KEY, simpleBlock, simpleBuildFromSnapshot, simpleCableBlock, simpleCableConnected, simplePartInstalled, startSimplePC, type SimpleCableKey, type SimplePartKey, type SimpleSnapshot } from "./simple-model";
import styles from "./simple-pc.module.css";

const CABLE_IDS = SIMPLE_CABLES.map((c) => c.id);

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

export function SimplePcLab({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations("simplePc");
  const locale = useLocale();
  const reducedMotion = useReducedMotion();
  const [saved, setSaved] = useState<SimpleSnapshot>(emptySimpleSnapshot);
  const [ready, setReady] = useState(false);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<SimplePartKey>("cpu");
  const [tab, setTab] = useState<"parts" | "cables">("parts");
  const [selectedCable, setSelectedCable] = useState<SimpleCableKey>("atx");
  const [cableError, setCableError] = useState(false);
  const [verdict, setVerdict] = useState<"success" | "failure" | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const cablesTarget = useTutorTarget<HTMLDivElement>("pc:ui:simple-cables", "ui");
  const partsTarget = useTutorTarget<HTMLDivElement>("pc:ui:simple-parts", "ui");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIMPLE_SAVE_KEY);
      const restored = raw ? parseSimpleSnapshot(JSON.parse(raw)) : null;
      if (restored) { setSaved(restored); setVerdict(restored.powered ? "success" : null); if (restored.placed.length === SIMPLE_PARTS.length) setTab("cables"); }
    } catch { /* Storage is optional; assembly still works in memory. */ }
    setWebgl(supportsWebgl());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(SIMPLE_SAVE_KEY, JSON.stringify(saved)); } catch { /* Keep working. */ }
  }, [ready, saved]);

  useEffect(() => {
    selectPart(SIMPLE_PARTS.find((p) => p.key === selected)!.id);
  }, [selected, sceneVersion]);

  const state = useMemo(() => simpleBuildFromSnapshot(saved), [saved]);
  const startup = useMemo(() => pc.evaluateStartup(state, pcCatalog), [state]);
  const progress = SIMPLE_PARTS.filter((p) => simplePartInstalled(state, p.key)).length;
  const installed = simplePartInstalled(state, selected);
  const blocked = simpleBlock(state, selected);
  const cable = SIMPLE_CABLES.find((c) => c.key === selectedCable)!;
  const cableDone = simpleCableConnected(state, selectedCable);
  const cableBlocked = simpleCableBlock(state, selectedCable);
  const cableProgress = SIMPLE_CABLES.filter((c) => simpleCableConnected(state, c.key)).length;
  const firstMissingCable = SIMPLE_CABLES.find((c) => c.essential && !simpleCableConnected(state, c.key));
  const missingMessage = progress < SIMPLE_PARTS.length ? t("missing") : firstMissingCable ? t("missingCable", { cable: t(`cables.${firstMissingCable.key}.name`) }) : t("checkCables");

  function guide(success = false, section: "parts" | "cables" = tab) {
    const title = { en: "Build your PC", ar: "ركّب كمبيوترك" };
    const first = success ? { en: "It works! Your PC passed its startup checks.", ar: "اشتغل! الكمبيوتر اجتاز فحص التشغيل." } : section === "cables" ? { en: "Pick a cable. Its name and destination are shown below. Connect it with the button or the highlighted socket in the 3D view.", ar: "اختَر سلك. اسمه ومكان توصيله ظاهرين تحت. وصّله بالزر أو اضغط المنفذ المضيء في المجسّم." } : { en: "Select a part, then choose Fit this part. Prepare the motherboard before placing it in the case.", ar: "اختَر قطعة واضغط ركّبها. جهّز اللوحة الأم قبل ما تحطها في الكيس." };
    const next = section === "cables" ? { en: "Connect motherboard power, CPU power, graphics power, CPU_FAN and the power button. The two case fan leads power their fans; they are not required to boot. Turn the PC off before changing a cable.", ar: "وصّل طاقة اللوحة والمعالج وكرت الشاشة ومروحة المبرّد وزر التشغيل. سلكا مراوح الكيس يشغّلان مراوحها، لكن ما يمنعان الإقلاع. طفّ الجهاز قبل تغيير سلك." } : { en: "Start with the processor, memory, storage and cooler. Next fit the board, graphics card and power supply, then connect their cables.", ar: "ابدأ بالمعالج والرام والتخزين والمبرّد. بعدها ركّب اللوحة وكرت الشاشة والباور، ثم وصّل الأسلاك." };
    const target = { id: section === "cables" ? "pc:ui:simple-cables" : "pc:ui:simple-parts", kind: "ui" as const };
    void tutor.presentGuidance({ lab: "shell", context: {}, evidence: [{ kind: "topics", topics: [{ id: `simple.pc.${section}.${success}`, title, source: "rule_based", levels: [{ text: first }, { text: next, target }, { text: success ? first : next, target }] }] }] });
  }

  function install() {
    if (installed || saved.powered) return;
    const step = installSimplePart(state, selected);
    if (!step.ok) return;
    setSaved((previous) => ({ ...previous, placed: [...previous.placed, selected] }));
    setVerdict(null);
    const next = SIMPLE_PARTS.find((p) => !simplePartInstalled(step.state, p.key) && !simpleBlock(step.state, p.key));
    if (next) setSelected(next.key);
    else { setTab("cables"); setSelectedCable("atx"); }
    guide(false, next ? "parts" : "cables");
  }

  function powerOn() {
    if (saved.powered) { setSaved((previous) => ({ ...previous, powered: false })); setVerdict(null); return; }
    const result = startSimplePC(state);
    setVerdict(result.ok ? "success" : "failure");
    if (result.ok) setSaved((previous) => ({ ...previous, powered: true }));
    if (!result.ok && progress === SIMPLE_PARTS.length) { setTab("cables"); if (firstMissingCable) setSelectedCable(firstMissingCable.key); }
    guide(result.ok, progress === SIMPLE_PARTS.length ? "cables" : "parts");
  }

  function reset() {
    setSaved(emptySimpleSnapshot());
    setVerdict(null);
    setSelected("cpu");
    setTab("parts");
    setSelectedCable("atx");
    setCableError(false);
    setSceneVersion((n) => n + 1);
    if (webgl === false) setWebgl(supportsWebgl());
    guide();
  }

  function onSelectPart(instanceId: string) {
    const part = SIMPLE_PARTS.find((p) => p.id === instanceId);
    if (part) { setSelected(part.key); setTab("parts"); }
  }

  function chooseCable(id: string) {
    const chosen = SIMPLE_CABLES.find((c) => c.id === id);
    if (chosen) { setTab("cables"); setSelectedCable(chosen.key); setCableError(false); }
  }

  function connectCable(id: string = cable.id) {
    const chosen = SIMPLE_CABLES.find((c) => c.id === id);
    if (!chosen || saved.powered) return;
    const step = connectSimpleCable(state, chosen.key);
    setCableError(!step.ok);
    if (!step.ok) return;
    setSaved((previous) => ({ ...previous, connected: previous.connected.includes(chosen.key) ? previous.connected : [...previous.connected, chosen.key] }));
    setVerdict(null);
  }

  function unplugCable() {
    const step = disconnectSimpleCable(state, selectedCable);
    setCableError(!step.ok);
    if (!step.ok) return;
    setSaved((previous) => ({ ...previous, connected: previous.connected.filter((key) => key !== selectedCable) }));
    setVerdict(null);
  }

  return (
    <section className={styles.lab} aria-labelledby="simple-pc-title">
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
                <PcScene simple viewId={`simple-${sceneVersion}`} state={state} startup={startup} reducedMotion={reducedMotion} noModel={t("part")} rtl={locale === "ar"} onSelectPart={onSelectPart} simpleCableIds={CABLE_IDS} selectedSimpleCableId={tab === "cables" ? cable.id : null} simpleCableTarget={tab === "cables" && !cableDone && !cableBlocked ? { instanceId: cable.instanceId, portId: cable.portId } : null} onSelectSimpleCable={chooseCable} onConnectSimpleCable={connectCable} onContextLost={() => setWebgl(false)} />
              </SceneBoundary>
            )}
          </div>
          <p className={styles.cameraHint}>{t("cameraHint")}</p>
        </div>

        <div className={styles.controls}>
          <div className={styles.tabs} role="group" aria-label={t("assemblySteps")}>
            <button type="button" aria-pressed={tab === "parts"} onClick={() => setTab("parts")}>{t("partsTab")} <span dir="ltr">{progress}/7</span></button>
            <button type="button" aria-pressed={tab === "cables"} onClick={() => setTab("cables")}>{t("cablesTab")} <span dir="ltr">{cableProgress}/{SIMPLE_CABLES.length}</span></button>
          </div>
          <div hidden={tab !== "parts"}>
          <div ref={partsTarget} className={styles.parts} role="group" aria-label={t("partsLabel")}>
            {SIMPLE_PARTS.map((part) => {
              const done = simplePartInstalled(state, part.key);
              return <button key={part.key} type="button" className={styles.part} data-selected={selected === part.key} data-installed={done} aria-pressed={selected === part.key} onClick={() => setSelected(part.key)}>
                <img src={`/assets/pc/thumbnails/${part.catalogId}.svg`} alt="" width={58} height={44} />
                <span>{t(`parts.${part.key}`)}</span>
                {done && <CheckIcon />}
              </button>;
            })}
          </div>

          <div className={styles.install}>
            <div className={styles.selection}><strong>{t(`parts.${selected}`)}</strong><span>{installed ? t("installed") : t(selected === "motherboard" || selected === "psu" ? "inCase" : "onBoard")}</span></div>
            <button className={styles.installButton} type="button" onClick={install} disabled={!ready || installed || Boolean(blocked) || saved.powered}>{installed ? t("installed") : t("install")}</button>
            {blocked && !installed && <p className={styles.hint}>{t(blocked)}</p>}
          </div>

          </div>

          <div ref={cablesTarget} hidden={tab !== "cables"}>
            <p className={styles.cablesIntro}>{t("cablesIntro")}</p>
            <div className={styles.cables} role="group" aria-label={t("cablesLabel")}>
              {SIMPLE_CABLES.map((item) => {
                const done = simpleCableConnected(state, item.key);
                return <button type="button" key={item.key} className={styles.cable} data-selected={selectedCable === item.key} data-connected={done} aria-pressed={selectedCable === item.key} onClick={() => chooseCable(item.id)}>
                  <span className={styles.wireIcon} aria-hidden="true">↳</span>
                  <span>{t(`cables.${item.key}.name`)}{!item.essential && <small>{t("fanOptional")}</small>}</span>
                  {done ? <CheckIcon /> : <span className={styles.unplugged}>{t("loose")}</span>}
                </button>;
              })}
            </div>
            <div className={styles.cableDetail}>
              <strong>{t(`cables.${selectedCable}.name`)}</strong>
              <p>{t(`cables.${selectedCable}.route`)}</p>
              <code dir="ltr">{t(`cables.${selectedCable}.connector`)}</code>
              <button className={styles.installButton} type="button" onClick={() => cableDone ? unplugCable() : connectCable()} disabled={!ready || saved.powered || (!cableDone && Boolean(cableBlocked))}>{cableDone ? t("disconnect") : t("connect")}</button>
              {cableBlocked && !cableDone && <p className={styles.hint}>{cableBlocked === "turnOffFirst" ? t("turnOffFirst") : t("fitCableParts", { parts: cable.requires.map((key) => t(`parts.${key}`)).join(locale === "ar" ? "، " : ", ") })}</p>}
              {saved.powered && cableDone && <p className={styles.hint}>{t("turnOffFirst")}</p>}
              {cableError && <p className={styles.hint} role="alert">{t("cannotConnect")}</p>}
            </div>
            <p className={styles.cablesNote}>{t("noStorageCable")}</p>
          </div>

          <div className={styles.power}>
            <div className={styles.result} data-result={verdict ?? "idle"} role="status" aria-live="polite">
              {verdict === "success" ? <><CheckIcon /><strong>{t("success")}</strong></> : verdict === "failure" ? <><CrossIcon /><div><strong>{t("failure")}</strong><p>{missingMessage}</p></div></> : <span>{t("readyToTry")}</span>}
            </div>
            <button className={styles.powerButton} type="button" onClick={powerOn} disabled={!ready}><span aria-hidden="true">⏻</span>{t(saved.powered ? "powerOff" : "power")}</button>
            <button className={styles.reset} type="button" onClick={reset}>{t("reset")}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
