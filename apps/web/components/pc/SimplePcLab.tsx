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
import { focusOn, moveCamera, selectPart } from "./scene/scene-store";
import {
  ALL_SIMPLE_CABLES, ALL_SIMPLE_PARTS, connectSimpleCable, createSimpleBuild, disconnectSimpleCable, emptySimpleSnapshot, installSimplePart, isRamKey, lastSimpleStep,
  parseSimpleSnapshot, SIMPLE_PART_LIST, SIMPLE_PARTS, SIMPLE_SAVE_KEY, simpleAllPartsIn, simpleAssemblyComplete, simpleBlock, simpleBuildFromSnapshot,
  simpleCableBlock, simpleCableConnected, simpleCableMissingParts, simpleCablesFor, simplePartInstalled, simplePartsProgress, REMOVABLE, simpleRemoveBlock, simpleRuleBlock,
  simpleSlotPart, simpleSwapBlock, simpleTarget, slotOf, startSimplePC, SWAPPABLE, undoSimpleStep, withCable, withoutCable, withoutPart, withPart, withSwap,
  activateSimpleModel, activeSimpleModel, LEGACY_MODEL, roleOf, simpleRetention, setSimpleMechanism, lowerSimplePart, reseatSimplePart, liftSimplePart,
  withMechanism, withLower, withSeat, withLift, withFasten, withUnfasten, fastenSimplePart, unfastenSimplePart, simpleFastened, caseCoversClosed, SLOT_COVERS_ID, type SimpleAlignment, type SimpleCableKey, type SimpleModel, type SimplePartKey, type SimpleRule, type SimpleSnapshot,
} from "./simple-model";
import { cableOfPort, simpleBenchLayout, simpleSceneTargets } from "./simple-scene";
import { guideFocus } from "./guide";
import { availableFaults, flashBios, withFault, type FaultKind } from "./faults";
import { PowerDiagnostics } from "./PowerDiagnostics";
import { substepsFor } from "./substeps";
import type { PCBuildState, StartupResult } from "@ytl/contracts";
import styles from "./simple-pc.module.css";
import arLabs from "../../messages/ar/labs.json";

/** The fix for the liquid-cooling rule, in Arabic, shown on the English page as well. */
const NEEDS_LIQUID_AR = arLabs.simplePc.needsLiquid;

const partSpec = (key: SimplePartKey) => ALL_SIMPLE_PARTS.find((p) => p.key === key)!;
const cableSpec = (key: SimpleCableKey) => ALL_SIMPLE_CABLES.find((c) => c.key === key)!;
const entryOf = (catalogId: string | undefined) => pcCatalog.entries.find((e) => e.id === catalogId);
/** A model name short enough for a tile: before any dash or bracket, at most about 24 characters. */
const shortModel = (model: string) => {
  const base = model.split(/ — | \(/)[0]!.trim();
  if (base.length <= 24) return base;
  const cut = base.slice(0, 24);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 10 ? cut.lastIndexOf(" ") : 24)}…`;
};

/**
 * How the learner likes the 3D view, kept apart from the build's own saved progress: the guide robot
 * in the scene, whether it flies and bobs, and the optional RGB lighting (off unless turned on).
 */
export const SIMPLE_VIEW_KEY = "ytl_simple_pc_view_v1";
export type SimpleView = { guide: boolean; guideMotion: boolean; rgb: boolean };
const DEFAULT_VIEW: SimpleView = { guide: true, guideMotion: true, rgb: false };
export function parseSimpleView(value: unknown): SimpleView {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const flag = (key: keyof SimpleView) => (typeof data[key] === "boolean" ? (data[key] as boolean) : DEFAULT_VIEW[key]);
  return { guide: flag("guide"), guideMotion: flag("guideMotion"), rgb: flag("rgb") };
}

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
    __ytlSimplePc?: () => { placed: string[]; connected: string[]; history: string[]; powered: boolean; selection: Selection; complete: boolean; mood: string; lines: string[]; guide: ReturnType<typeof guideFocus>; view: SimpleView; mode?: string; fault?: string | null; faultSolved?: boolean };
  }
}

/** `aiConfigured` comes from the server (as for the page tutor): without a provider the page never asks the AI routes. */
/**
 * The page's model (`activateSimpleModel`) must be set before this mounts; remount it (a new `key`)
 * when the model changes. `onEditBuild` returns to the planner.
 */
export function SimplePcLab({ embedded = false, aiConfigured = false, onEditBuild, saveKey = SIMPLE_SAVE_KEY, model = LEGACY_MODEL }: { embedded?: boolean; aiConfigured?: boolean; onEditBuild?: () => void; saveKey?: string; model?: SimpleModel }) {
  // The build this page runs, put in place before anything below reads it.
  useState(() => activateSimpleModel(model));
  const t = useTranslations("simplePc");
  const locale = useLocale();
  const planned = activeSimpleModel().kind === "plan";
  // Computed once per model: the leads drawn in the scene, and where every part lies on the bench at the start.
  const cableIds = useMemo(() => ALL_SIMPLE_CABLES.map((c) => c.id), []);
  const bench = useMemo(() => simpleBenchLayout(createSimpleBuild()), []);
  const lang = locale === "ar" ? "ar" : "en";
  /** A part's name: the fixed build's own label, or the role and model of a planned part. */
  const label = (key: SimplePartKey, short = false) => {
    if (!planned) return t(`parts.${key}`);
    const n = key.match(/\d+$/)?.[0];
    const e = entryOf(partSpec(key)?.catalogId);
    return `${t(`roles.${roleOf(key)}`)}${n && roleOf(key) !== "fan" ? ` ${n}` : ""}${e ? ` · ${short ? shortModel(e.model) : e.model}` : ""}`;
  };
  const cableName = (key: SimpleCableKey) => t(`cables.${key}.name`);
  /** The robot's short name for a planned part: its role only (the model is on the tile). */
  const roleLabel = (key: SimplePartKey) => t(`roles.${roleOf(key)}`);
  /** Where a lead goes: on a planned build, the real header or socket of the chosen board or part. */
  const cableRoute = (key: SimpleCableKey) => {
    if (!planned) return t(`cables.${key}.route`);
    const c = cableSpec(key);
    const host = entryOf(state.parts.find((p) => p.instanceId === c.instanceId)?.catalogId);
    const portLabel = host?.ports.find((p) => p.id === c.portId)?.label[lang];
    return portLabel ? `${t(`cables.${key}.name`)} → ${portLabel}` : t(`cables.${key}.route`);
  };
  const reducedMotion = useReducedMotion();
  const [saved, setSaved] = useState<SimpleSnapshot>(emptySimpleSnapshot);
  const [ready, setReady] = useState(false);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<"parts" | "cables">("parts");
  const [verdict, setVerdict] = useState<"success" | "failure" | null>(null);
  /** The lab rule behind the last failed start, if one was: shown with its fix. */
  const [failedRule, setFailedRule] = useState<SimpleRule | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [message, setMessage] = useState<CompanionMessage>({ id: 0, say: { lines: [{ key: "hello" }], mood: "wave" } });
  const [ai, setAi] = useState<AiStatus>("unknown");
  const [view, setView] = useState<SimpleView>(DEFAULT_VIEW);
  /** The learner has started being guided (picked something up or asked): the robot then follows every step. */
  const [guided, setGuided] = useState(false);
  const [thinking, setThinking] = useState(false);
  const cablesTarget = useTutorTarget<HTMLDivElement>("pc:ui:simple-cables", "ui");
  const partsTarget = useTutorTarget<HTMLDivElement>("pc:ui:simple-parts", "ui");
  const asking = useRef<AbortController | null>(null);

  /** Guided shows every step; independent gives no step hints unasked; fault is a finished build with one mistake. */
  const [mode, setMode] = useState<"guided" | "independent" | "fault">("guided");
  const [fault, setFault] = useState<{ kind: FaultKind; state: PCBuildState; solved: boolean } | null>(null);
  /** The last power-on attempt, for the stage-by-stage panel. */
  const [attempt, setAttempt] = useState<{ state: PCBuildState; startup: StartupResult } | null>(null);
  const built = useMemo(() => simpleBuildFromSnapshot(saved), [saved]);
  /** Physical steps ticked for the part in hand (they reset when another part is picked up). */
  const [ticked, setTicked] = useState(0);
  /** How the learner holds a keyed part (CPU, memory) over its place: turned and off centre until they line it up. */
  const [hold, setHold] = useState<({ key: SimplePartKey } & SimpleAlignment) | null>(null);
  const state = mode === "fault" && fault ? fault.state : built;
  const startup = useMemo(() => pc.evaluateStartup(state, pcCatalog), [state]);
  const targets = useMemo(() => simpleSceneTargets(state, selection), [state, selection]);
  const powered = mode === "fault" ? Boolean(fault?.solved) : saved.powered;
  const guide = useMemo(() => (view.guide && mode === "guided" ? guideFocus(state, selection, powered, guided) : null), [view.guide, mode, state, selection, powered, guided]);
  const progress = simplePartsProgress(state);
  /** The leads of this build: the liquid cooler's two replace the air cooler's one when it is fitted. */
  const leads = useMemo(() => simpleCablesFor(state), [state]);
  const cableProgress = leads.filter((c) => simpleCableConnected(state, c.key)).length;
  /** Whether the PC on the page is switched on: the fault build is off until it starts. */
  const lockedOn = mode === "fault" ? false : saved.powered;
  const complete = mode !== "fault" && saved.powered && simpleAssemblyComplete(state);

  /** The robot speaks: a new bubble, from the build as it is after the action. */
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const speak = useCallback((say: CompanionSay, extra: Partial<CompanionMessage> = {}) => {
    // Independent and fault modes: the helper reacts, but does not hand out the next step unasked.
    const quiet = modeRef.current !== "guided" && !extra.question && !say.lines.some((l) => l.key.startsWith("explain."));
    const lines = quiet ? say.lines.filter((l) => !l.key.startsWith("next.")) : say.lines;
    setMessage((previous) => ({ id: previous.id + 1, say: { ...say, lines: lines.length ? lines : say.lines.slice(0, 1) }, ...extra }));
  }, []);
  const react = useCallback((event: CompanionEvent, after = state, powered = saved.powered, inHand: Selection = selection) => {
    speak(companionSay(event, after, powered, inHand));
  }, [speak, state, saved.powered, selection]);

  useEffect(() => {
    let restored: SimpleSnapshot | null = null;
    try {
      const raw = localStorage.getItem(saveKey);
      restored = raw ? parseSimpleSnapshot(JSON.parse(raw)) : null;
    } catch { /* Storage is optional; assembly still works in memory. */ }
    const snapshot = restored ?? emptySimpleSnapshot();
    if (restored) {
      setSaved(restored);
      setVerdict(restored.powered ? "success" : null);
      if (simpleAllPartsIn(simpleBuildFromSnapshot(restored))) setTab("cables");
    }
    speak(companionSay(snapshot.history.length > 0 ? { type: "resume" } : { type: "start" }, simpleBuildFromSnapshot(snapshot), snapshot.powered, null));
    try { setView(parseSimpleView(JSON.parse(localStorage.getItem(SIMPLE_VIEW_KEY) ?? "null"))); } catch { /* Defaults. */ }
    setWebgl(supportsWebgl());
    setReady(true);
    const controller = new AbortController();
    if (aiConfigured) void fetchTutorStatus(fetch, controller.signal).then(setAi);
    else setAi("not_configured");
    return () => { controller.abort(); asking.current?.abort(); };
  }, [speak, aiConfigured, saveKey]);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(saveKey, JSON.stringify(saved)); } catch { /* Keep working. */ }
  }, [ready, saved, saveKey]);

  function changeView(patch: Partial<SimpleView>) {
    setView((previous) => {
      const next = { ...previous, ...patch };
      try { localStorage.setItem(SIMPLE_VIEW_KEY, JSON.stringify(next)); } catch { /* Applies on this page only. */ }
      return next;
    });
  }

  // The 3D view marks the part in hand (and nothing while a lead or nothing is in hand).
  useEffect(() => {
    selectPart(selection?.kind === "part" ? partSpec(selection.key).id : null);
  }, [selection, sceneVersion]);

  useEffect(() => {
    window.__ytlSimplePc = () => ({
      placed: [...saved.placed], connected: [...saved.connected], history: [...saved.history], powered: saved.powered, selection, complete,
      mood: message.say.mood, lines: message.say.lines.map((line) => line.key), guide, view, mode, fault: fault?.kind ?? null, faultSolved: fault?.solved ?? false,
    });
    return () => { delete window.__ytlSimplePc; };
  }, [saved, selection, complete, message, guide, view, mode, fault]);

  // ---------- Learner actions ----------

  /** Which hands-on routine a keyed part follows: socket and plate, memory latch, or card latch and bracket. */
  const handKind = (retKind: string): "cpu" | "ram" | "gpu" => (retKind === "dimm_latch" ? "ram" : retKind === "pcie_latch" ? "gpu" : "cpu");
  /** How a keyed part comes off the bench: turned and off centre, so lining it up is the learner's job. */
  const pickup = (key: SimplePartKey, retKind: string) => {
    const k = handKind(retKind);
    return { key, rotationDeg: k === "cpu" ? 90 : k === "ram" ? 180 : 180, offsetMm: (k === "cpu" ? [5, -4] : k === "ram" ? [6, 0] : [4, 3]) as [number, number] };
  };
  function choosePart(key: SimplePartKey) {
    setConfirmRestart(false);
    if (selection?.kind === "part" && selection.key === key) { cancel(); return; }
    const next: Selection = { kind: "part", key };
    setSelection(next);
    setTicked(0);
    // A keyed part is picked up turned and off centre: lining it up is the learner's job.
    const inPlace = (state.parts.find((p) => p.instanceId === partSpec(key)?.id)?.attachments.length ?? 0) > 0;
    const picked = simpleRetention(state, key);
    setHold(picked && !inPlace ? pickup(key, picked.kind) : null);
    setGuided(true);
    setTab("parts");
    if (lockedOn) { speak({ lines: [{ key: "blocked.turnOff" }], mood: "concerned", point: "power" }); return; }
    // A keyed part: the robot names the first physical step it actually needs now.
    const ret = simpleRetention(state, key);
    if (ret && !simplePartInstalled(state, key) && !inPlace) {
      const k = handKind(ret.kind);
      const line = k === "gpu" ? (caseCoversClosed(state) ? "gpuCoversFirst" : ret.open ? "gpuOpen" : "gpuLatchFirst") : ret.open ? `${k}Open` : `${k}OpenFirst`;
      speak({ lines: [{ key: `hands.${line}` }], mood: "point", point: "scene" });
      return;
    }
    react({ type: "select", selection: next }, state, lockedOn, next);
  }

  function chooseCable(key: SimpleCableKey) {
    setConfirmRestart(false);
    if (selection?.kind === "cable" && selection.key === key) { cancel(); return; }
    const next: Selection = { kind: "cable", key };
    setSelection(next);
    setGuided(true);
    setTab("cables");
    react({ type: "select", selection: next }, state, saved.powered, next);
  }

  function cancel() {
    if (!selection) return;
    setSelection(null);
    react({ type: "cancel" }, state, saved.powered, null);
  }

  function install(key: SimplePartKey) {
    if (mode === "fault") {
      if (!fault || fault.solved) return;
      if (simpleRetention(state, key)) { primaryHand(key); return; }
      const step = installSimplePart(state, key);
      if (step.ok) { setFault({ ...fault, state: step.state }); setSelection(null); react({ type: "installed", key }, step.state, false, null); }
      return;
    }
    if (saved.powered) return;
    // A keyed part goes in only through its mechanism and alignment.
    if (simpleRetention(state, key)) { primaryHand(key); return; }
    // The physical steps come first (pushing a resting part home has none to repeat).
    if (!simplePartInstalled(state, key) && ticked < substepsFor(key).length && !simpleSlotPart(state, slotOf(key))) { speak({ lines: [{ key: "blocked.substeps" }], mood: "concerned", point: "parts" }); return; }
    const rival = simpleSlotPart(state, slotOf(key));
    if (rival && rival !== key) { swap(rival, key); return; }
    const step = installSimplePart(state, key);
    if (!step.ok) { react({ type: "select", selection: { kind: "part", key } }); return; }
    if (simplePartInstalled(state, key)) return;
    setSaved((previous) => withPart(previous, key));
    setSelection(null);
    setVerdict(null);
    if (simpleAllPartsIn(step.state)) setTab("cables");
    react({ type: "installed", key }, step.state, false, null);
  }

  // ---------- Hands-on: mechanisms and alignment (CPU, memory) ----------

  /** Keeps a mechanism or seating change: a step in the saved progress, or the fault build's state. */
  function keepHand(next: ReturnType<typeof createSimpleBuild>, step: (s: SimpleSnapshot) => SimpleSnapshot, line: string, mood: "happy" | "point" | "concerned" = "point") {
    if (mode === "fault") { if (fault) setFault({ ...fault, state: next }); }
    else setSaved((previous) => step(previous));
    setVerdict(null);
    speak({ lines: [{ key: `hands.${line}` }], mood, point: "scene" });
  }
  function handMechanism(key: SimplePartKey, desired: "open" | "closed") {
    if (lockedOn || (mode === "fault" && (!fault || fault.solved))) return;
    const ret = simpleRetention(state, key);
    if (!ret) return;
    const r = setSimpleMechanism(state, ret.id, desired);
    const k = handKind(ret.kind);
    const cpu = k === "cpu";
    if (!r.ok) { speak({ lines: [{ key: k === "gpu" ? "hands.closeBlocked" : desired === "open" ? "hands.coolerOver" : "hands.cpuLowerFirst" }], mood: "concerned", point: "scene" }); return; }
    const attached = (r.state.parts.find((p) => p.instanceId === partSpec(key).id)?.attachments.length ?? 0) > 0;
    const line = cpu ? (desired === "open" ? (attached ? "cpuReleased" : "cpuOpen") : "cpuClosed") : attached ? `${k}Released` : `${k}Open`;
    keepHand(r.state, (sn) => withMechanism(sn, ret.id, desired), line, desired === "closed" ? "happy" : "point");
    if (cpu && desired === "closed" && simplePartInstalled(r.state, key)) { setSelection(null); setHold(null); }
  }
  function handLower(key: SimplePartKey) {
    if (lockedOn || !hold || hold.key !== key) return;
    const ret = simpleRetention(state, key);
    const k = handKind(ret?.kind ?? "");
    const cpu = k === "cpu";
    const r = lowerSimplePart(state, key, hold);
    if (!r.ok) {
      const first = k === "gpu" ? (caseCoversClosed(state) ? "gpuCoversFirst" : "gpuLatchFirst") : `${k}OpenFirst`;
      const line = r.reason === "openFirst" ? first : r.reason === "turnPart" ? `${k}Turn` : r.reason === "centrePart" ? `${k}Centre` : null;
      if (line) speak({ lines: [{ key: `hands.${line}` }], mood: "concerned", point: "scene" });
      else react({ type: "select", selection: { kind: "part", key } });
      return;
    }
    setHold(null);
    keepHand(r.state, (sn) => withLower(sn, key), cpu ? "cpuLowered" : k === "gpu" ? "gpuIn" : "ramIn", "happy");
    if (k === "ram") { setSelection(null); if (simpleAllPartsIn(r.state)) setTab("cables"); }
  }
  function handSeat(key: SimplePartKey) {
    if (lockedOn) return;
    const r = reseatSimplePart(state, key);
    if (!r.ok) return;
    keepHand(r.state, (sn) => withSeat(sn, key), "ramIn", "happy");
    setSelection(null);
  }
  function handLift(key: SimplePartKey) {
    if (lockedOn) return;
    const ret = simpleRetention(state, key);
    const k = handKind(ret?.kind ?? "");
    const r = liftSimplePart(state, key);
    if (!r.ok) {
      const line = r.reason === "unplugFirst" ? "gpuUnplug" : r.reason === "unscrewFirst" ? "gpuUnscrew" : k === "gpu" ? "gpuReleaseFirst" : `${k}OpenFirst`;
      speak({ lines: [{ key: `hands.${line}` }], mood: "concerned", point: "scene" });
      return;
    }
    keepHand(r.state, (sn) => withLift(sn, key), "lifted");
    if (ret) setHold(pickup(key, ret.kind));
  }
  /** The case's expansion-slot covers beside the card's slot: out before a card, back once no card is there. */
  function handCovers(desired: "open" | "closed") {
    if (lockedOn || (mode === "fault" && (!fault || fault.solved))) return;
    const r = setSimpleMechanism(state, SLOT_COVERS_ID, desired);
    if (!r.ok) { speak({ lines: [{ key: "hands.coversBlocked" }], mood: "concerned", point: "scene" }); return; }
    keepHand(r.state, (sn) => withMechanism(sn, SLOT_COVERS_ID, desired), desired === "open" ? "coversOut" : "coversIn");
  }
  function handFasten(key: SimplePartKey) {
    if (lockedOn || (mode === "fault" && (!fault || fault.solved))) return;
    const r = fastenSimplePart(state, key);
    if (!r.ok) { speak({ lines: [{ key: "hands.gpuSeatFirst" }], mood: "concerned", point: "scene" }); return; }
    keepHand(r.state, (sn) => withFasten(sn, key), "gpuScrewed", "happy");
    setSelection(null);
    if (simpleAllPartsIn(r.state)) setTab("cables");
  }
  function handUnfasten(key: SimplePartKey) {
    if (lockedOn || (mode === "fault" && (!fault || fault.solved))) return;
    const r = unfastenSimplePart(state, key);
    if (!r.ok) return;
    keepHand(r.state, (sn) => withUnfasten(sn, key), "gpuUnscrewed");
  }
  const turn = (deg: number) => setHold((h) => (h ? { ...h, rotationDeg: (((h.rotationDeg + deg) % 360) + 360) % 360 } : h));
  const nudge = (dx: number, dz: number) => setHold((h) => (h ? { ...h, offsetMm: [Math.round((h.offsetMm[0] + dx) * 10) / 10, isRamKey(h.key) ? 0 : Math.round((h.offsetMm[1] + dz) * 10) / 10] } : h));

  /** Replaces the CPU or cooler that is in with its alternative. */
  function swap(from: SimplePartKey, to: SimplePartKey) {
    const blocked = simpleSwapBlock(state, to);
    if (blocked) { react({ type: "removeBlocked", key: from, reason: blocked }); return; }
    const next = withSwap(saved, from, to);
    let after: ReturnType<typeof simpleBuildFromSnapshot>;
    try { after = simpleBuildFromSnapshot(next); } catch { react({ type: "select", selection: { kind: "part", key: to } }); return; }
    if (!simplePartInstalled(after, to)) return;
    setSaved(next);
    setSelection(null);
    setVerdict(null);
    react({ type: "swapped", from, key: to }, after, false, null);
  }

  /** Takes a cooler back out, so the other one can go in (or the CPU under it can be swapped). */
  function remove(key: SimplePartKey) {
    const blocked = simpleRemoveBlock(state, key);
    if (blocked) { react({ type: "removeBlocked", key, reason: blocked }); return; }
    if (!simplePartInstalled(state, key)) return;
    const next = withoutPart(saved, key);
    const after = simpleBuildFromSnapshot(next);
    setSaved(next);
    setSelection(null);
    setVerdict(null);
    setTab("parts");
    react({ type: "removed", key }, after, false, null);
  }

  function connect(key: SimpleCableKey) {
    if (mode === "fault") {
      if (!fault || fault.solved) return;
      const step = connectSimpleCable(state, key);
      if (step.ok) { setFault({ ...fault, state: step.state }); setSelection(null); react({ type: "connected", key }, step.state, false, null); }
      return;
    }
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
    if (mode === "fault") {
      if (!fault || fault.solved) return;
      const off = disconnectSimpleCable(state, key);
      if (off.ok) setFault({ ...fault, state: off.state });
      return;
    }
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
      if (selection.kind === "part" && simpleRetention(state, selection.key)) { primaryHand(selection.key); return; }
      if (selection.kind === "part") install(selection.key);
      else connect(selection.key);
      return;
    }
    if (selection.kind === "part") react({ type: "wrongPlace", key: selection.key, place });
    else react({ type: "wrongPort", key: selection.key, portOf: cableOfPort(place, state) });
  }

  /** What a tap on a keyed part's place does now: open its mechanism, lower the held part, or close the plate. */
  function primaryHand(key: SimplePartKey) {
    const ret = simpleRetention(state, key);
    const at = state.parts.find((p) => p.instanceId === partSpec(key).id)?.attachments[0];
    if (!ret) return;
    const gpu = ret.kind === "pcie_latch";
    if (!at && gpu && caseCoversClosed(state)) { handCovers("open"); return; }
    if (!at && !ret.open) { handMechanism(key, "open"); return; }
    if (!at) { handLower(key); return; }
    if (at.seating !== "seated") { handSeat(key); return; }
    if (gpu) { if (!simpleFastened(state, key)) handFasten(key); return; }
    if (ret.open && ret.kind !== "dimm_latch") handMechanism(key, "closed");
  }

  function onScenePart(instanceId: string) {
    const part = ALL_SIMPLE_PARTS.find((p) => p.id === instanceId);
    if (part && !simplePartInstalled(state, part.key)) { choosePart(part.key); return; }
    // An installed part, the case or a case fan: not a place for what is in hand, and not something to pick up.
    if (selection?.kind === "part") react({ type: "wrongPlace", key: selection.key, place: instanceId });
    else if (selection?.kind === "cable") react({ type: "wrongPort", key: selection.key, portOf: null });
    else react({ type: "notSelectable" });
  }

  function onSceneCable(cableId: string) {
    const cable = ALL_SIMPLE_CABLES.find((c) => c.id === cableId);
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
    setGuided(false);
    setSceneVersion((n) => n + 1);
    if (webgl === false) setWebgl(supportsWebgl());
    react({ type: "restart" }, createSimpleBuild(), false, null);
  }

  function newFault() {
    const kinds = availableFaults();
    if (kinds.length === 0) { setFault(null); return; }
    const kind = kinds[Math.floor(Math.random() * kinds.length)]!;
    setFault({ kind, state: withFault(kind)!, solved: false });
    setAttempt(null);
    setVerdict(null);
    setSelection(null);
  }

  function chooseMode(next: "guided" | "independent" | "fault") {
    setMode(next);
    setAttempt(null);
    setVerdict(null);
    setSelection(null);
    if (next === "fault") newFault();
  }

  function power() {
    setConfirmRestart(false);
    if (mode === "fault") {
      if (!fault) return;
      const result = startSimplePC(fault.state, { evenIfIncomplete: true });
      setAttempt({ state: fault.state, startup: result.startup });
      setVerdict(result.ok ? "success" : "failure");
      setFailedRule(result.ok ? null : result.rule);
      if (result.ok) setFault({ ...fault, solved: true });
      return;
    }
    if (saved.powered) {
      setSaved((previous) => ({ ...previous, powered: false }));
      setVerdict(null);
      const off = simpleBuildFromSnapshot({ ...saved, powered: false });
      react({ type: "powerOff" }, off, false, selection);
      return;
    }
    const result = startSimplePC(state);
    setAttempt({ state: result.ok ? result.state : state, startup: result.startup });
    setVerdict(result.ok ? "success" : "failure");
    setFailedRule(result.ok ? null : result.rule);
    setSelection(null);
    if (result.ok) {
      setSaved((previous) => ({ ...previous, powered: true }));
      react({ type: "powerOn" }, result.state, true, null);
      return;
    }
    const missing = leads.find((c) => c.essential && !simpleCableConnected(state, c.key))?.key ?? null;
    if (result.rule) setTab("parts");
    else if (progress === SIMPLE_PARTS.length) setTab("cables");
    react({ type: "powerFail", missingCable: missing, rule: result.rule }, state, false, null);
  }

  function quick(intent: "next" | "help" | "explain") {
    setGuided(true);
    react({ type: "ask", intent });
  }

  async function ask(text: string) {
    setGuided(true);
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
  const firstMissingCable = leads.find((c) => c.essential && !simpleCableConnected(state, c.key));
  // The lab rule wins when it is still broken; otherwise the first missing part or lead.
  const rule = failedRule && simpleRuleBlock(state) ? failedRule : null;
  const ruleText = planned ? t("planner.findingText.exercise_needs_liquid") : t("needsLiquid");
  const missingMessage = rule ? ruleText : progress < SIMPLE_PARTS.length ? t("missing") : firstMissingCable ? t("missingCable", { cable: cableName(firstMissingCable.key) }) : t("checkCables");
  const placeName = (key: SimplePartKey) => {
    const target = simpleTarget(state, key);
    if (!planned) return t(`companion.places.${target.mountPointId}`);
    const host = entryOf(state.parts.find((p) => p.instanceId === target.hostInstanceId)?.catalogId);
    return host?.mountPoints.find((m) => m.id === target.mountPointId)?.label[lang] ?? target.mountPointId;
  };
  /** A mount point's own label on the board or case of the planned build. */
  const placeLabelOf = (place: string) => {
    for (const p of state.parts) {
      const m = entryOf(p.catalogId)?.mountPoints.find((x) => x.id === place);
      if (m && (p.catalogId === entryOf(partSpec("motherboard")?.catalogId)?.id || p.instanceId === "case-1")) return m.label[lang];
    }
    return place;
  };
  const summary = complete ? {
    parts: SIMPLE_PARTS.flatMap((p) => simpleSlotPart(state, slotOf(p.key)) ?? []).map((key) => (isRamKey(key) ? `${label(key)} · ${placeName(key)}` : label(key))),
    cables: leads.map((c) => cableName(c.key)),
  } : null;
  const removable = selectedPart ? REMOVABLE.includes(selectedPart) : false;
  const removeBlocked = selectedPart && partInstalled && removable ? simpleRemoveBlock(state, selectedPart) : null;
  /** The part this one would replace: the other CPU or cooler, when that one is in. */
  const rival = selectedPart && !partInstalled && SWAPPABLE.includes(selectedPart) ? simpleSlotPart(state, slotOf(selectedPart)) : null;
  const swapBlocked = selectedPart && rival ? simpleSwapBlock(state, selectedPart) : null;
  const blockHint = (reason: string) => t(reason === "turnOffFirst" ? "turnOffToSwap" : reason);
  const canUndo = Boolean(lastSimpleStep(saved));
  const keyed = selectedPart ? simpleRetention(state, selectedPart) : null;
  const heldNow = selectedPart && keyed && hold?.key === selectedPart && !(state.parts.find((p) => p.instanceId === partSpec(selectedPart).id)?.attachments.length)
    ? { instanceId: partSpec(selectedPart).id, target: simpleTarget(state, selectedPart), rotationDeg: hold.rotationDeg, offsetMm: hold.offsetMm, liftMm: keyed.kind === "pcie_latch" ? 40 : isRamKey(selectedPart) ? 30 : 22 }
    : null;

  /** The CPU's or module's own mechanism, alignment and lowering, one honest step at a time. */
  function HandsPanel() {
    const key = selectedPart!;
    const ret = keyed!;
    const kind = handKind(ret.kind);
    if (kind === "gpu") return GpuHands();
    const cpu = kind === "cpu";
    const at = state.parts.find((p) => p.instanceId === partSpec(key).id)?.attachments[0];
    const host = state.parts.find((p) => p.instanceId === ret.hostInstanceId);
    const coverOn = cpu && host?.mechanisms?.[`${ret.id}:cover`] !== "open";
    const rival = cpu ? simpleSlotPart(state, "cpu") : null;
    const otherIn = rival && rival !== key ? rival : null;
    const off = hold ? Math.hypot(hold.offsetMm[0], hold.offsetMm[1]) : 0;
    const disabled = !ready || lockedOn || (mode === "fault" && (!fault || fault.solved));
    const onKeys = (e: React.KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const map: Record<string, () => void> = { q: () => turn(cpu ? -90 : 180), e: () => turn(cpu ? 90 : 180), arrowleft: () => nudge(-1, 0), arrowright: () => nudge(1, 0), arrowup: () => nudge(0, -1), arrowdown: () => nudge(0, 1), enter: () => handLower(key) };
      if (map[k]) { e.preventDefault(); e.stopPropagation(); map[k](); }
    };
    return (
      <div className={styles.hands}>
        <div className={styles.handsHead}>
          <p className={styles.handsState}>{t(cpu ? "hands.plate" : "hands.latch", { state: t(ret.open ? "hands.open" : "hands.closed") })}{coverOn ? ` · ${t("hands.cover")}` : ""}</p>
          <button type="button" className={styles.closeup} onClick={() => focusOn(ret.hostInstanceId, ret.mountPointId)}>{t("hands.closeup")}</button>
        </div>
        {otherIn ? <p className={styles.hint}>{t("hands.takeOther")}</p> : <>
          {!at && <>
            {!ret.open && <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handMechanism(key, "open")}>{t(cpu ? "hands.openPlate" : "hands.openLatch")}</button>}
            {hold && <div className={styles.holdControls} role="group" aria-label={t("hands.title")} tabIndex={0} onKeyDown={onKeys}>
              <p className={styles.alignState} aria-live="polite">{t("hands.turned", { deg: hold.rotationDeg })} · {off < 0.05 ? t("hands.aligned") : t("hands.off", { mm: Math.round(off * 10) / 10 })}</p>
              <div className={styles.holdRow}>
                {cpu ? <>
                  <button type="button" onClick={() => turn(-90)} aria-label={t("hands.rotateLeft")}>⟲</button>
                  <button type="button" onClick={() => turn(90)} aria-label={t("hands.rotateRight")}>⟳</button>
                </> : <button type="button" onClick={() => turn(180)}>{t("hands.flip")}</button>}
                <button type="button" onClick={() => nudge(-1, 0)} aria-label={t("hands.nudgeLeft")}>←</button>
                <button type="button" onClick={() => nudge(1, 0)} aria-label={t("hands.nudgeRight")}>→</button>
                {cpu && <>
                  <button type="button" onClick={() => nudge(0, -1)} aria-label={t("hands.nudgeUp")}>↑</button>
                  <button type="button" onClick={() => nudge(0, 1)} aria-label={t("hands.nudgeDown")}>↓</button>
                </>}
              </div>
              <p className={styles.cablesNote}>{t("hands.keys")}</p>
              <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handLower(key)}>{t(cpu ? "hands.lowerIn" : "hands.pressIn")}</button>
            </div>}
          </>}
          {at && at.seating !== "seated" && <>
            <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handSeat(key)}>{t("hands.pressIn")}</button>
            <button className={styles.cancel} type="button" disabled={disabled} onClick={() => handLift(key)}>{t("hands.liftOut")}</button>
          </>}
          {at && at.seating === "seated" && cpu && ret.open && <>
            <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handMechanism(key, "closed")}>{t("hands.closePlate")}</button>
            <button className={styles.cancel} type="button" disabled={disabled} onClick={() => handLift(key)}>{t("hands.liftOut")}</button>
          </>}
          {at && at.seating === "seated" && !ret.open && <button className={styles.cancel} type="button" disabled={disabled} onClick={() => handMechanism(key, "open")}>{t(cpu ? "hands.openPlate" : "hands.openLatch")}</button>}
        </>}
        <p className={styles.hint}>{t(cpu ? "hands.markCpu" : "hands.markRam")}</p>
        {!cpu && <p className={styles.cablesNote}>{t("hands.unverified")}</p>}
        <p className={styles.cablesNote}>{t("hands.note")}</p>
      </div>
    );
  }

  /** The graphics card: slot covers, the slot's push latch, bracket alignment, screws; and the same in reverse. */
  function GpuHands() {
    const key = selectedPart!;
    const ret = keyed!;
    const at = state.parts.find((p) => p.instanceId === partSpec(key).id)?.attachments[0];
    const covered = caseCoversClosed(state);
    const screwed = simpleFastened(state, key);
    const off = hold ? Math.hypot(hold.offsetMm[0], hold.offsetMm[1]) : 0;
    const disabled = !ready || lockedOn || (mode === "fault" && (!fault || fault.solved));
    const onKeys = (e: React.KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const map: Record<string, () => void> = { q: () => turn(180), e: () => turn(180), arrowleft: () => nudge(-1, 0), arrowright: () => nudge(1, 0), arrowup: () => nudge(0, -1), arrowdown: () => nudge(0, 1), enter: () => handLower(key) };
      if (map[k]) { e.preventDefault(); e.stopPropagation(); map[k](); }
    };
    const st = (open: boolean) => t(open ? "hands.open" : "hands.closed");
    return (
      <div className={styles.hands}>
        <div className={styles.handsHead}>
          <p className={styles.handsState}>{t("hands.pcieLatch", { state: st(ret.open) })} · {t("hands.covers", { state: t(covered ? "hands.coversIn" : "hands.coversOut") })}{at ? ` · ${t(screwed ? "hands.screwsIn" : "hands.screwsOut")}` : ""}</p>
          <button type="button" className={styles.closeup} onClick={() => focusOn(ret.hostInstanceId, ret.mountPointId)}>{t("hands.closeup")}</button>
        </div>
        {!at && <>
          {covered && <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handCovers("open")}>{t("hands.removeCovers")}</button>}
          {!ret.open && <button className={covered ? styles.cancel : styles.installButton} type="button" disabled={disabled} onClick={() => handMechanism(key, "open")}>{t("hands.openPcie")}</button>}
          {hold && <div className={styles.holdControls} role="group" aria-label={t("hands.title")} tabIndex={0} onKeyDown={onKeys}>
            <p className={styles.alignState} aria-live="polite">{t(hold.rotationDeg === 0 ? "hands.bracketToCase" : "hands.bracketAway")} · {off < 0.05 ? t("hands.aligned") : t("hands.off", { mm: Math.round(off * 10) / 10 })}</p>
            <div className={styles.holdRow}>
              <button type="button" onClick={() => turn(180)}>{t("hands.flip")}</button>
              <button type="button" onClick={() => nudge(-1, 0)} aria-label={t("hands.nudgeLeft")}>←</button>
              <button type="button" onClick={() => nudge(1, 0)} aria-label={t("hands.nudgeRight")}>→</button>
              <button type="button" onClick={() => nudge(0, -1)} aria-label={t("hands.nudgeUp")}>↑</button>
              <button type="button" onClick={() => nudge(0, 1)} aria-label={t("hands.nudgeDown")}>↓</button>
            </div>
            <p className={styles.cablesNote}>{t("hands.keys")}</p>
            <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handLower(key)}>{t("hands.pushCard")}</button>
          </div>}
          {!covered && <button className={styles.cancel} type="button" disabled={disabled} onClick={() => handCovers("closed")}>{t("hands.refitCovers")}</button>}
        </>}
        {at && !screwed && <>
          {at.seating === "seated" && <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handFasten(key)}>{t("hands.screwBracket")}</button>}
          {!ret.open && <button className={styles.cancel} type="button" disabled={disabled} onClick={() => handMechanism(key, "open")}>{t("hands.releasePcie")}</button>}
          {ret.open && <button className={styles.cancel} type="button" disabled={disabled} onClick={() => handLift(key)}>{t("hands.liftOut")}</button>}
        </>}
        {at && screwed && <button className={styles.cancel} type="button" disabled={disabled} onClick={() => handUnfasten(key)}>{t("hands.unscrewBracket")}</button>}
        <p className={styles.hint}>{t("hands.markGpu")}</p>
        <p className={styles.cablesNote}>{t("hands.gpuSource")}</p>
        <p className={styles.cablesNote}>{t("hands.note")}</p>
      </div>
    );
  }

  return (
    <section className={styles.lab} aria-labelledby="simple-pc-title" onKeyDown={onKeyDown}>
      <header className={styles.heading}>
        <div>{embedded ? <h2 id="simple-pc-title">{t("title")}</h2> : <h1 id="simple-pc-title">{t("title")}</h1>}<p>{t("intro")}</p>
          {onEditBuild && <button type="button" className={styles.editBuild} onClick={onEditBuild}>{t("planner.editBuild")}</button>}</div>
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
                  simpleCableIds={cableIds}
                  selectedSimpleCableId={selectedCable ? cableSpec(selectedCable).id : null}
                  onSelectSimpleCable={onSceneCable}
                  simpleTargets={targets}
                  onSimpleTarget={onTarget}
                  onSimpleMiss={() => { if (selection) react({ type: "missedTarget" }); }}
                  guide={guide}
                  guideAnimate={view.guideMotion}
                  rgb={view.rgb}
                  held={heldNow}
                  benchOrder={bench.benchOrder}
                  beside={bench.beside}
                  onContextLost={() => setWebgl(false)}
                />
              </SceneBoundary>
            )}
          </div>
          <div className={styles.viewBar}>
            <div className={styles.toggles} role="group" aria-label={t("view.label")}>
              <button type="button" aria-pressed={view.guide} onClick={() => changeView({ guide: !view.guide })}>{t("view.guide")}</button>
              <button type="button" aria-pressed={view.guideMotion && !reducedMotion} disabled={!view.guide || reducedMotion} onClick={() => changeView({ guideMotion: !view.guideMotion })} title={reducedMotion ? t("view.reduced") : undefined}>{t("view.motion")}</button>
              <button type="button" aria-pressed={view.rgb} onClick={() => changeView({ rgb: !view.rgb })}>{t("view.rgb")}</button>
            </div>
            <p className={styles.cameraHint}>{t("cameraHint")}</p>
          </div>
        </div>

        <div className={styles.side}>
          <div className={styles.companionSlot}>
            <BuildCompanion message={message} ai={ai} thinking={thinking} reducedMotion={reducedMotion} onQuick={quick} onAsk={(text) => void ask(text)} summary={summary} {...(planned ? { partLabel: roleLabel, placeLabel: placeLabelOf } : {})} />
          </div>

          <div className={styles.controls}>
            <div className={styles.modes} role="radiogroup" aria-label={t("modes.label")}>
              {(["guided", "independent", "fault"] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => chooseMode(m)} disabled={!ready}>{t(`modes.${m}`)}</button>)}
            </div>
            <p className={styles.hint}>{t(`modes.${mode}Hint`)}</p>
            {mode === "fault" && !fault && <p className={styles.hint}>{t("fault.none")}</p>}
            <div className={styles.tabs} role="group" aria-label={t("assemblySteps")}>
              <button type="button" aria-pressed={tab === "parts"} onClick={() => setTab("parts")}>{t("partsTab")} <span dir="ltr">{t("progressShort", { count: progress, total: SIMPLE_PARTS.length })}</span></button>
              <button type="button" aria-pressed={tab === "cables"} onClick={() => setTab("cables")}>{t("cablesTab")} <span dir="ltr">{t("progressShort", { count: cableProgress, total: leads.length })}</span></button>
            </div>

            <div hidden={tab !== "parts"}>
              <div ref={partsTarget} className={styles.parts} role="group" aria-label={t("partsLabel")}>
                {SIMPLE_PART_LIST.map((key) => {
                  const part = partSpec(key);
                  const done = simplePartInstalled(state, part.key);
                  const active = selectedPart === part.key;
                  // An alternative whose slot the other part fills: still selectable, shown as the other choice.
                  const other = !done && SWAPPABLE.includes(key) && simpleSlotPart(state, slotOf(key)) !== null;
                  return <button key={part.key} type="button" className={styles.part} data-selected={active} data-installed={done} data-alternative={other || undefined} aria-pressed={active} onClick={() => choosePart(part.key)}>
                    <img src={`/assets/pc/thumbnails/${part.catalogId}.svg`} alt="" width={58} height={44} />
                    <span>{label(part.key, true)}{SWAPPABLE.includes(key) && <small>{t(`partNotes.${key}`)}</small>}</span>
                    {done && <CheckIcon />}
                  </button>;
                })}
              </div>

              <div className={styles.install}>
                {selectedPart ? <>
                  <div className={styles.selection}><strong>{label(selectedPart)}</strong><span>{partInstalled ? t("installed") : placeName(selectedPart)}</span></div>
                  {keyed ? HandsPanel() : partInstalled && removable
                    ? <button className={styles.installButton} type="button" onClick={() => remove(selectedPart)} disabled={!ready || Boolean(removeBlocked)}>{t("remove")}</button>
                    : rival
                      ? <button className={styles.installButton} type="button" onClick={() => swap(rival, selectedPart)} disabled={!ready || Boolean(swapBlocked)}>{t("swap", { other: label(rival) })}</button>
                      : <button className={styles.installButton} type="button" onClick={() => install(selectedPart)} disabled={!ready || partInstalled || Boolean(partBlocked) || lockedOn || (mode !== "fault" && ticked < substepsFor(selectedPart).length)}>{partInstalled ? t("installed") : t("install")}</button>}
                  {mode !== "fault" && !partInstalled && !rival && !partBlocked && substepsFor(selectedPart).length > 0 && <ol className={styles.substeps} aria-label={t("substeps.title")}>
                    {substepsFor(selectedPart).map((step, i) => <li key={step}><button type="button" aria-pressed={i < ticked} disabled={i > ticked} onClick={() => setTicked(i < ticked ? i : i + 1)}><span aria-hidden="true">{i < ticked ? "✓" : i + 1}</span>{t(`substeps.${step}`)}</button></li>)}
                  </ol>}
                  {partBlocked && !partInstalled && !rival && <p className={styles.hint}>{t(partBlocked)}</p>}
                  {rival && <p className={styles.hint}>{swapBlocked ? blockHint(swapBlocked) : t("swapHint", { other: label(rival) })}</p>}
                  {partInstalled && SWAPPABLE.includes(selectedPart) && !removable && <p className={styles.hint}>{t("swapCpuHint")}</p>}
                  {removeBlocked && removeBlocked !== "notSwappable" && <p className={styles.hint}>{blockHint(removeBlocked)}</p>}
                  <button className={styles.cancel} type="button" onClick={cancel}>{t("cancel")}</button>
                </> : <p className={styles.hint}>{t("selectFirst")}</p>}
              </div>
            </div>

            <div ref={cablesTarget} hidden={tab !== "cables"}>
              <p className={styles.cablesIntro}>{t(!planned && simplePartInstalled(state, "aio") ? "cablesIntroLiquid" : "cablesIntro")}</p>
              <div className={styles.cables} role="group" aria-label={t("cablesLabel")}>
                {leads.map((item) => {
                  const done = simpleCableConnected(state, item.key);
                  const active = selectedCable === item.key;
                  return <button type="button" key={item.key} className={styles.cable} data-selected={active} data-connected={done} aria-pressed={active} onClick={() => chooseCable(item.key)}>
                    <span className={styles.wireIcon} aria-hidden="true">↳</span>
                    <span>{cableName(item.key)}{!item.essential && <small>{t("fanOptional")}</small>}</span>
                    {done ? <CheckIcon /> : <span className={styles.unplugged}>{t("loose")}</span>}
                  </button>;
                })}
              </div>
              {selectedCable && <div className={styles.cableDetail}>
                <strong>{cableName(selectedCable)}</strong>
                <p>{cableRoute(selectedCable)}</p>
                <code dir="ltr">{t(`cables.${selectedCable}.connector`)}</code>
                <button className={styles.installButton} type="button" onClick={() => cableDone ? unplug(selectedCable) : connect(selectedCable)} disabled={!ready || lockedOn || (!cableDone && Boolean(cableBlocked))}>{cableDone ? t("disconnect") : t("connect")}</button>
                {cableBlocked && !cableDone && <p className={styles.hint}>{cableBlocked === "turnOffFirst" ? t("turnOffFirst") : t("fitCableParts", { parts: simpleCableMissingParts(state, selectedCable).map((key) => label(key)).join(locale === "ar" ? "، " : ", ") })}</p>}
                {lockedOn && cableDone && <p className={styles.hint}>{t("turnOffFirst")}</p>}
                <button className={styles.cancel} type="button" onClick={cancel}>{t("cancel")}</button>
              </div>}
              {!leads.some((c) => c.key.startsWith("sata")) && <p className={styles.cablesNote}>{t("noStorageCable")}</p>}
            </div>

            <div className={styles.power}>
              <div className={styles.result} data-result={verdict ?? "idle"} role="status" aria-live="polite">
                {verdict === "success" ? <><CheckIcon /><strong>{t("success")}</strong></> : verdict === "failure" ? <><CrossIcon /><div><strong>{t("failure")}</strong><p>{mode === "fault" ? t("fault.readStages") : missingMessage}</p>
                  {/* The fix for the liquid-cooling rule is also given in Arabic on the English page. */}
                  {rule && locale !== "ar" && <p lang="ar" dir="rtl" className={styles.ruleArabic}>{planned ? arLabs.simplePc.planner.findingText.exercise_needs_liquid : NEEDS_LIQUID_AR}</p>}
                  {rule && <p className={styles.ruleNote}>{t("ruleNote")}</p>}
                </div></> : <span>{t("readyToTry")}</span>}
              </div>
              {mode === "fault" && fault?.solved && <p className={styles.hint} role="status">{t("fault.solved", { fault: t(`fault.kinds.${fault.kind}`) })}</p>}
              {attempt && verdict && <PowerDiagnostics key={`${verdict}-${attempt.startup.outcome}`} state={attempt.state} startup={attempt.startup} />}
              {mode === "fault" && fault && !fault.solved && attempt?.startup.stages.some((st) => st.diagnostics.some((d) => d.code === "cpu_needs_bios_update")) && (
                <button className={styles.cancel} type="button" onClick={() => { const next = flashBios(fault.state); if (next) { setFault({ ...fault, state: next }); setAttempt(null); setVerdict(null); } }}>{t("fault.flashBios")}</button>
              )}
              {mode === "fault"
                ? <button className={styles.powerButton} type="button" onClick={fault?.solved ? newFault : power} disabled={!ready || !fault}><span aria-hidden="true">⏻</span>{fault?.solved ? t("fault.newFault") : t("power")}</button>
                : <button className={styles.powerButton} type="button" onClick={power} disabled={!ready}><span aria-hidden="true">⏻</span>{t(saved.powered ? "powerOff" : "power")}</button>}
              <div className={styles.steps} hidden={mode === "fault"}>
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
