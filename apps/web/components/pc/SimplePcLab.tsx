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
import { buildContext, companionSay, heldLines, intentOf, m2StepLine, nextLine, pickupLine, topicOf, type CompanionEvent, type CompanionSay, type Selection } from "./companion";
import { aimClick, aimTargets, createStepGate, m2LiftPose, nextHandStep, type HandStep } from "./click-assembly";
import { focusOn, moveCamera, selectPart } from "./scene/scene-store";
import {
  ALL_SIMPLE_CABLES, ALL_SIMPLE_PARTS, connectSimpleCable, createSimpleBuild, disconnectSimpleCable, emptySimpleSnapshot, installSimplePart, isM2Key, isRamKey, lastSimpleStep, M2_WHOLE_TILT_DEG, simpleM2Heatsink, simpleM2Slots,
  parseSimpleSnapshot, SIMPLE_PART_LIST, SIMPLE_PARTS, SIMPLE_SAVE_KEY, simpleAllPartsIn, simpleAssemblyComplete, simpleBlock, simpleBuildFromSnapshot,
  simpleCableBlock, simpleCableConnected, simpleCableMissingParts, simpleCablesFor, simplePartInstalled, simplePartsProgress, REMOVABLE, simpleRemoveBlock, simpleRuleBlock,
  simpleSlotPart, simpleSwapBlock, simpleTarget, slotOf, startSimplePC, SWAPPABLE, undoSimpleStep, withCable, withoutCable, withoutPart, withPart, withSwap,
  activateSimpleModel, activeSimpleModel, LEGACY_MODEL, roleOf, simpleRetention, setSimpleMechanism, lowerSimplePart, reseatSimplePart, liftSimplePart,
  withMechanism, withLower, withSeat, withLift, withFasten, withUnfasten, withPrep, withPlace, withScrew, prepSimplePart, placeSimplePart, screwSimplePart, simpleUsesScrews, simpleScrewOrder, simpleIsLiquid, simplePrepMissing, simpleCableEnds, simpleEndPlugged, simplePortChoices, simplePlugKeying, plugSimpleEnd, withPlug, loweredPose, lowerSimpleRam, simpleRamSlots, simpleRamRecommended, simpleRamReference, simpleRamSlotOffsets, simpleRamTargetFor, HELD_REACH_MM, type SimpleHeld, fastenSimplePart, unfastenSimplePart, simpleFastened, caseCoversClosed, SLOT_COVERS_ID, type SimpleAlignment, type SimpleCableKey, type SimpleModel, type SimplePartKey, type SimpleRule, type SimpleSnapshot,
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
/** How long one hand step's animation runs: a repeated click within it is ignored. */
const HAND_STEP_MS = 450;
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
    __ytlSimplePc?: () => { ram?: unknown; placed: string[]; connected: string[]; history: string[]; powered: boolean; selection: Selection; complete: boolean; mood: string; lines: string[]; guide: ReturnType<typeof guideFocus>; view: SimpleView; mode?: string; fault?: string | null; faultSolved?: boolean };
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
  const [optionsChoice, setOptionsChoice] = useState<{ key: string; open: boolean } | null>(null);
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
  /** The lead in hand: which port the learner has picked for its next end, and whether the plug is turned the wrong way. */
  const [plugHold, setPlugHold] = useState<{ key: string; portId: string | null; reversed: boolean } | null>(null);
  /** Physical steps ticked for the part in hand (they reset when another part is picked up). */
  const [ticked, setTicked] = useState(0);
  /** How the learner holds a keyed part (CPU, memory) over its place: turned and off centre until they line it up. */
  const [hold, setHold] = useState<({ key: SimplePartKey } & SimpleAlignment) | null>(null);
  /**
   * One hand step at a time, from every input (view, toolbar, panel buttons, Enter, T): a second click or
   * a repeated key while a step is running is ignored. Selection, turning/nudging the hand and the camera
   * are not steps and are never held back.
   */
  const stepGate = useRef(createStepGate(HAND_STEP_MS));
  const takeStep = () => stepGate.current.take(performance.now());
  const state = mode === "fault" && fault ? fault.state : built;
  /** The retention a part works with now: for an M.2 drive in hand, the one of the slot it is over. */
  const retOf = (key: SimplePartKey) => simpleRetention(state, key, hold?.key === key ? hold.slotId : undefined);
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
      // A part left in hand comes back exactly as it was held (turn and offset), still in hand.
      if (restored.held) { setHold(restored.held); setSelection({ kind: "part", key: restored.held.key }); }
      setVerdict(restored.powered ? "success" : null);
      if (simpleAllPartsIn(simpleBuildFromSnapshot(restored))) setTab("cables");
    }
    // The welcome back speaks from what was saved: the part in hand and its pose, else the build's progress.
    const held = restored?.held ?? null;
    speak(companionSay(snapshot.history.length > 0 || held ? { type: "resume", held } : { type: "start" }, simpleBuildFromSnapshot(snapshot), snapshot.powered, held ? { kind: "part", key: held.key } : null));
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
  // The pose of a part in hand is saved with the progress, so a reload does not reset it.
  useEffect(() => {
    if (!ready || mode === "fault") return;
    const held: SimpleHeld | null = hold ? { key: hold.key, rotationDeg: hold.rotationDeg, offsetMm: hold.offsetMm, ...(hold.tiltDeg === undefined ? {} : { tiltDeg: hold.tiltDeg }), ...(hold.slotId ? { slotId: hold.slotId } : {}) } : null;
    setSaved((previous) => (JSON.stringify(previous.held ?? null) === JSON.stringify(held) ? previous : { ...previous, held }));
  }, [ready, mode, hold]);

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

  // For browser checks: the memory module's slot as each part of the page sees it (set while rendering).
  const ramDebug = useRef<unknown>(null);
  useEffect(() => {
    window.__ytlSimplePc = () => ({
      ram: ramDebug.current,
      placed: [...saved.placed], connected: [...saved.connected], history: [...saved.history], powered: saved.powered, selection, complete,
      mood: message.say.mood, lines: message.say.lines.map((line) => line.key), guide, view, mode, fault: fault?.kind ?? null, faultSolved: fault?.solved ?? false,
    });
    return () => { delete window.__ytlSimplePc; };
  }, [saved, selection, complete, message, guide, view, mode, fault]);

  // ---------- Learner actions ----------

  /** Which hands-on routine a keyed part follows: socket and plate, memory latch, or card latch and bracket. */
  const handKind = (retKind: string): "cpu" | "ram" | "gpu" | "m2" => (retKind === "dimm_latch" ? "ram" : retKind === "pcie_latch" ? "gpu" : retKind === "m2_qlatch" || retKind === "m2_screw" ? "m2" : "cpu");
  /** How a keyed part comes off the bench: turned and off centre, so lining it up is the learner's job. */
  const pickup = (key: SimplePartKey, retKind: string) => {
    const k = handKind(retKind);
    // A CPU comes up from the bench beside the socket, turned: bringing it over the socket is the learner's job.
    // A memory module comes up beside the slots (over none of them), the wrong way round.
    const ramStart: [number, number] = [6, Math.min(...[...simpleRamSlotOffsets(state).values()].map((o) => o[1]), 0) - 7];
    return { key, rotationDeg: k === "cpu" ? 90 : 180, offsetMm: (k === "cpu" ? [-32, -18] : k === "ram" ? ramStart : k === "m2" ? [4, 0] : [4, 3]) as [number, number] };
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
    const first = pickupLine(state, key);
    if (first) { speak({ lines: [first], mood: "point", point: "scene" }); return; }
    react({ type: "select", selection: next }, state, lockedOn, next);
  }

  function chooseCable(key: SimpleCableKey) {
    setConfirmRestart(false);
    if (selection?.kind === "cable" && selection.key === key) { cancel(); return; }
    const next: Selection = { kind: "cable", key };
    setSelection(next);
    // A plug comes out of the bag any way round: turning it to match the socket's key is the learner's job.
    setPlugHold({ key, portId: null, reversed: true });
    setGuided(true);
    setTab("cables");
    react({ type: "select", selection: next }, state, saved.powered, next);
  }

  function cancel() {
    if (!selection) return;
    setSelection(null);
    // Put down: nothing is in hand, so a reload does not bring the part back into it.
    if (selection.kind === "part") setHold(null);
    react({ type: "cancel" }, state, saved.powered, null);
  }

  /** A part fitted with its own preparation and screws goes in only through its panel (not one generic install). */
  function screwedByHand(key: SimplePartKey): boolean {
    if (!(simpleUsesScrews(key) || simpleIsLiquid(key)) || simplePartInstalled(state, key)) return false;
    const rival = simpleSlotPart(state, slotOf(key));
    if (rival && rival !== key) return false;
    if (!(selection?.kind === "part" && selection.key === key)) choosePart(key);
    return true;
  }
  function install(key: SimplePartKey) {
    if (mode === "fault") {
      if (!fault || fault.solved) return;
      if (simpleRetention(state, key)) { primaryHand(key); return; }
      if (screwedByHand(key)) return;
      if (!takeStep()) return;
      const step = installSimplePart(state, key);
      if (step.ok) { setFault({ ...fault, state: step.state }); setSelection(null); react({ type: "installed", key }, step.state, false, null); }
      return;
    }
    if (saved.powered) return;
    // A keyed part goes in only through its mechanism and alignment; a screwed one through its own steps.
    if (simpleRetention(state, key)) { primaryHand(key); return; }
    if (screwedByHand(key)) return;
    // The physical steps come first (pushing a resting part home has none to repeat).
    if (!simplePartInstalled(state, key) && ticked < substepsFor(key).length && !simpleSlotPart(state, slotOf(key))) { speak({ lines: [{ key: "blocked.substeps" }], mood: "concerned", point: "parts" }); return; }
    const rival = simpleSlotPart(state, slotOf(key));
    if (!takeStep()) return;
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
  function keepHand(next: ReturnType<typeof createSimpleBuild>, step: (s: SimpleSnapshot) => SimpleSnapshot, line: string, mood: "happy" | "point" | "concerned" = "point", values?: Record<string, string>) {
    if (mode === "fault") { if (fault) setFault({ ...fault, state: next }); }
    else setSaved((previous) => step(previous));
    setVerdict(null);
    speak({ lines: [values ? { key: `hands.${line}`, values } : { key: `hands.${line}` }], mood, point: "scene" });
  }
  function handMechanism(key: SimplePartKey, desired: "open" | "closed") {
    if (lockedOn || (mode === "fault" && (!fault || fault.solved))) return;
    if (!takeStep()) return;
    const ret = retOf(key);
    if (ret && isM2Key(key)) {
      const r = setSimpleMechanism(state, ret.id, desired);
      if (!r.ok) { sayEngine(r.message, desired === "open" ? "closeBlocked" : "m2LowerFirst"); return; }
      if (mode === "fault") { if (fault) setFault({ ...fault, state: r.state }); } else setSaved((previous) => withMechanism(previous, ret.id, desired));
      setVerdict(null);
      m2Say(r.state, key, hold?.key === key ? hold : null, desired === "closed" ? "happy" : "point");
      return;
    }
    if (!ret) return;
    const r = setSimpleMechanism(state, ret.id, desired);
    const k = handKind(ret.kind);
    const cpu = k === "cpu";
    if (!r.ok) {
      const cooler = /cooler/.test(r.message?.en ?? "");
      const leverFirst = /lever/.test(r.message?.en ?? "") && desired === "open";
      speak({ lines: [{ key: k === "gpu" ? "hands.closeBlocked" : cooler ? "hands.coolerOver" : leverFirst ? "hands.cpuOpenFirst" : desired === "open" ? "hands.closeBlocked" : `hands.${k === "m2" ? "m2" : "cpu"}LowerFirst` }], mood: "concerned", point: "scene" });
      return;
    }
    const attached = (r.state.parts.find((p) => p.instanceId === partSpec(key).id)?.attachments.length ?? 0) > 0;
    // The Intel plate closes before its lever locks; the AM4 lever closes the socket by itself.
    const plateLine = ret.leverId ? (desired === "open" ? (attached ? "cpuPlateOpenSeated" : "cpuOpen") : "cpuPlateClosed") : null;
    const line = plateLine ?? (cpu || k === "m2" ? (desired === "open" ? (attached ? `${k}Released` : `${k}Open`) : `${k}Closed`) : attached ? `${k}Released` : `${k}Open`);
    keepHand(r.state, (sn) => withMechanism(sn, ret.id, desired), line, desired === "closed" ? "happy" : "point");
    if ((cpu || k === "m2") && desired === "closed" && simplePartInstalled(r.state, key)) { setSelection(null); setHold(null); if (simpleAllPartsIn(r.state)) setTab("cables"); }
  }
  /** The Intel socket's load lever: released from its tab and lifted, or pushed down and locked under it. */
  function handLever(key: SimplePartKey, desired: "open" | "closed") {
    if (lockedOn || (mode === "fault" && (!fault || fault.solved))) return;
    if (!takeStep()) return;
    const ret = simpleRetention(state, key);
    if (!ret?.leverId) return;
    const r = setSimpleMechanism(state, ret.leverId, desired);
    if (!r.ok) {
      const cooler = /cooler|المبرّد/.test(r.message?.en ?? "");
      speak({ lines: [{ key: cooler ? "hands.coolerOver" : desired === "closed" ? "hands.cpuPlateFirst" : "hands.closeBlocked" }], mood: "concerned", point: "scene" });
      return;
    }
    const attached = (r.state.parts.find((p) => p.instanceId === partSpec(key).id)?.attachments.length ?? 0) > 0;
    keepHand(r.state, (sn) => withMechanism(sn, ret.leverId!, desired), desired === "open" ? (attached ? "cpuLeverReleased" : "cpuLeverUp") : attached ? "cpuClosed" : "cpuLeverDown", desired === "closed" && attached ? "happy" : "point");
    if (desired === "closed" && simplePartInstalled(r.state, key)) { setSelection(null); setHold(null); }
  }
  /** Clamps a dragged pose to the reach over the board (it never leaves the socket area or goes through parts). */
  /** A memory slot's clip, clicked in the view or with its button: opens it, or closes it over an empty slot. */
  function handClip(slotId: string, near: boolean) {
    if (lockedOn || (mode === "fault" && (!fault || fault.solved))) return;
    if (!takeStep()) return;
    const slot = simpleRamSlots(state).find((x) => x.id === slotId);
    const id = slot ? (near ? slot.nearId : slot.clipId) : null;
    if (!slot || !id) return;
    const desired = (near ? slot.nearOpen : slot.clipOpen) ? "closed" : "open";
    const r = setSimpleMechanism(state, id, desired);
    if (!r.ok) { speak({ lines: [{ key: "hands.ramClipBlocked" }], mood: "concerned", point: "scene" }); return; }
    const released = desired === "open" && slot.occupant !== null;
    keepHand(r.state, (sn) => withMechanism(sn, id, desired), desired === "open" ? (released ? "ramReleased" : "ramClipOpen") : "ramClipClosed");
    if (released && slot.occupant) setSelection({ kind: "part", key: slot.occupant });
  }
  /** Lowers the held module into the slot it is over: it rests there until pressed home. */
  function handRamLower(key: SimplePartKey) {
    if (lockedOn || !hold || hold.key !== key) return;
    if (!takeStep()) return;
    const r = lowerSimpleRam(state, key, hold);
    const slotName = (id?: string) => { const sl = simpleRamSlots(state).find((x) => x.id === id); return sl ? (locale === "ar" ? sl.label.ar : sl.label.en).replace(/ \(.*\)$/, "") : ""; };
    if (!r.ok) {
      if (r.reason === "cannotFit" && r.message) { sayEngine(r.message, "ramCentre"); return; }
      const line = r.reason === "noSlot" ? "ramNoSlot" : r.reason === "slotTaken" ? "ramSlotTaken" : r.reason === "openFirst" ? (simpleRamSlots(state).find((x) => x.id === r.slotId)?.nearId ? "ramOpenBoth" : "ramOpenFirst") : r.reason === "turnPart" ? "ramTurn" : r.reason === "centrePart" ? "ramCentre" : null;
      if (line) speak({ lines: [{ key: `hands.${line}`, values: { slot: slotName(r.slotId) } }], mood: "concerned", point: "scene" });
      else react({ type: "select", selection: { kind: "part", key } });
      return;
    }
    const pose = { rotationDeg: hold.rotationDeg, offsetMm: hold.offsetMm };
    setHold(null);
    if (mode === "fault") { if (fault) setFault({ ...fault, state: r.state }); } else setSaved((previous) => withLower(previous, key, pose));
    setVerdict(null);
    // A slot the manual does not recommend for this many modules still works: it is explained, not refused.
    const count = ALL_SIMPLE_PARTS.filter((p) => isRamKey(p.key) && (r.state.parts.find((x) => x.instanceId === p.id)?.attachments.length ?? 0) > 0).length;
    const rec = simpleRamRecommended(r.state, count);
    const lines: { key: string; values?: Record<string, string> }[] = [{ key: "hands.ramResting", values: { slot: slotName(r.slotId) } }];
    // The whole layout counts: B1 then A2 is not the recommended A2 + B2 even though A2 itself is in it.
    const used = simpleRamSlots(r.state).filter((x) => x.occupant).map((x) => x.id);
    if (rec.length && !used.every((id) => rec.includes(id))) lines.push({ key: "hands.ramNotRecommended", values: { n: String(count), rec: rec.map((id) => slotName(id)).join(locale === "ar" ? " و" : " and ") } });
    speak({ lines, mood: "point", point: "scene" });
  }
  function handLower(key: SimplePartKey) {
    if (isRamKey(key)) { handRamLower(key); return; }
    if (isM2Key(key)) { handM2Insert(key); return; }
    if (lockedOn || !hold || hold.key !== key) return;
    if (!takeStep()) return;
    const ret = simpleRetention(state, key);
    const k = handKind(ret?.kind ?? "");
    const cpu = k === "cpu";
    const r = lowerSimplePart(state, key, hold);
    if (!r.ok) {
      const first = k === "gpu" ? (caseCoversClosed(state) ? "gpuCoversFirst" : "gpuLatchFirst") : ret?.leverId && ret.leverOpen ? "cpuPlateNext" : `${k}OpenFirst`;
      const line = r.reason === "openFirst" ? first : r.reason === "turnPart" ? `${k}Turn` : r.reason === "centrePart" ? `${k}Centre` : null;
      if (line) speak({ lines: [{ key: `hands.${line}` }], mood: "concerned", point: "scene" });
      else react({ type: "select", selection: { kind: "part", key } });
      return;
    }
    setHold(null);
    keepHand(r.state, (sn) => withLower(sn, key, cpu ? { rotationDeg: hold.rotationDeg, offsetMm: hold.offsetMm } : undefined), cpu ? "cpuLowered" : k === "gpu" ? "gpuIn" : k === "m2" ? "m2Lowered" : "ramIn", "happy");
    if (k === "ram") { setSelection(null); if (simpleAllPartsIn(r.state)) setTab("cables"); }
  }
  /** An M.2 drive: its next line comes from the step the build is now at (the same as the toolbar's). */
  function m2Say(next: ReturnType<typeof createSimpleBuild>, key: SimplePartKey, held: SimpleHeld | null, mood: "happy" | "point" = "point") {
    const line = m2StepLine(next, key, held) ?? (simplePartInstalled(next, key) ? { key: "hands.m2Done" } : null);
    if (line) speak({ lines: [line], mood: simplePartInstalled(next, key) ? "happy" : mood, point: "scene" });
  }
  /** An M.2 drive in hand goes into the slot it is over, tilted as the learner holds it; it rests there at an angle. */
  function handM2Insert(key: SimplePartKey) {
    if (lockedOn || !hold || hold.key !== key) return;
    if (!takeStep()) return;
    const r = lowerSimplePart(state, key, hold);
    if (!r.ok) { sayEngine(r.message, r.reason === "turnPart" ? "m2Turn" : r.reason === "centrePart" ? "m2Centre" : "m2OpenFirst"); return; }
    const pose = { rotationDeg: hold.rotationDeg, offsetMm: hold.offsetMm, ...(hold.tiltDeg === undefined ? {} : { tiltDeg: hold.tiltDeg }), ...(hold.slotId ? { slotId: hold.slotId } : {}) };
    setHold(null);
    if (mode === "fault") { if (fault) setFault({ ...fault, state: r.state }); } else setSaved((previous) => withLower(previous, key, pose));
    setVerdict(null);
    m2Say(r.state, key, null);
  }
  /** An M.2 heatsink: one of its five steps (screws out, lift, film, refit, screws in). */
  function handHeatsink(key: SimplePartKey, hsId: string, step: "screws" | "lift" | "film" | "fit" | "tighten") {
    if (handsOff()) return;
    if (!takeStep()) return;
    const [id, desired] = ({ screws: [`${hsId}:screws`, "open"], lift: [hsId, "open"], film: [`${hsId}:film`, "open"], fit: [hsId, "closed"], tighten: [`${hsId}:screws`, "closed"] } as const)[step];
    const r = setSimpleMechanism(state, id, desired);
    if (!r.ok) { sayEngine(r.message, "closeBlocked"); return; }
    if (mode === "fault") { if (fault) setFault({ ...fault, state: r.state }); } else setSaved((previous) => withMechanism(previous, id, desired));
    setVerdict(null);
    m2Say(r.state, key, hold?.key === key ? hold : null, step === "tighten" ? "happy" : "point");
    if (step === "tighten" && simplePartInstalled(r.state, key)) { setSelection(null); setHold(null); }
  }
  /** A screw-held M.2 slot: the screw stand goes in at the drive's length hole. */
  function handStand(key: SimplePartKey) {
    if (handsOff()) return;
    if (!takeStep()) return;
    const ret = retOf(key);
    if (!ret?.standId) return;
    const r = setSimpleMechanism(state, ret.standId, "closed");
    if (!r.ok) { sayEngine(r.message, "closeBlocked"); return; }
    if (mode === "fault") { if (fault) setFault({ ...fault, state: r.state }); } else setSaved((previous) => withMechanism(previous, ret.standId!, "closed"));
    setVerdict(null);
    m2Say(r.state, key, hold?.key === key ? hold : null);
  }
  /** Tilts the drive in hand up to the insertion angle, or lays it flat again (never done for the learner). */
  function tiltHeld(up: boolean) {
    if (!hold || !isM2Key(hold.key) || handsOff()) return;
    if (!takeStep()) return;
    const next = { ...hold, tiltDeg: up ? M2_WHOLE_TILT_DEG : 0 };
    setHold(next);
    const line = m2StepLine(state, hold.key, next);
    speak({ lines: [{ key: up ? "hands.m2Tilted" : "hands.m2Flat" }, ...(line && up ? [line] : [])], mood: "point", point: "scene" });
  }
  function handSeat(key: SimplePartKey) {
    if (lockedOn) return;
    if (!takeStep()) return;
    const r = reseatSimplePart(state, key);
    if (!r.ok) return;
    // An M.2 drive pressed flat is not held yet: the latch or screw comes next, with the drive still selected.
    if (isM2Key(key)) { keepHand(r.state, (sn) => withSeat(sn, key), "m2Pressed"); m2Say(r.state, key, null); return; }
    keepHand(r.state, (sn) => withSeat(sn, key), "ramIn", "happy");
    setSelection(null);
    setHold(null);
  }
  function handLift(key: SimplePartKey) {
    if (lockedOn) return;
    if (!takeStep()) return;
    const ret = simpleRetention(state, key);
    const k = handKind(ret?.kind ?? "");
    // An M.2 drive: its pose in hand is read from the slot it is in now, before it comes out.
    const m2Pose = m2LiftPose(state, key);
    const r = liftSimplePart(state, key);
    if (!r.ok) {
      const line = r.reason === "unplugFirst" ? "gpuUnplug" : r.reason === "unscrewFirst" ? "gpuUnscrew" : k === "gpu" ? "gpuReleaseFirst" : k === "ram" && ret?.nearId ? "ramOpenBoth" : `${k}OpenFirst`;
      speak({ lines: [{ key: `hands.${line}` }], mood: "concerned", point: "scene" });
      return;
    }
    // A drive comes up out of its slot at its insertion angle and stays in hand over that same connector,
    // turned as it was in: it is not moved, turned or given another slot for the learner.
    if (m2Pose) {
      keepHand(r.state, (sn) => withLift(sn, key), "m2Lifted", "point", { slot: m2SlotName(m2Pose.slotId!) });
      setHold(m2Pose);
      return;
    }
    keepHand(r.state, (sn) => withLift(sn, key), isRamKey(key) ? "ramLifted" : "lifted");
    // A module comes straight up out of its slot: held right above it, the way it was in.
    const from = isRamKey(key) ? simpleRamSlotOffsets(state).get(ret?.mountPointId ?? "") : undefined;
    if (from) setHold({ key, rotationDeg: 0, offsetMm: from });
    else if (ret) setHold(pickup(key, ret.kind));
  }
  /** Says an engine refusal as the engine worded it, in the page's language. */
  const sayEngine = (message: { en: string; ar: string } | undefined, fallback: string) =>
    speak({ lines: [message ? { key: "hands.engine", values: { text: locale === "ar" ? message.ar : message.en } } : { key: `hands.${fallback}` }], mood: "concerned", point: "scene" });
  const handsOff = () => lockedOn || (mode === "fault" && (!fault || fault.solved));
  function handPrep(key: SimplePartKey, prep: "paste" | "film" | "standoffs" | "io_shield" | "psu_fan" | "airflow", value: string, line: string) {
    if (handsOff()) return;
    if (!takeStep()) return;
    const r = prepSimplePart(state, key, prep, value);
    if (!r.ok) { sayEngine(r.message, "closeBlocked"); return; }
    keepHand(r.state, (sn) => withPrep(sn, key, prep, value), line);
  }
  function handPlace(key: SimplePartKey, line: string) {
    if (handsOff()) return;
    if (!takeStep()) return;
    const r = placeSimplePart(state, key);
    if (!r.ok) {
      if (r.reason === "prepMissing" || r.reason === "prepWrong") sayEngine(r.message, "closeBlocked");
      else react({ type: "select", selection: { kind: "part", key } });
      return;
    }
    keepHand(r.state, (sn) => withPlace(sn, key), line);
  }
  function handPlug(key: SimpleCableKey, endIndex: number) {
    if (handsOff() || !plugHold || plugHold.key !== key) return;
    if (!takeStep()) return;
    if (!plugHold.portId) { speak({ lines: [{ key: "hands.pickPort" }], mood: "point", point: "cables" }); return; }
    const r = plugSimpleEnd(state, key, endIndex, plugHold.portId, plugHold.reversed);
    if (!r.ok) {
      if (r.reason === "reversed") {
        const end = simpleCableEnds(key)[endIndex]!;
        const connector = simplePortChoices(state, end).find((c) => c.portId === end.portId)?.connector ?? "";
        speak({ lines: [{ key: `hands.reversed.${simplePlugKeying(connector)}` }], mood: "concerned", point: "cables" });
      } else if (r.reason === "wrongPort") {
        if (r.message) sayEngine(r.message, "wrongPort");
        else speak({ lines: [{ key: "hands.wrongPort" }], mood: "concerned", point: "cables" });
      } else speak({ lines: [{ key: r.reason === "turnOffFirst" ? "blocked.turnOff" : "hands.wrongPort" }], mood: "concerned", point: "cables" });
      return;
    }
    const ends = simpleCableEnds(key);
    const all = ends.every((e) => simpleEndPlugged(r.state, e));
    if (mode === "fault") { if (fault) setFault({ ...fault, state: r.state }); }
    else setSaved((previous) => withPlug(previous, key, endIndex));
    setVerdict(null);
    setPlugHold({ key, portId: null, reversed: true });
    if (all) { setSelection(null); setPlugHold(null); react({ type: "connected", key }, r.state, false, null); }
    else speak({ lines: [{ key: "hands.endIn" }], mood: "point", point: "cables" });
  }

  /** A liquid cooler, once its paste is on: pump block on the CPU and radiator in the case. */
  function handFitLiquid(key: SimplePartKey) {
    if (handsOff()) return;
    if (!takeStep()) return;
    if (simplePrepMissing(state, key).length > 0) { speak({ lines: [{ key: "hands.liquidPrep" }], mood: "concerned", point: "scene" }); return; }
    const step = installSimplePart(state, key);
    if (!step.ok) { react({ type: "select", selection: { kind: "part", key } }); return; }
    if (mode === "fault") { if (fault) setFault({ ...fault, state: step.state }); }
    else setSaved((previous) => withPart(previous, key));
    setSelection(null);
    setVerdict(null);
    if (simpleAllPartsIn(step.state)) setTab("cables");
    react({ type: "installed", key }, step.state, false, null);
  }
  function handScrew(key: SimplePartKey, corner: number) {
    if (handsOff()) return;
    if (!takeStep()) return;
    if (mode !== "fault") {
      const order = simpleScrewOrder(saved.history, key);
      if (order.done.includes(corner)) return;
      if (order.next !== null && corner !== order.next) { speak({ lines: [{ key: "hands.screwDiagonal", values: { corner: t(`hands.corner${order.next}`) } }], mood: "concerned", point: "scene" }); return; }
    }
    const r = screwSimplePart(state, key);
    if (!r.ok) return;
    const done = simplePartInstalled(r.state, key);
    keepHand(r.state, (sn) => withScrew(sn, key, corner), done ? "screwsDone" : "screwIn", done ? "happy" : "point");
    if (done) { setSelection(null); if (simpleAllPartsIn(r.state)) setTab("cables"); }
  }

  /** The case's expansion-slot covers beside the card's slot: out before a card, back once no card is there. */
  function handCovers(desired: "open" | "closed") {
    if (lockedOn || (mode === "fault" && (!fault || fault.solved))) return;
    if (!takeStep()) return;
    const r = setSimpleMechanism(state, SLOT_COVERS_ID, desired);
    if (!r.ok) { speak({ lines: [{ key: "hands.coversBlocked" }], mood: "concerned", point: "scene" }); return; }
    keepHand(r.state, (sn) => withMechanism(sn, SLOT_COVERS_ID, desired), desired === "open" ? "coversOut" : "coversIn");
  }
  function handFasten(key: SimplePartKey) {
    if (lockedOn || (mode === "fault" && (!fault || fault.solved))) return;
    if (!takeStep()) return;
    const r = fastenSimplePart(state, key);
    if (!r.ok) { speak({ lines: [{ key: "hands.gpuSeatFirst" }], mood: "concerned", point: "scene" }); return; }
    keepHand(r.state, (sn) => withFasten(sn, key), "gpuScrewed", "happy");
    setSelection(null);
    if (simpleAllPartsIn(r.state)) setTab("cables");
  }
  function handUnfasten(key: SimplePartKey) {
    if (lockedOn || (mode === "fault" && (!fault || fault.solved))) return;
    if (!takeStep()) return;
    const r = unfastenSimplePart(state, key);
    if (!r.ok) return;
    keepHand(r.state, (sn) => withUnfasten(sn, key), "gpuUnscrewed");
  }
  const turn = (deg: number) => setHold((h) => (h ? { ...h, rotationDeg: (((h.rotationDeg + deg) % 360) + 360) % 360 } : h));
  /**
   * Where a held part may be: within reach of its place, and for a CPU not past the socket's far edge
   * or the lever side, where the opened plate and the raised lever stand (it never moves through them).
   */
  const clampHeld = (key: SimplePartKey, offsetMm: [number, number]): [number, number] => {
    let [x, z] = offsetMm;
    if (handKind(simpleRetention(state, key)?.kind ?? "") === "cpu") { x = Math.min(x, 6); z = Math.min(z, 3); }
    if (isRamKey(key)) {
      // Over the memory slots only: a little past the end slots across, a little either way along.
      const across = [...simpleRamSlotOffsets(state).values()].map((o) => o[1]);
      if (across.length) { z = Math.max(Math.min(...across) - 8, Math.min(Math.max(...across) + 8, z)); }
      x = Math.max(-12, Math.min(12, x));
    }
    const d = Math.hypot(x, z);
    const k = d > HELD_REACH_MM ? HELD_REACH_MM / d : 1;
    return [Math.round(x * k * 2) / 2, Math.round(z * k * 2) / 2];
  };
  // A module or an M.2 drive only slides along its slot; a CPU or card can be off in both directions.
  // An M.2 drive only slides along its slot; a memory module also moves across the slots (that is how a slot is chosen).
  const alongOnly = (key: SimplePartKey) => simpleRetention(state, key)?.kind === "m2_qlatch";
  const nudge = (dx: number, dz: number) => setHold((h) => (h ? { ...h, offsetMm: clampHeld(h.key, [Math.round((h.offsetMm[0] + dx) * 10) / 10, alongOnly(h.key) ? 0 : Math.round((h.offsetMm[1] + dz) * 10) / 10]) } : h));

  /** Replaces the CPU or cooler that is in with its alternative. */
  function swap(from: SimplePartKey, to: SimplePartKey) {
    const blocked = simpleSwapBlock(state, to);
    if (blocked) { react({ type: "removeBlocked", key: from, reason: blocked }); return; }
    if (!takeStep()) return;
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
    if (!takeStep()) return;
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
      if (!simpleCableConnected(state, key)) { if (!(selection?.kind === "cable" && selection.key === key)) chooseCable(key); return; }
      if (!takeStep()) return;
      const step = connectSimpleCable(state, key);
      if (step.ok) { setFault({ ...fault, state: step.state }); setSelection(null); react({ type: "connected", key }, step.state, false, null); }
      return;
    }
    if (saved.powered) { react({ type: "select", selection: { kind: "cable", key } }); return; }
    // Each end goes in by hand (see CablePanel): pick the port, turn the plug, push it home.
    if (!simpleCableConnected(state, key)) { if (!(selection?.kind === "cable" && selection.key === key)) chooseCable(key); return; }
    if (!takeStep()) return;
    const step = connectSimpleCable(state, key);
    if (!step.ok) { react({ type: "select", selection: { kind: "cable", key } }); return; }
    if (simpleCableConnected(state, key)) return;
    setSaved((previous) => withCable(previous, key));
    setSelection(null);
    setVerdict(null);
    react({ type: "connected", key }, step.state, false, null);
  }

  function unplug(key: SimpleCableKey) {
    if (!takeStep()) return;
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
    // A keyed part's own place (any memory slot for a module): aim the part in hand at it, or take the next step there.
    if ((role === "target" || role === "aim") && selection.kind === "part" && simpleRetention(state, selection.key)) {
      const inPlace = (state.parts.find((p) => p.instanceId === partSpec(selection.key).id)?.attachments.length ?? 0) > 0;
      if (hold?.key === selection.key && !inPlace) aimAt(selection.key, place);
      else primaryHand(selection.key);
      return;
    }
    if (role === "target") {
      if (selection.kind === "part") install(selection.key);
      else connect(selection.key);
      return;
    }
    if (selection.kind === "part") react({ type: "wrongPlace", key: selection.key, place });
    else react({ type: "wrongPort", key: selection.key, portOf: cableOfPort(place, state) });
  }

  /**
   * A click on a real place with a keyed part in hand: the part comes over that place exactly as the
   * learner turned it (never turned for them). On the place it is already over, the click is the next step.
   */
  function aimAt(key: SimplePartKey, placeId: string) {
    if (!hold || hold.key !== key) { primaryHand(key); return; }
    if (handsOff()) { if (lockedOn) speak({ lines: [{ key: "blocked.turnOff" }], mood: "concerned", point: "power" }); return; }
    const r = aimClick(state, hold, placeId);
    if (!r.ok) {
      if (r.reason === "slotTaken") speak({ lines: [isM2Key(key) ? { key: "hands.m2SlotTaken", values: { slot: m2SlotName(placeId) } } : { key: "hands.ramSlotTaken", values: { slot: ramSlotName(placeId) } }], mood: "concerned", point: "scene" });
      else if (r.reason === "doesNotFit") speak({ lines: [{ key: "hands.m2NoFit", values: { slot: m2SlotName(placeId) } }], mood: "concerned", point: "scene" });
      else if (r.reason === "notItsPlace") speak({ lines: [{ key: "aim.notHere" }], mood: "concerned", point: "scene" });
      else react({ type: "select", selection: { kind: "part", key } });
      return;
    }
    // Over the place it is already over (same slot, same pose): the click is the next step there.
    // Another place (another M.2 or memory slot, or onto the socket): only the hand moves, no step is
    // taken, and a double click on the slot does not also take one.
    if (!r.moved) { primaryHand(key); return; }
    stepGate.current.arm(performance.now());
    setHold(r.held);
    speak({ lines: heldLines(state, r.held) ?? [{ key: "aim.ready" }], mood: "point", point: "scene" });
  }

  /** What a tap on a keyed part's place (or the action above the view) does now: exactly one checked step. */
  function primaryHand(key: SimplePartKey) {
    runStep(key, nextHandStep(state, key, hold));
  }
  function runStep(key: SimplePartKey, step: HandStep) {
    if (!step || handsOff()) return;
    // A double click or a repeated key during the step's animation does not take a second step
    // (the step's own function below passes the same gate: it is the same input).
    if (!takeStep()) return;
    switch (step.kind) {
      case "aim": {
        // One place only (socket, card slot, M.2 slot): the action can bring it there. Memory: the learner picks the slot.
        const ret = simpleRetention(state, key);
        if (!isRamKey(key) && !isM2Key(key) && ret && hold?.key === key) { aimAt(key, ret.mountPointId); return; }
        speak({ lines: [isM2Key(key) ? { key: "hands.m2Pick" } : { key: isRamKey(key) ? "aim.ramFirst" : "aim.first" }], mood: "point", point: "scene" });
        return;
      }
      case "slotTaken": speak({ lines: [{ key: "hands.ramSlotTaken", values: { slot: ramSlotName(step.slotId) } }], mood: "concerned", point: "scene" }); return;
      case "clip": handClip(step.slotId, step.near); return;
      case "lever": handLever(key, step.desired); return;
      case "mechanism": handMechanism(key, step.desired); return;
      case "covers": handCovers("open"); return;
      case "lower": handLower(key); return;
      case "seat": handSeat(key); return;
      case "fasten": handFasten(key); return;
      case "heatsink": handHeatsink(key, step.hsId, step.step); return;
      case "stand": handStand(key); return;
      case "tilt": tiltHeld(true); return;
    }
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
    // Undoing a lowering puts the part back in hand, above its place, exactly as it was held before.
    const pose = loweredPose(step);
    if (pose) { setSelection({ kind: "part", key: pose.key }); setHold(pose); }
    else setSelection(null);
    setVerdict(null);
    if (step.startsWith("part:")) setTab("parts");
    react({ type: "undo", step }, after, false, pose ? { kind: "part", key: pose.key } : null);
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
    // A memory module: the slot it is in, else the slot it is held over, else none. Never a default slot.
    if (isRamKey(key)) {
      const ramIn = state.parts.find((p) => p.instanceId === partSpec(key).id)?.attachments[0];
      const over = !ramIn && hold?.key === key ? simpleRamTargetFor(state, hold.offsetMm) : null;
      const id = ramIn?.target.mountPointId ?? over?.slotId;
      if (!id) return t("hands.overNoSlot");
      const name = ramSlotName(id);
      return ramIn ? (ramIn.seating === "seated" ? name : t("hands.inSlot", { slot: name })) : t("hands.overSlot", { slot: name });
    }
    const target = simpleTarget(state, key);
    if (!planned) return t(`companion.places.${target.mountPointId}`);
    const host = entryOf(state.parts.find((p) => p.instanceId === target.hostInstanceId)?.catalogId);
    return host?.mountPoints.find((m) => m.id === target.mountPointId)?.label[lang] ?? target.mountPointId;
  };
  /** A memory slot's name as printed on the board (DIMM_A2), from the catalog label. */
  /** An M.2 slot's printed name (M.2_1). */
  const m2SlotName = (id: string) => simpleM2Slots(state, ALL_SIMPLE_PARTS.find((p) => isM2Key(p.key))?.key ?? "storage").find((x) => x.id === id)?.label.en.match(/M\.2_\d+/)?.[0] ?? id;
  const ramSlotName = (id: string) => {
    const sl = simpleRamSlots(state).find((x) => x.id === id);
    return sl ? (lang === "ar" ? sl.label.ar : sl.label.en).replace(/ \(.*\)$/, "") : id;
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
  const keyed = selectedPart ? retOf(selectedPart) : null;
  // Undoing a lowering puts the CPU back in hand where it was lowered from: over the socket, lined up
  // (it could only have been lowered lined up).
  const inPlaceNow = selectedPart ? (state.parts.find((p) => p.instanceId === partSpec(selectedPart).id)?.attachments.length ?? 0) > 0 : false;
  useEffect(() => {
    if (!selectedPart || !keyed || inPlaceNow || hold?.key === selectedPart || handKind(keyed.kind) !== "cpu") return;
    setHold({ key: selectedPart, rotationDeg: 0, offsetMm: [0, 0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPart, inPlaceNow]);
  const cpuKind: "lga" | "zif" | null = selectedPart && keyed && handKind(keyed.kind) === "cpu" ? (keyed.leverId ? "lga" : "zif") : null;
  const cpuStep = cpuKind && selectedPart ? cpuFocus(selectedPart) : null;
  // The CPU's socket in the view: its lever and plate answer clicks and taps (one checked step each).
  const socketHands = cpuKind && selectedPart && keyed ? {
    hostInstanceId: keyed.hostInstanceId,
    highlight: cpuStep,
    onLever: () => (keyed.leverId ? handLever(selectedPart, keyed.leverOpen ? "closed" : "open") : handMechanism(selectedPart, keyed.open ? "closed" : "open")),
    onPlate: keyed.leverId ? () => handMechanism(selectedPart, keyed.open ? "closed" : "open") : undefined,
  } : null;
  // Memory in hand: the slot it is over, the clip the next step is about, and clip clicks in the view.
  const ramKey = selectedPart && isRamKey(selectedPart) ? selectedPart : null;
  const ramAt = ramKey ? state.parts.find((p) => p.instanceId === partSpec(ramKey).id)?.attachments[0] : undefined;
  const ramTarget = ramKey && !ramAt && hold?.key === ramKey ? simpleRamTargetFor(state, hold.offsetMm) : null;
  const ramSlot = ramKey ? simpleRamSlots(state).find((x) => x.id === (ramAt ? ramAt.target.mountPointId : ramTarget?.slotId)) : undefined;
  const ramGlow = ramSlot && (!ramSlot.occupant || ramSlot.occupant === ramKey) && !(ramAt && ramAt.seating !== "seated")
    ? (!ramSlot.clipOpen && !(ramAt?.seating === "seated") ? { slotId: ramSlot.id, near: false } : ramSlot.nearId && !ramSlot.nearOpen && !(ramAt?.seating === "seated") ? { slotId: ramSlot.id, near: true } : null) : null;
  const ramScene = { onClip: handClip, glowClip: ramGlow, targetSlot: ramTarget?.slotId ?? null, targetOk: Boolean(ramTarget && Math.hypot(ramTarget.residual[0], ramTarget.residual[1]) <= 1.5 && hold?.rotationDeg === 0) };
  // The robot points at the exact piece the next step is about: a socket part, a memory clip, or the slot.
  const ramGuideTarget = ramKey && ramSlot ? (ramGlow ? { kind: "solid" as const, hostInstanceId: partSpec(ramKey).host, solidId: `${ramGlow.slotId}-latch${ramGlow.near ? "-near" : ""}` } : { kind: "mount" as const, hostInstanceId: partSpec(ramKey).host, placeId: ramSlot.id }) : null;
  const sceneGuide = guide && cpuKind && cpuStep && keyed ? { ...guide, targets: [{ kind: "socket" as const, hostInstanceId: keyed.hostInstanceId, placeId: keyed.mountPointId, what: cpuStep, socket: cpuKind }] }
    : guide && ramGuideTarget ? { ...guide, targets: [ramGuideTarget] } : guide;
  ramDebug.current = ramKey ? { key: ramKey, target: ramTarget?.slotId ?? null, installedIn: ramAt?.target.mountPointId ?? null, seating: ramAt?.seating ?? null, glow: ramGlow, highlight: ramScene.targetSlot, guide: sceneGuide?.targets ?? null, heading: placeName(ramKey) } : null;
  const heldNow = selectedPart && keyed && hold?.key === selectedPart && !(state.parts.find((p) => p.instanceId === partSpec(selectedPart).id)?.attachments.length)
    ? { instanceId: partSpec(selectedPart).id, target: isRamKey(selectedPart) ? simpleRamReference(state) : simpleTarget(state, selectedPart, hold.slotId), rotationDeg: hold.rotationDeg, offsetMm: hold.offsetMm, liftMm: keyed.kind === "pcie_latch" ? 40 : isRamKey(selectedPart) ? 12 : 22, ...(hold.tiltDeg ? { tiltDeg: hold.tiltDeg } : {}) }
    : null;

  /** The CPU's or module's own mechanism, alignment and lowering, one honest step at a time. */
  function HandsPanel() {
    const key = selectedPart!;
    const ret = keyed!;
    const kind = handKind(ret.kind);
    if (kind === "gpu") return GpuHands();
    if (kind === "cpu") return CpuHands();
    if (kind === "ram") return RamHands();
    if (kind === "m2") return M2Hands();
    // The CPU has its own panel (CpuHands); this one is memory and M.2.
    const cpu = (kind as string) === "cpu";
    const m2 = kind === "m2";
    const name = (cpuKey: string, ramKey: string, m2Key: string) => t(cpu ? cpuKey : m2 ? m2Key : ramKey);
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
          <p className={styles.handsState}>{t(cpu ? "hands.plate" : m2 ? "hands.qlatch" : "hands.latch", { state: t(ret.open ? "hands.open" : "hands.closed") })}{coverOn ? ` · ${t("hands.cover")}` : ""}</p>
          <button type="button" className={styles.closeup} onClick={() => focusOn(ret.hostInstanceId, ret.mountPointId)}>{t("hands.closeup")}</button>
        </div>
        {otherIn ? <p className={styles.hint}>{t("hands.takeOther")}</p> : <>
          {!at && <>
            {!ret.open && <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handMechanism(key, "open")}>{name("hands.openPlate", "hands.openLatch", "hands.openQLatch")}</button>}
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
              <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handLower(key)}>{name("hands.lowerIn", "hands.pressIn", "hands.slideIn")}</button>
            </div>}
          </>}
          {at && at.seating !== "seated" && <>
            <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handSeat(key)}>{t("hands.pressIn")}</button>
            <button className={styles.cancel} type="button" disabled={disabled} onClick={() => handLift(key)}>{t("hands.liftOut")}</button>
          </>}
          {at && at.seating === "seated" && (cpu || m2) && ret.open && <>
            <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handMechanism(key, "closed")}>{t(m2 ? "hands.closeQLatch" : "hands.closePlate")}</button>
            <button className={styles.cancel} type="button" disabled={disabled} onClick={() => handLift(key)}>{t("hands.liftOut")}</button>
          </>}
          {at && at.seating === "seated" && !ret.open && <button className={styles.cancel} type="button" disabled={disabled} onClick={() => handMechanism(key, "open")}>{name("hands.openPlate", "hands.openLatch", "hands.openQLatch")}</button>}
        </>}
        <p className={styles.hint}>{name("hands.markCpu", "hands.markRam", "hands.markM2")}</p>
        {m2 && <p className={styles.cablesNote}>{t("hands.m2Source")}</p>}
        <p className={styles.cablesNote}>{t("hands.note")}</p>
      </div>
    );
  }

  /** One lead: each end into a port the learner picks, turned the right way. */
  function CablePanel() {
    const key = selectedCable!;
    const ends = simpleCableEnds(key);
    const next = ends.findIndex((e) => !simpleEndPlugged(state, e));
    const end = ends[next];
    const disabled = !ready || lockedOn || (mode === "fault" && (!fault || fault.solved)) || Boolean(cableBlocked);
    const hold = plugHold?.key === key ? plugHold : { key, portId: null, reversed: true };
    const choices = end ? simplePortChoices(state, end) : [];
    const hostName = (instanceId: string) => { const p = ALL_SIMPLE_PARTS.find((x) => x.id === instanceId); return p ? label(p.key) : t("hands.theDrive"); };
    const owner = state.cables.find((c) => c.id === cableSpec(key).id)?.ownerInstanceId;
    const captive = ends.length === 1 && Boolean(owner && pcCatalog.entries.find((e) => e.id === state.parts.find((p) => p.instanceId === owner)?.catalogId)?.category === "psu");
    return (
      <div className={styles.hands}>
        <ol className={styles.substeps}>
          {ends.map((e, i) => <li key={i}><span aria-hidden="true">{simpleEndPlugged(state, e) ? "✓" : i + 1}</span> {t("hands.endInto", { part: hostName(e.instanceId) })}</li>)}
        </ol>
        {captive && <p className={styles.cablesNote}>{t("hands.captive")}</p>}
        {end && <div className={styles.holdControls} role="group" aria-label={t("hands.endInto", { part: hostName(end.instanceId) })}>
          <div className={styles.holdRow} role="radiogroup" aria-label={t("hands.whichPort")}>
            {choices.map((c) => <button key={c.portId} type="button" role="radio" aria-checked={hold.portId === c.portId} onClick={() => setPlugHold({ ...hold, portId: c.portId })}>{hold.portId === c.portId ? "● " : ""}{locale === "ar" ? c.label.ar : c.label.en}</button>)}
          </div>
          <p className={styles.alignState} aria-live="polite">{t(hold.reversed ? "hands.plugReversed" : "hands.plugMatched")}</p>
          <div className={styles.holdRow}><button type="button" onClick={() => setPlugHold({ ...hold, reversed: !hold.reversed })}>{t("hands.turnPlug")}</button></div>
          <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handPlug(key, next)}>{t("hands.plugIn")}</button>
        </div>}
        <p className={styles.cablesNote}>{t("hands.plugNote")}</p>
      </div>
    );
  }

  /** Cooler, board, PSU or fan: the preparation it needs, putting it in place, then its screws one by one. */
  function PrepPanel() {
    const key = selectedPart!;
    const liquid = simpleIsLiquid(key);
    const role = liquid ? "cooler" : roleOf(key);
    const spec = ALL_SIMPLE_PARTS.find((p) => p.key === key)!;
    const part = state.parts.find((p) => p.instanceId === spec.id);
    const at = part?.attachments[0];
    const prep = part?.prep ?? {};
    const disabled = !ready || lockedOn || (mode === "fault" && (!fault || fault.solved));
    const secured = at?.fastenersSecured ?? 0;
    const order = simpleScrewOrder(saved.history, key);
    const choice = (active: boolean, label: string, onClick: () => void) =>
      <button type="button" className={active ? styles.installButton : styles.cancel} aria-pressed={active} disabled={disabled || Boolean(at)} onClick={onClick}>{active ? "✓ " : ""}{label}</button>;
    return (
      <div className={styles.hands}>
        {!at && <>
          {role === "cooler" && <>
            {choice(prep.paste === "applied", t("hands.applyPaste"), () => handPrep(key, "paste", "applied", "pasteOn"))}
            {choice(prep.film === "removed", t("hands.peelFilm"), () => handPrep(key, "film", "removed", "filmOff"))}
          </>}
          {role === "motherboard" && <>
            {choice(prep.standoffs === "checked", t("hands.checkStandoffs"), () => handPrep(key, "standoffs", "checked", "standoffsOk"))}
            {choice(prep.io_shield === "fitted", t("hands.fitIoShield"), () => handPrep(key, "io_shield", "fitted", "ioShieldIn"))}
          </>}
          {role === "psu" && <>
            {choice(prep.psu_fan === "down", t("hands.psuFanDown"), () => handPrep(key, "psu_fan", "down", "psuDown"))}
            {choice(prep.psu_fan === "up", t("hands.psuFanUp"), () => handPrep(key, "psu_fan", "up", "psuUp"))}
          </>}
          {role === "fan" && <>
            {choice(prep.airflow === "intake", t("hands.fanIntake"), () => handPrep(key, "airflow", "intake", "fanTurned"))}
            {choice(prep.airflow === "exhaust", t("hands.fanExhaust"), () => handPrep(key, "airflow", "exhaust", "fanTurned"))}
          </>}
          {liquid
            ? <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handFitLiquid(key)}>{t("hands.place.liquid")}</button>
            : <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handPlace(key, role === "cooler" ? "coolerPlaced" : "placedScrews")}>{t(`hands.place.${role}`)}</button>}
        </>}
        {at && secured < spec.screws && (role === "cooler"
          ? <div className={styles.holdRow} role="group" aria-label={t("hands.screwsTitle")}>
              {[0, 1, 2, 3].map((c) => <button key={c} type="button" disabled={disabled || order.done.includes(c)} aria-pressed={order.done.includes(c)} onClick={() => handScrew(key, c)}>{order.done.includes(c) ? "✓ " : ""}{t(`hands.corner${c}`)}</button>)}
            </div>
          : <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handScrew(key, secured)}>{t("hands.nextScrew", { n: secured + 1, total: spec.screws })}</button>)}
        {at && <p className={styles.handsState}>{t("hands.screwsState", { n: secured, total: spec.screws })}</p>}
        <p className={styles.hint}>{t(`hands.why.${role}`)}</p>
        {liquid && <p className={styles.cablesNote}>{t("hands.liquidNote")}</p>}
        <p className={styles.cablesNote}>{t("hands.prepNote")}</p>
      </div>
    );
  }

  /** Which piece of the socket the next CPU step is about (the robot points at it and it glows). */
  function cpuFocus(key: SimplePartKey): "lever" | "plate" | "mark" | null {
    const ret = simpleRetention(state, key);
    if (!ret) return null;
    const at = state.parts.find((p) => p.instanceId === partSpec(key).id)?.attachments[0];
    const lga = Boolean(ret.leverId);
    if (!ret.open && !(lga ? ret.leverOpen : false)) return at && simplePartInstalled(state, key) ? null : "lever";
    if (lga && ret.leverOpen && !ret.open) return at ? "lever" : "plate";
    if (!at) return "mark";
    return lga ? "plate" : "lever";
  }

  /** The CPU and its socket: lever and plate (Intel) or lever (AM4), the CPU held, turned and centred, then lowered. */
  function CpuHands() {
    const key = selectedPart!;
    const ret = keyed!;
    const lga = Boolean(ret.leverId);
    const at = state.parts.find((p) => p.instanceId === partSpec(key).id)?.attachments[0];
    const host = state.parts.find((p) => p.instanceId === ret.hostInstanceId);
    const coverOn = lga && host?.mechanisms?.[`${ret.id}:cover`] !== "open";
    const rival = simpleSlotPart(state, "cpu");
    const otherIn = rival && rival !== key ? rival : null;
    const off = hold ? Math.hypot(hold.offsetMm[0], hold.offsetMm[1]) : 0;
    const disabled = !ready || lockedOn || (mode === "fault" && (!fault || fault.solved));
    const leverUp = lga ? ret.leverOpen : ret.open;
    const btn = (label: string, onClick: () => void, primary = true) => <button className={primary ? styles.installButton : styles.cancel} type="button" disabled={disabled} onClick={onClick}>{label}</button>;
    return (
      <div className={styles.hands}>
        <div className={styles.handsHead}>
          <p className={styles.handsState}>{t("hands.lever", { state: t(leverUp ? "hands.leverUp" : "hands.leverLocked") })}{lga ? ` · ${t("hands.plate", { state: t(ret.open ? "hands.open" : "hands.closed") })}` : ""}{coverOn ? ` · ${t("hands.cover")}` : ""}</p>
          <button type="button" className={styles.closeup} onClick={() => focusOn(ret.hostInstanceId, ret.mountPointId)}>{t("hands.closeup")}</button>
        </div>
        <p className={styles.cablesNote}>{t("hands.inScene")}</p>
        {otherIn ? <p className={styles.hint}>{t("hands.takeOther")}</p> : <>
          {/* Opening: lever first (Intel: then the plate). Closing: plate first, then the lever under its tab. */}
          {!leverUp && !ret.open && btn(t(lga ? "hands.releaseLever" : "hands.liftZif"), () => (lga ? handLever(key, "open") : handMechanism(key, "open")), !at || !simplePartInstalled(state, key) ? true : false)}
          {lga && leverUp && !ret.open && (!at || at.seating === "seated") && btn(t("hands.openPlate"), () => handMechanism(key, "open"), !at)}
          {lga && leverUp && !ret.open && at && btn(t("hands.lockLever"), () => handLever(key, "closed"))}
          {!at && hold && <div className={styles.holdControls} role="group" aria-label={t("hands.title")} tabIndex={0} onKeyDown={(e) => holdKeys(e, key)}>
            <p className={styles.alignState} aria-live="polite">{t("hands.turned", { deg: hold.rotationDeg })} · {off < 0.05 ? t("hands.aligned") : t("hands.off", { mm: Math.round(off * 10) / 10 })}</p>
            <div className={styles.holdRow}>
              <button type="button" onClick={() => turn(-90)} aria-label={t("hands.rotateLeft")}>⟲</button>
              <button type="button" onClick={() => turn(90)} aria-label={t("hands.rotateRight")}>⟳</button>
              <button type="button" onClick={() => nudge(-1, 0)} aria-label={t("hands.nudgeLeft")}>←</button>
              <button type="button" onClick={() => nudge(1, 0)} aria-label={t("hands.nudgeRight")}>→</button>
              <button type="button" onClick={() => nudge(0, -1)} aria-label={t("hands.nudgeUp")}>↑</button>
              <button type="button" onClick={() => nudge(0, 1)} aria-label={t("hands.nudgeDown")}>↓</button>
            </div>
            <p className={styles.cablesNote}>{t("hands.keys")}</p>
            {btn(t("hands.lowerIn"), () => handLower(key))}
          </div>}
          {at && at.seating === "seated" && ret.open && <>
            {btn(t(lga ? "hands.closePlate" : "hands.lowerZif"), () => handMechanism(key, "closed"))}
            {btn(t("hands.liftOut"), () => handLift(key), false)}
          </>}
        </>}
        <p className={styles.hint}>{t("hands.markCpu")}</p>
        <p className={styles.cablesNote}>{t(lga ? "hands.lgaSource" : "hands.zifSource")}</p>
        <p className={styles.cablesNote}>{t("hands.note")}</p>
      </div>
    );
  }
  /** A memory module: the slot it is over, that slot's clip(s), the module turned and lined up, lowered, then pressed home. */
  function RamHands() {
    const key = selectedPart!;
    const at = state.parts.find((p) => p.instanceId === partSpec(key).id)?.attachments[0];
    const slots = simpleRamSlots(state);
    const target = !at && hold?.key === key ? simpleRamTargetFor(state, hold.offsetMm) : null;
    const slot = slots.find((x) => x.id === (at ? at.target.mountPointId : target?.slotId));
    const name = ramSlotName;
    const count = slots.filter((x) => x.occupant && x.occupant !== key).length + 1;
    const rec = simpleRamRecommended(state, count);
    const disabled = !ready || lockedOn || (mode === "fault" && (!fault || fault.solved));
    const btn = (label: string, onClick: () => void, primary = true) => <button className={primary ? styles.installButton : styles.cancel} type="button" disabled={disabled} onClick={onClick}>{label}</button>;
    const clipLine = (sl: typeof slot) => sl ? `${t(sl.clipOpen ? "hands.clipOpen" : "hands.clipClosed")}${sl.nearId ? ` · ${t(sl.nearOpen ? "hands.nearOpen" : "hands.nearClosed")}` : ""}` : "";
    const off = target ? Math.hypot(target.residual[0], target.residual[1]) : null;
    // Not over any slot: a close-up frames the slot nearest the module (only the view; nothing is implied).
    const offsets = simpleRamSlotOffsets(state);
    const nearestSlot = [...offsets.entries()].sort((a, b) => Math.abs(a[1][1] - (hold?.offsetMm[1] ?? 0)) - Math.abs(b[1][1] - (hold?.offsetMm[1] ?? 0)))[0]?.[0] ?? simpleRamReference(state).mountPointId;
    const note = (pcCatalog.entries.find((e) => e.id === state.parts.find((p) => p.instanceId === partSpec(key).host)?.catalogId)?.mountPoints.find((m) => m.kind === "dimm_slot") as { retention?: { note?: string; latches?: string } } | undefined)?.retention;
    return (
      <div className={styles.hands}>
        <div className={styles.handsHead}>
          <p className={styles.handsState} aria-live="polite">{slot ? `${placeName(key)} · ${clipLine(slot)}` : t("hands.overNoSlot")}</p>
          <button type="button" className={styles.closeup} onClick={() => focusOn(partSpec(key).host, slot?.id ?? nearestSlot)}>{t("hands.closeup")}</button>
        </div>
        {/* What the manual recommends is advice, shown apart from where the module actually is. */}
        {rec.length > 0 && <p className={styles.cablesNote}>{t("hands.ramRecommendation", { n: count, rec: rec.map(name).join(" + ") })}{slot && (!slot.occupant || slot.occupant === key) && ![...slots.filter((x) => x.occupant && x.occupant !== key).map((x) => x.id), slot.id].every((id) => rec.includes(id)) ? ` ${t("hands.ramOffRecommendation")}` : ""}</p>}
        <p className={styles.cablesNote}>{t("hands.ramInScene")}</p>
        {slot && slot.occupant && slot.occupant !== key && !at && <p className={styles.hint}>{t("hands.slotTakenHint", { slot: name(slot.id) })}</p>}
        {slot && (!slot.occupant || slot.occupant === key) && <div className={styles.holdRow}>
          <button type="button" disabled={disabled} onClick={() => handClip(slot.id, false)}>{t(slot.clipOpen ? "hands.closeClip" : "hands.openClip", { slot: name(slot.id) })}</button>
          {slot.nearId && <button type="button" disabled={disabled} onClick={() => handClip(slot.id, true)}>{t(slot.nearOpen ? "hands.closeNearClip" : "hands.openNearClip", { slot: name(slot.id) })}</button>}
        </div>}
        {!at && hold && <div className={styles.holdControls} role="group" aria-label={t("hands.title")} tabIndex={0} onKeyDown={(e) => holdKeys(e, key)}>
          <p className={styles.alignState} aria-live="polite">{t(hold.rotationDeg === 0 ? "hands.notchMatched" : "hands.notchReversed")} · {off === null ? t("hands.overNoSlot") : off < 0.05 ? t("hands.aligned") : t("hands.off", { mm: Math.round(off * 10) / 10 })}</p>
          <div className={styles.holdRow}>
            <button type="button" onClick={() => turn(180)}>{t("hands.flip")}</button>
            <button type="button" onClick={() => nudge(0, -1)} aria-label={t("hands.slotPrev")}>⇠</button>
            <button type="button" onClick={() => nudge(0, 1)} aria-label={t("hands.slotNext")}>⇢</button>
            <button type="button" onClick={() => nudge(-1, 0)} aria-label={t("hands.alongBack")}>↑</button>
            <button type="button" onClick={() => nudge(1, 0)} aria-label={t("hands.alongFwd")}>↓</button>
          </div>
          <p className={styles.cablesNote}>{t("hands.ramKeys")}</p>
          {btn(t("hands.ramLower"), () => handRamLower(key))}
        </div>}
        {at && at.seating !== "seated" && <>
          {btn(t("hands.pressIn"), () => handSeat(key))}
          {btn(t("hands.liftOut"), () => handLift(key), false)}
          <p className={styles.hint}>{t("hands.ramPartial")}</p>
        </>}
        {at && at.seating === "seated" && <p className={styles.hint}>{t("hands.ramSeatedHint")}</p>}
        <p className={styles.hint}>{t("hands.markRam")}</p>
        {note?.note && <p className={styles.cablesNote}>{t(note.latches === "unverified" ? "hands.clipsUnverified" : "hands.clipsSource", { note: note.note })}</p>}
      </div>
    );
  }

  /** Keyboard for a part in hand: Q/E turn, arrows move, Enter lowers. */
  function holdKeys(e: React.KeyboardEvent, key: SimplePartKey) {
    const k = e.key.toLowerCase();
    const cpu = handKind(simpleRetention(state, key)?.kind ?? "") === "cpu";
    const ram = isRamKey(key);
    // Memory: left/right move across the slots, up/down along them.
    const map: Record<string, () => void> = { q: () => turn(cpu ? -90 : 180), e: () => turn(cpu ? 90 : 180), arrowleft: () => (ram ? nudge(0, -1) : nudge(-1, 0)), arrowright: () => (ram ? nudge(0, 1) : nudge(1, 0)), arrowup: () => (ram ? nudge(-1, 0) : nudge(0, -1)), arrowdown: () => (ram ? nudge(1, 0) : nudge(0, 1)), enter: () => (isM2Key(key) ? primaryHand(key) : handLower(key)), ...(isM2Key(key) ? { t: () => tiltHeld(!(hold?.tiltDeg)) } : {}) };
    if (map[k]) { e.preventDefault(); e.stopPropagation(); map[k](); }
  }

  /**
   * An M.2 drive: the chosen slot's heatsink (screws, lift, film, refit, screws), the screw stand or the
   * Q-Latch, the angle, inserting, pressing flat, holding it; and the same in reverse to take it out.
   */
  function M2Hands() {
    const key = selectedPart!;
    const ret = keyed!;
    const at = state.parts.find((p) => p.instanceId === partSpec(key).id)?.attachments[0];
    const slotId = at?.target.mountPointId ?? (hold?.key === key ? hold.slotId : undefined);
    const hs = slotId ? simpleM2Heatsink(state, slotId) : null;
    const screw = ret.kind === "m2_screw";
    const disabled = !ready || handsOff();
    const button = (label: string, run: () => void, primary = true) => <button key={label} className={primary ? styles.installButton : styles.cancel} type="button" disabled={disabled} onClick={run}>{label}</button>;
    const state2 = (open: boolean) => t(open ? "hands.open" : "hands.closed");
    return (
      <div className={styles.hands}>
        <div className={styles.handsHead}>
          <p className={styles.handsState}>
            {slotId ? <bdi>{m2SlotName(slotId)}</bdi> : t("companion.hands.m2Pick")}
            {hs ? ` · ${t(hs.fitted ? "hands.m2HsOn" : "hands.m2HsOff")}${hs.fitted ? ` (${t(hs.screwsIn ? "hands.m2HsTight" : "hands.m2HsLoose")})` : hs.filmOn ? ` · ${t("hands.m2FilmOn")}` : ""}` : ""}
            {slotId ? ` · ${screw ? t(ret.open ? "hands.m2ScrewOutState" : "hands.m2ScrewInState") : t("hands.qlatch", { state: state2(ret.open) })}` : ""}
          </p>
          {slotId && <button type="button" className={styles.closeup} onClick={() => focusOn(ret.hostInstanceId, slotId)}>{t("hands.closeup")}</button>}
        </div>
        {slotId && <div className={styles.holdRow}>
          {hs?.fitted && hs.screwsIn && button(t("hands.m2Screws"), () => handHeatsink(key, hs.id, "screws"))}
          {hs?.fitted && !hs.screwsIn && <>{button(t("hands.m2Lift"), () => handHeatsink(key, hs.id, "lift"))}{button(t("hands.m2Tighten"), () => handHeatsink(key, hs.id, "tighten"), false)}</>}
          {hs && !hs.fitted && <>{hs.filmOn && button(t("hands.m2Film"), () => handHeatsink(key, hs.id, "film"))}{button(t("hands.m2Fit"), () => handHeatsink(key, hs.id, "fit"), false)}</>}
          {!at && screw && !ret.standIn && button(t("hands.m2Stand"), () => handStand(key))}
          {!at && !screw && button(t(ret.open ? "hands.closeQLatch" : "hands.openQLatch"), () => handMechanism(key, ret.open ? "closed" : "open"), !ret.open)}
          {!at && hold?.key === key && <>
            {button(t("hands.flip"), () => turn(180), false)}
            {button(t(hold.tiltDeg ? "toolbar.layFlat" : "toolbar.tiltUp"), () => tiltHeld(!hold.tiltDeg), false)}
            {button(t("hands.slideIn"), () => handM2Insert(key))}
          </>}
          {at && at.seating !== "seated" && <>{button(t("hands.pressIn"), () => handSeat(key))}{button(t("hands.liftOut"), () => handLift(key), false)}</>}
          {at && at.seating === "seated" && ret.open && button(t(screw ? "hands.m2ScrewIn" : "hands.closeQLatch"), () => handMechanism(key, "closed"))}
          {at && at.seating === "seated" && !ret.open && !hs?.fitted && button(t(screw ? "hands.m2ScrewOut" : "hands.openQLatch"), () => handMechanism(key, "open"), false)}
        </div>}
        <p className={styles.hint}>{t("hands.markM2")}</p>
        <p className={styles.cablesNote}>{t("hands.m2Source")}</p>
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
    // The covers matter once the board is in the case; before that the card has no case opening to meet.
    const boardInCase = simplePartInstalled(state, "motherboard");
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
          <p className={styles.handsState}>{t("hands.pcieLatch", { state: st(ret.open) })} · {t("hands.covers", { state: t(!boardInCase ? "hands.coversLater" : covered ? "hands.coversIn" : "hands.coversOut") })}{at ? ` · ${t(screwed ? "hands.screwsIn" : "hands.screwsOut")}` : ""}</p>
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
          {boardInCase && !covered && <button className={styles.cancel} type="button" disabled={disabled} onClick={() => handCovers("closed")}>{t("hands.refitCovers")}</button>}
          {!boardInCase && <p className={styles.hint}>{t("hands.gpuBoardFirst")}</p>}
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

  // ---------- The toolbar above the view: undo, turn, the one next step, and the view toggles ----------

  /** The label of a keyed part's next step, as the panel below names the same step. */
  function stepLabel(key: SimplePartKey, step: Exclude<HandStep, null>): string {
    const ret = retOf(key);
    const k = handKind(ret?.kind ?? "");
    const lga = Boolean(ret?.leverId);
    switch (step.kind) {
      case "aim": return isRamKey(key) ? t("toolbar.overSlot") : t("toolbar.aimHere");
      case "slotTaken": return t("hands.ramLower");
      case "clip": return t(step.near ? "hands.openNearClip" : "hands.openClip", { slot: ramSlotName(step.slotId) });
      case "lever": return t(step.desired === "open" ? (lga ? "hands.releaseLever" : "hands.liftZif") : "hands.lockLever");
      case "mechanism": {
        const open = step.desired === "open";
        if (k === "gpu") return t(open ? "hands.openPcie" : "hands.releasePcie");
        if (k === "m2") return ret?.kind === "m2_screw" ? t(open ? "hands.m2ScrewOut" : "hands.m2ScrewIn") : t(open ? "hands.openQLatch" : "hands.closeQLatch");
        return t(lga ? (open ? "hands.openPlate" : "hands.closePlate") : (open ? "hands.liftZif" : "hands.lowerZif"));
      }
      case "covers": return t("hands.removeCovers");
      case "lower": return t(k === "ram" ? "hands.ramLower" : k === "gpu" ? "hands.pushCard" : k === "m2" ? "hands.slideIn" : "hands.lowerIn");
      case "seat": return t("hands.pressIn");
      case "fasten": return t("hands.screwBracket");
      case "heatsink": return t(({ screws: "hands.m2Screws", lift: "hands.m2Lift", film: "hands.m2Film", fit: "hands.m2Fit", tighten: "hands.m2Tighten" } as const)[step.step]);
      case "stand": return t("hands.m2Stand");
      case "tilt": return t("hands.m2Tilt");
    }
  }
  /** The one action the toolbar offers now, or why there is none (shown and read out with the button). */
  const nextAction: { label: string; run?: () => void; why?: string } = (() => {
    if (!selection) return { label: t("install"), why: t("selectFirst") };
    if (!ready || handsOff()) return { label: t("install"), why: t(lockedOn ? "turnOffFirst" : "toolbar.nothing") };
    if (selection.kind === "cable") return { label: t("toolbar.moreCable"), run: openPartOptions };
    const key = selection.key;
    if (lockedOn) return { label: t("install"), why: t("turnOffFirst") };
    if (keyed) {
      const rivalIn = handKind(keyed.kind) === "cpu" ? simpleSlotPart(state, "cpu") : null;
      if (rivalIn && rivalIn !== key) return { label: t("install"), why: t("hands.takeOther") };
      const step = nextHandStep(state, key, hold);
      if (!step) return { label: t(partInstalled ? "installed" : "install"), why: t("toolbar.nothing") };
      if (step.kind === "slotTaken") return { label: t("hands.ramLower"), why: t("hands.slotTakenHint", { slot: ramSlotName(step.slotId) }) };
      if (step.kind === "aim" && (isRamKey(key) || hold?.key !== key)) return { label: stepLabel(key, step), why: t(isRamKey(key) ? "companion.aim.ramFirst" : "companion.aim.first") };
      return { label: stepLabel(key, step), run: () => runStep(key, step) };
    }
    if (partInstalled) return { label: t("installed"), why: t("toolbar.nothing") };
    if (partBlocked) return { label: t("install"), why: t(partBlocked) };
    if (rival || simpleUsesScrews(key) || simpleIsLiquid(key)) return { label: t("toolbar.more"), run: openPartOptions };
    if (mode !== "fault" && ticked < substepsFor(key).length) return { label: t("toolbar.more"), run: openPartOptions };
    return { label: t("install"), run: () => install(key) };
  })();
  /** The part in hand that can be turned now (held, not yet in its place), and how it is turned. */
  const turnable = heldNow && selectedPart && keyed && !handsOff() ? { cpu: handKind(keyed.kind) === "cpu", key: selectedPart } : null;
  const heldState = heldNow && hold && keyed ? (() => {
    const k = handKind(keyed.kind);
    if (k === "ram") return t(hold.rotationDeg === 0 ? "hands.notchMatched" : "hands.notchReversed");
    if (k === "gpu") return t(hold.rotationDeg === 0 ? "hands.bracketToCase" : "hands.bracketAway");
    return t("hands.turned", { deg: hold.rotationDeg });
  })() : null;
  // A module in hand: every real slot of the board, to hold it over by a click (a keyboard-reachable twin of clicking the slot).
  const slotChoices = ramKey && heldNow ? simpleRamSlots(state) : [];
  // An M.2 drive in hand: every M.2 slot of the board, chosen by a click (a keyboard-reachable twin of clicking the slot).
  const m2Held = heldNow && selectedPart && isM2Key(selectedPart) ? selectedPart : null;
  const m2Choices = m2Held ? simpleM2Slots(state, m2Held) : [];
  const optionsKey = selection ? `${selection.kind}:${selection.key}` : "";
  const optionsOpen = optionsChoice?.key === optionsKey
    ? optionsChoice.open
    : Boolean(selectedCable || (selectedPart && (!keyed || rival)));
  function openPartOptions() {
    if (optionsKey) setOptionsChoice({ key: optionsKey, open: true });
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
          <div className={styles.toolbar} role="group" aria-label={t("toolbar.label")}>
            <div className={styles.toolGroup}>
              {mode !== "fault" && <button type="button" className={styles.tool} onClick={undo} disabled={!ready || !canUndo}>{t("undo")}</button>}
              <div className={styles.toolGroup} role="group" aria-label={t("toolbar.rotate")}>
                {turnable ? (turnable.cpu ? <>
                  <button type="button" className={styles.tool} onClick={() => turn(-90)} aria-label={t("hands.rotateLeft")}>⟲</button>
                  <button type="button" className={styles.tool} onClick={() => turn(90)} aria-label={t("hands.rotateRight")}>⟳</button>
                </> : <button type="button" className={styles.tool} onClick={() => turn(180)}>{t("hands.flip")}</button>)
                  : <button type="button" className={styles.tool} disabled aria-describedby="toolbar-rotate-why">{t("hands.flip")}</button>}
                {!turnable && <span id="toolbar-rotate-why" className="visually-hidden">{t("toolbar.rotateNone")}</span>}
              </div>
              {m2Held && <div className={styles.toolGroup} role="group" aria-label={t("toolbar.tilt")}>
                <button type="button" className={styles.tool} aria-pressed={Boolean(hold?.tiltDeg)} onClick={() => tiltHeld(true)}>{t("toolbar.tiltUp")}</button>
                <button type="button" className={styles.tool} aria-pressed={!hold?.tiltDeg} onClick={() => tiltHeld(false)}>{t("toolbar.layFlat")}</button>
              </div>}
              <button type="button" className={styles.toolPrimary} onClick={nextAction.run} disabled={!nextAction.run} aria-describedby={nextAction.run ? undefined : "toolbar-why"}>{nextAction.label}</button>
            </div>
            {m2Choices.length > 0 && <div className={styles.toolGroup} role="group" aria-label={t("toolbar.m2Slot")}>
              <span className={styles.toolLabel} aria-hidden="true">{t("toolbar.m2Slot")}</span>
              {m2Choices.map((slot) => {
                const taken = Boolean(slot.occupant && slot.occupant !== m2Held);
                const why = taken ? t("companion.hands.m2SlotTaken", { slot: m2SlotName(slot.id) }) : !slot.fits ? t("companion.hands.m2NoFit", { slot: m2SlotName(slot.id) }) : undefined;
                return <button key={slot.id} type="button" className={styles.tool} aria-pressed={hold?.slotId === slot.id} disabled={taken || !slot.fits || handsOff()} title={why} onClick={() => aimAt(m2Held!, slot.id)}><bdi>{m2SlotName(slot.id)}</bdi>{why && <span className="visually-hidden"> · {why}</span>}</button>;
              })}
            </div>}
            {slotChoices.length > 0 && <div className={styles.toolGroup} role="group" aria-label={t("toolbar.overSlot")}>
              <span className={styles.toolLabel} aria-hidden="true">{t("toolbar.overSlot")}</span>
              {slotChoices.map((slot) => {
                const taken = Boolean(slot.occupant && slot.occupant !== ramKey);
                const shortName = slot.label.en.match(/DIMM_[A-Z0-9]+/)?.[0] ?? ramSlotName(slot.id);
                return <button key={slot.id} type="button" className={styles.tool} aria-label={ramSlotName(slot.id)} aria-pressed={ramTarget?.slotId === slot.id} disabled={taken || handsOff()} title={taken ? t("hands.slotTakenHint", { slot: ramSlotName(slot.id) }) : undefined} onClick={() => aimAt(ramKey!, slot.id)}><bdi>{shortName}</bdi>{taken && <span className="visually-hidden"> · {t("hands.slotTakenHint", { slot: ramSlotName(slot.id) })}</span>}</button>;
              })}
            </div>}
            <div className={`${styles.toggles} ${styles.toolGroup}`} role="group" aria-label={t("view.label")}>
              <button type="button" aria-pressed={view.guide} onClick={() => changeView({ guide: !view.guide })}>{t("view.guide")}</button>
              <button type="button" aria-pressed={view.guideMotion && !reducedMotion} disabled={!view.guide || reducedMotion} onClick={() => changeView({ guideMotion: !view.guideMotion })} title={reducedMotion ? t("view.reduced") : undefined}>{t("view.motion")}</button>
              <button type="button" aria-pressed={view.rgb} onClick={() => changeView({ rgb: !view.rgb })}>{t("view.rgb")}</button>
            </div>
            <p className={styles.toolStatus} aria-live="polite">
              {heldState && <span>{heldState}</span>}
              {nextAction.why && <span id="toolbar-why">{nextAction.why}</span>}
            </p>
          </div>
          {/* Every control for the selected part or lead, above the view: prep, screws, swap, removal, substeps,
              each end of a lead, and the reverse steps. Open by itself when the toolbar cannot do the step. */}
          {selection && <details key={optionsKey} className={styles.partOptions} open={optionsOpen} onToggle={(event) => { const open = event.currentTarget.open; if (open !== optionsOpen) setOptionsChoice({ key: optionsKey, open }); }}>
            <summary>
              <span className={styles.partOptionsTitle}>{t(selectedCable ? "toolbar.moreCable" : "toolbar.more")}</span>
              {selectedPart
                ? <span className={styles.selection}><strong>{label(selectedPart)}</strong><span>{partInstalled ? (isRamKey(selectedPart) ? `${t("installed")} · ${placeName(selectedPart)}` : t("installed")) : placeName(selectedPart)}</span></span>
                : <span className={styles.selection}><strong>{cableName(selectedCable!)}</strong></span>}
            </summary>
            <div className={styles.partOptionsBody}>
              {selectedPart ? <div className={styles.install}>
                {keyed ? HandsPanel() : !partInstalled && !rival && (simpleUsesScrews(selectedPart) || simpleIsLiquid(selectedPart)) ? PrepPanel() : partInstalled && removable
                  ? <button className={styles.installButton} type="button" onClick={() => remove(selectedPart)} disabled={!ready || Boolean(removeBlocked)}>{t("remove")}</button>
                  : rival
                    ? <button className={styles.installButton} type="button" onClick={() => swap(rival, selectedPart)} disabled={!ready || Boolean(swapBlocked)}>{t("swap", { other: label(rival) })}</button>
                    : <button className={styles.installButton} type="button" onClick={() => install(selectedPart)} disabled={!ready || partInstalled || Boolean(partBlocked) || lockedOn || (mode !== "fault" && ticked < substepsFor(selectedPart).length)}>{partInstalled ? t("installed") : t("install")}</button>}
                {mode !== "fault" && !partInstalled && !rival && !partBlocked && !simpleUsesScrews(selectedPart) && !simpleIsLiquid(selectedPart) && substepsFor(selectedPart).length > 0 && <ol className={styles.substeps} aria-label={t("substeps.title")}>
                  {substepsFor(selectedPart).map((step, i) => <li key={step}><button type="button" aria-pressed={i < ticked} disabled={i > ticked} onClick={() => setTicked(i < ticked ? i : i + 1)}><span aria-hidden="true">{i < ticked ? "✓" : i + 1}</span>{t(`substeps.${step}`)}</button></li>)}
                </ol>}
                {partBlocked && !partInstalled && !rival && <p className={styles.hint}>{t(partBlocked)}</p>}
                {rival && <p className={styles.hint}>{swapBlocked ? blockHint(swapBlocked) : t("swapHint", { other: label(rival) })}</p>}
                {partInstalled && SWAPPABLE.includes(selectedPart) && !removable && <p className={styles.hint}>{t("swapCpuHint")}</p>}
                {removeBlocked && removeBlocked !== "notSwappable" && <p className={styles.hint}>{blockHint(removeBlocked)}</p>}
                <button className={styles.cancel} type="button" onClick={cancel}>{t("cancel")}</button>
              </div> : selectedCable && <div className={styles.cableDetail}>
                <p>{cableRoute(selectedCable)}</p>
                <code dir="ltr">{t(`cables.${selectedCable}.connector`)}</code>
                {cableDone
                  ? <button className={styles.installButton} type="button" onClick={() => unplug(selectedCable)} disabled={!ready || lockedOn}>{t("disconnect")}</button>
                  : CablePanel()}
                {cableBlocked && !cableDone && <p className={styles.hint}>{cableBlocked === "turnOffFirst" ? t("turnOffFirst") : t("fitCableParts", { parts: simpleCableMissingParts(state, selectedCable).map((key) => label(key)).join(locale === "ar" ? "، " : ", ") })}</p>}
                {lockedOn && cableDone && <p className={styles.hint}>{t("turnOffFirst")}</p>}
                <button className={styles.cancel} type="button" onClick={cancel}>{t("cancel")}</button>
              </div>}
            </div>
          </details>}
          <div className={styles.stage}>
          <div className={styles.viewControls} role="group" aria-label={t("camera")}>
            <button type="button" onClick={() => moveCamera("fit")}>{t("center")}</button>
            <button type="button" aria-label={t("zoomIn")} onClick={() => moveCamera("in")}>+</button>
            <button type="button" aria-label={t("zoomOut")} onClick={() => moveCamera("out")}>−</button>
          </div>
          <div className={styles.canvas} role="group" tabIndex={0} aria-label={t("scene")} onKeyDown={(event) => {
            if (heldNow && selectedPart) { holdKeys(event, selectedPart); if (event.defaultPrevented) return; }
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
                  // CPU: the socket answers a click once open (aim, then lower). Memory: every real slot answers, none lit (no default slot).
                  simpleTargets={cpuKind && keyed && selectedPart ? [...targets.filter((x) => !(x.hostInstanceId === keyed.hostInstanceId && x.placeId === keyed.mountPointId)), ...aimTargets(state, selectedPart, hold)] : ramKey ? [...targets.filter((x) => !x.placeId.startsWith("dimm-")), ...aimTargets(state, ramKey, hold)] : selectedPart && isM2Key(selectedPart) ? [...targets.filter((x) => !x.placeId.startsWith("m2-")), ...aimTargets(state, selectedPart, hold)] : targets}
                  onSimpleTarget={onTarget}
                  onSimpleMiss={() => { if (selection) react({ type: "missedTarget" }); }}
                  guide={sceneGuide}
                  guideAnimate={view.guideMotion}
                  rgb={view.rgb}
                  held={heldNow}
                  socket={socketHands}
                  dimm={ramScene}
                  benchOrder={bench.benchOrder}
                  beside={bench.beside}
                  onContextLost={() => setWebgl(false)}
                />
              </SceneBoundary>
            )}
          </div>
          </div>
          <p className={styles.cameraHint}>{t("cameraHint")}</p>
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

              {/* What to do with the selected part is above the view (toolbar and part controls); here it is chosen. */}
              {!selectedPart && <p className={styles.hint}>{t("selectFirst")}</p>}
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
