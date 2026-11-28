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
import { blockLine, buildContext, companionSay, partName, coolerDoneLine, coolerRemovalLine, coolerStepLine, heldLines, intentOf, m2StepLine, mountingRemovalLine, nextLine, topicOf, type CompanionEvent, type CompanionLine, type CompanionSay, type Selection } from "./companion";
import { aimClick, aimTargets, createStepGate, m2LiftPose, nextHandStep, type HandStep } from "./click-assembly";
import { focusOn, moveCamera, selectPart } from "./scene/scene-store";
import { autoPlace, installPlaces, installPose, planInstall, type InstallPlan } from "./one-click";
import { applyCoolerStep, applyMountingStep, boardFrameScrews, coolerStepHistory, mountingDismantling, mountingStepHistory, nextCoolerRemoval, nextCoolerStep, nextMountingRemoval, type CoolerStep, type MountingStep } from "./cooler-assembly";
import {
  ALL_SIMPLE_CABLES, ALL_SIMPLE_PARTS, cableSpec, firstAttachment, partSpec, createSimpleBuild, emptySimpleSnapshot, isM2Key, isRamKey, lastSimpleAction, M2_WHOLE_TILT_DEG, withSimpleSteps, simpleM2Heatsink, simpleM2Slots,
  parseSimpleSnapshot, SIMPLE_PART_LIST, SIMPLE_PARTS, SIMPLE_SAVE_KEY, simpleAllPartsIn, simpleBootPartsIn, simpleAssemblyComplete, simpleBlock, simpleBuildFromSnapshot,
  simpleCableBlock, simpleCableConnected, simpleCableMissingParts, simpleCablesFor, simplePartInstalled, simplePartsProgress, REMOVABLE, simpleRemoveBlock, simpleRuleBlock,
  simpleSlotPart, simpleSwapBlock, simpleTarget, slotOf, startSimplePC, SWAPPABLE, undoSimpleStep, unplugSimpleEnd, withUnplug, simpleActiveEnd, nextReadiness, pressSimplePower, setSimpleSystem, simpleChangesBehindPanel, simpleCpuSourceKey, simpleGpuSourceKey, simpleM2OpenFirstKey, simpleM2SourceNote, simpleSystemValue, type SystemControl, actualEndPort, simpleSocketName, withoutPart, withSwap,
  hasModelledMounting, withSimpleStep, activateSimpleModel, activeSimpleModel, LEGACY_MODEL, roleOf, simpleRetention, setSimpleMechanism, lowerSimplePart, reseatSimplePart, liftSimplePart,
  withMechanism, withLower, withSeat, withLift, withPrep, withPlace, withScrew, prepSimplePart, placeSimplePart, screwSimplePart, unscrewSimplePart, withUnscrew, isPositionKey, simplePositions, simpleLiftBlock, simpleOrientationAdvice, simpleRequiredScrews, simpleUsesScrews, simpleScrewOrder, simpleIsLiquid, simpleCableEnds, simpleEndPlugged, simplePortChoices, simplePlugKeying, plugSimpleEnd, withPlug, loweredPose, lowerSimpleRam, simpleRamSlots, simpleRamRecommended, simpleRamReference, simpleRamSlotOffsets, simpleRamTargetFor, HELD_REACH_MM, type SimpleHeld, caseCoversClosed, slotCovers, type SimpleAlignment, type SimpleCableKey, type SimpleModel, type SimplePartKey, type SimpleRule, type SimpleSnapshot, type SimpleStep,
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

const entryOf = (catalogId: string | undefined) => pcCatalog.entries.find((e) => e.id === catalogId);
/** How long one hand step's animation runs: a repeated click within it is ignored. */
const HAND_STEP_MS = 450;
/** How long the card says "Installing…" while the part glides into place (none with reduced motion). */
const INSTALL_MS = 700;
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
    const supplied = partSpec(key)?.supplied;
    return `${t(`roles.${roleOf(key)}`)}${n && (roleOf(key) !== "fan" || supplied) ? ` ${n}` : ""}${e ? ` · ${short ? shortModel(e.model) : e.model}` : ""}${supplied ? ` (${t("suppliedTag")})` : ""}`;
  };
  const cableName = (key: SimpleCableKey) => t(`cables.${key}.name`);
  /** A robot line as plain text (a part named in it is written out as this page names it). */
  const lineWords = (l: CompanionLine) => t(`companion.${l.key}`, Object.fromEntries(Object.entries(l.values ?? {}).map(([k, v]) => [k, typeof v !== "object" ? v : "part" in v ? label(v.part, true) : "parts" in v ? v.parts.map((x) => label(x, true)).join(locale === "ar" ? "، " : ", ") : "place" in v ? robotPlace(v.place) : v])) as never);
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
  const [fault, setFault] = useState<{ kind: FaultKind; state: PCBuildState; solved: boolean; trail: SimpleStep[]; baseScrews: string } | null>(null);
  /** The last power-on attempt, for the stage-by-stage panel. */
  const [attempt, setAttempt] = useState<{ state: PCBuildState; startup: StartupResult } | null>(null);
  const built = useMemo(() => simpleBuildFromSnapshot(saved), [saved]);
  /** The lead in hand: which port the learner has picked for its next end, and whether the plug is turned the wrong way. */
  const [plugHold, setPlugHold] = useState<{ key: string; portId: string | null; reversed: boolean; end: number | null } | null>(null);
  /** Where the selected part goes: the memory or M.2 slot, bay or fan place chosen for it (automatically, or by the learner), until it is in. */
  const [position, setPosition] = useState<{ key: SimplePartKey; id: string } | null>(null);
  /** The part one click just installed, while it glides into place: the button waits, so a second click cannot repeat it. */
  const [installing, setInstalling] = useState<SimplePartKey | null>(null);
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
  /** The bay or fan place chosen for the part in hand (the same one in the controls, the scene, the robot and the saved step). */
  const chosenPosition = selection?.kind === "part" && position?.key === selection.key && isPositionKey(selection.key) ? position.id : null;
  const targets = useMemo(() => simpleSceneTargets(state, selection, chosenPosition, selection?.kind === "cable" && plugHold?.key === selection.key ? plugHold.end : null), [state, selection, chosenPosition, plugHold]);
  const powered = mode === "fault" ? Boolean(fault?.solved) : saved.powered;
  /** The steps the guidance reads: the fault build's own while it is on the page, else the saved progress. */
  const stepsTaken = mode === "fault" ? (fault?.trail ?? []) : saved.history;
  const guide = useMemo(() => (view.guide && mode === "guided" ? guideFocus(state, selection, powered, guided, chosenPosition, selection?.kind === "cable" && plugHold?.key === selection.key ? plugHold : null) : null), [view.guide, mode, state, selection, powered, guided, chosenPosition, plugHold]);
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
    speak(companionSay(event, after, powered, inHand, mountingDismantling(stepsTaken, mode === "fault" ? fault?.baseScrews : undefined)));
  }, [speak, state, saved.powered, stepsTaken, selection]);

  useEffect(() => {
    let restored: SimpleSnapshot | null = null;
    try {
      const raw = localStorage.getItem(saveKey);
      restored = raw ? parseSimpleSnapshot(JSON.parse(raw)) : null;
    } catch { /* Storage is optional; assembly still works in memory. */ }
    const snapshot = restored ?? emptySimpleSnapshot();
    const build = simpleBuildFromSnapshot(snapshot);
    const held = restored?.held ?? null;
    // Where a part saved in hand goes: the slot its pose is over, else where one click would put it.
    const heldPlace = held ? (isRamKey(held.key) ? simpleRamTargetFor(build, held.offsetMm)?.slotId : isM2Key(held.key) ? held.slotId : undefined) ?? autoPlace(build, held.key) : null;
    if (restored) {
      setSaved(restored);
      // A part left in hand comes back exactly as it was held (turn and offset), still in hand, with its place.
      if (held) { setHold(held); setSelection({ kind: "part", key: held.key }); if (heldPlace) setPosition({ key: held.key, id: heldPlace }); }
      setVerdict(restored.powered ? "success" : null);
      if (simpleAllPartsIn(build)) setTab("cables");
    }
    // The welcome back speaks from what was saved: the part in hand by its one-click plan, else the build's progress.
    const resumed = held && !snapshot.powered ? planSay(held.key, build, snapshot.history, heldPlace) : null;
    if (resumed) speak({ ...resumed, lines: [{ key: "welcomeBack" }, ...resumed.lines], mood: "wave" });
    else speak(companionSay(snapshot.history.length > 0 || held ? { type: "resume", held } : { type: "start" }, build, snapshot.powered, held ? { kind: "part", key: held.key } : null, mountingDismantling(snapshot.history)));
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
  function choosePart(key: SimplePartKey) {
    setConfirmRestart(false);
    if (selection?.kind === "part" && selection.key === key) { cancel(); return; }
    const next: Selection = { kind: "part", key };
    setSelection(next);
    setTicked(0);
    // Where it goes is chosen for the learner (they may pick another); a keyed part is held turned to its key, over that place.
    const place = autoPlace(state, key);
    setPosition(place ? { key, id: place } : null);
    const inPlace = Boolean(firstAttachment(state, key));
    setHold(inPlace ? null : installPose(state, key, place));
    setGuided(true);
    setTab("parts");
    if (lockedOn) { speak({ lines: [{ key: "blocked.turnOff" }], mood: "concerned", point: "power" }); return; }
    const say = planSay(key, state, stepsTaken, place);
    if (say) { speak(say); return; }
    react({ type: "select", selection: next }, state, lockedOn, next);
  }

  function chooseCable(key: SimpleCableKey) {
    setConfirmRestart(false);
    if (selection?.kind === "cable" && selection.key === key) { cancel(); return; }
    const next: Selection = { kind: "cable", key };
    setSelection(next);
    // A plug comes out of the bag any way round: turning it to match the socket's key is the learner's job.
    setPlugHold({ key, portId: null, reversed: true, end: null });
    setGuided(true);
    setTab("cables");
    react({ type: "select", selection: next }, state, saved.powered, next);
  }

  function cancel() {
    if (!selection) return;
    setSelection(null);
    setPosition(null);
    // Put down: nothing is in hand, so a reload does not bring the part back into it.
    if (selection.kind === "part") setHold(null);
    react({ type: "cancel" }, state, saved.powered, null);
  }

  /**
   * Installs the selected part completely with one click (owner decision, 2026-11-28): turned the right way, in its
   * chosen place, with its latches, clips and screws done, through the engine's own steps (see one-click.ts). The
   * steps are saved as one action, so one Undo takes them all back. Refused, nothing changes and the robot says why.
   */
  function installWhole(key: SimplePartKey) {
    if (installing === key) return;
    if (handsOff()) { if (lockedOn) speak({ lines: [{ key: "install.turnOff" }], mood: "concerned", point: "power" }); return; }
    if (!takeStep()) return;
    const plan = planInstall(state, key, chosenPlace(key), stepsTaken);
    if (!plan.ok) {
      speak({ lines: [installBlockLine(key, plan)], mood: "concerned", point: plan.reason === "turnOff" ? "power" : "parts" });
      // The other CPU or cooler is in: its swap and removal are in the part controls.
      if (plan.reason === "required" && (plan.block === "socketTaken" || plan.block === "coolerTaken")) openPartOptions();
      return;
    }
    if (!commit(plan.state, (sn) => withSimpleSteps(sn, plan.steps))) return;
    setHold(null);
    setPosition(null);
    setVerdict(null);
    setInstalling(key);
    window.setTimeout(() => setInstalling((now) => (now === key ? null : now)), reducedMotion ? 0 : INSTALL_MS);
    speak({ lines: installedLines(key, plan, plan.state), mood: "happy", point: "scene" });
    if (simpleAllPartsIn(plan.state)) setTab("cables");
  }

  // ---------- Hands-on: mechanisms and alignment (CPU, memory) ----------

  /** Keeps an engine change: the fault build's state, or one step in the saved progress. */
  /** Says no, and changes nothing, when the step would work on something behind the closed side panel. */
  function shutOut(next: ReturnType<typeof createSimpleBuild>) {
    if (!simpleChangesBehindPanel(state, next)) return false;
    speak({ lines: [{ key: "hands.caseShut" }], mood: "concerned", point: "power" });
    return true;
  }
  /** Saves one physical step; false when the closed side panel refused it. */
  function commit(next: ReturnType<typeof createSimpleBuild>, step: (s: SimpleSnapshot) => SimpleSnapshot) {
    if (shutOut(next)) return false;
    // The fault build keeps its own steps, so guidance never reads the saved normal build.
    if (mode === "fault") { if (fault) setFault({ ...fault, state: next, trail: step({ ...emptySimpleSnapshot(), history: fault.trail }).history }); }
    else setSaved((previous) => step(previous));
    return true;
  }
  /** Keeps a mechanism or seating change, then says what happened. */
  function keepHand(next: ReturnType<typeof createSimpleBuild>, step: (s: SimpleSnapshot) => SimpleSnapshot, line: string, mood: "happy" | "point" | "concerned" = "point", values?: Record<string, string>) {
    if (!commit(next, step)) return false;
    setVerdict(null);
    speak({ lines: [values ? { key: `hands.${line}`, values } : { key: `hands.${line}` }], mood, point: "scene" });
    return true;
  }
  function handMechanism(key: SimplePartKey, desired: "open" | "closed") {
    if (handsOff()) return;
    if (!takeStep()) return;
    const ret = retOf(key);
    if (ret && isM2Key(key)) {
      const r = setSimpleMechanism(state, ret.id, desired);
      if (!r.ok) { sayEngine(r.message, desired === "open" ? "closeBlocked" : "m2LowerFirst"); return; }
      if (!commit(r.state, (sn) => withMechanism(sn, ret.id, desired))) return;
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
    if (!keepHand(r.state, (sn) => withMechanism(sn, ret.id, desired), line, desired === "closed" ? "happy" : "point")) return;
    if ((cpu || k === "m2") && desired === "closed" && simplePartInstalled(r.state, key)) { setSelection(null); setHold(null); if (simpleAllPartsIn(r.state)) setTab("cables"); }
  }
  /** The Intel socket's load lever: released from its tab and lifted, or pushed down and locked under it. */
  function handLever(key: SimplePartKey, desired: "open" | "closed") {
    if (handsOff()) return;
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
    if (!keepHand(r.state, (sn) => withMechanism(sn, ret.leverId!, desired), desired === "open" ? (attached ? "cpuLeverReleased" : "cpuLeverUp") : attached ? "cpuClosed" : "cpuLeverDown", desired === "closed" && attached ? "happy" : "point")) return;
    if (desired === "closed" && simplePartInstalled(r.state, key)) { setSelection(null); setHold(null); }
  }
  /** Clamps a dragged pose to the reach over the board (it never leaves the socket area or goes through parts). */
  /** A memory slot's clip, clicked in the view or with its button: opens it, or closes it over an empty slot. */
  function handClip(slotId: string, near: boolean) {
    if (handsOff()) return;
    if (!takeStep()) return;
    const slot = simpleRamSlots(state).find((x) => x.id === slotId);
    const id = slot ? (near ? slot.nearId : slot.clipId) : null;
    if (!slot || !id) return;
    const desired = (near ? slot.nearOpen : slot.clipOpen) ? "closed" : "open";
    const r = setSimpleMechanism(state, id, desired);
    if (!r.ok) { speak({ lines: [{ key: "hands.ramClipBlocked" }], mood: "concerned", point: "scene" }); return; }
    const released = desired === "open" && slot.occupant !== null;
    if (!keepHand(r.state, (sn) => withMechanism(sn, id, desired), desired === "open" ? (released ? "ramReleased" : "ramClipOpen") : "ramClipClosed")) return;
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
    if (!commit(r.state, (sn) => withLower(sn, key, pose))) return;
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
    if (!keepHand(r.state, (sn) => withLower(sn, key, cpu ? { rotationDeg: hold.rotationDeg, offsetMm: hold.offsetMm } : undefined), cpu ? "cpuLowered" : k === "gpu" ? "gpuIn" : k === "m2" ? "m2Lowered" : "ramIn", "happy")) return;
    if (k === "ram") { setSelection(null); if (simpleAllPartsIn(r.state)) setTab("cables"); }
  }
  /** An M.2 drive: its next line comes from the step the build is now at (the same as the step-by-step controls'). */
  function m2Say(next: ReturnType<typeof createSimpleBuild>, key: SimplePartKey, held: SimpleHeld | null, mood: "happy" | "point" = "point") {
    const line = m2StepLine(next, key, held) ?? (simplePartInstalled(next, key) ? { key: "hands.m2Done" } : null);
    if (line) speak({ lines: [line], mood: simplePartInstalled(next, key) ? "happy" : mood, point: "scene" });
  }
  /** An M.2 drive in hand goes into the slot it is over, tilted as the learner holds it; it rests there at an angle. */
  function handM2Insert(key: SimplePartKey) {
    if (lockedOn || !hold || hold.key !== key) return;
    if (!takeStep()) return;
    const r = lowerSimplePart(state, key, hold);
    if (!r.ok) { sayEngine(r.message, r.reason === "turnPart" ? "m2Turn" : r.reason === "centrePart" ? "m2Centre" : simpleM2OpenFirstKey(state, key, hold?.slotId).replace("hands.", "")); return; }
    const pose = { rotationDeg: hold.rotationDeg, offsetMm: hold.offsetMm, ...(hold.tiltDeg === undefined ? {} : { tiltDeg: hold.tiltDeg }), ...(hold.slotId ? { slotId: hold.slotId } : {}) };
    setHold(null);
    if (!commit(r.state, (sn) => withLower(sn, key, pose))) return;
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
    if (!commit(r.state, (sn) => withMechanism(sn, id, desired))) return;
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
    if (!commit(r.state, (sn) => withMechanism(sn, ret.standId!, "closed"))) return;
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
    if (isM2Key(key)) { if (keepHand(r.state, (sn) => withSeat(sn, key), "m2Pressed")) m2Say(r.state, key, null); return; }
    if (!keepHand(r.state, (sn) => withSeat(sn, key), "ramIn", "happy")) return;
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
      const line = r.reason === "unplugFirst" ? "gpuUnplug" : r.reason === "unscrewFirst" ? "gpuUnscrew" : k === "gpu" ? "gpuReleaseFirst" : k === "ram" && ret?.nearId ? "ramOpenBoth" : k === "m2" ? simpleM2OpenFirstKey(state, key).replace("hands.", "") : `${k}OpenFirst`;
      speak({ lines: [{ key: `hands.${line}` }], mood: "concerned", point: "scene" });
      return;
    }
    // A drive comes up out of its slot at its insertion angle and stays in hand over that same connector,
    // turned as it was in: it is not moved, turned or given another slot for the learner.
    if (m2Pose) {
      if (!keepHand(r.state, (sn) => withLift(sn, key), "m2Lifted", "point", { slot: m2SlotName(m2Pose.slotId!) })) return;
      setHold(m2Pose);
      return;
    }
    if (!keepHand(r.state, (sn) => withLift(sn, key), isRamKey(key) ? "ramLifted" : "lifted")) return;
    // A module comes straight up out of its slot: held right above it, the way it was in.
    const from = isRamKey(key) ? simpleRamSlotOffsets(state).get(ret?.mountPointId ?? "") : undefined;
    if (from) setHold({ key, rotationDeg: 0, offsetMm: from });
    else if (ret) setHold(installPose(state, key, null));
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
    if (!keepHand(r.state, (sn) => withPrep(sn, key, prep, value), line)) return;
  }
  function handPlace(key: SimplePartKey, line: string) {
    if (handsOff()) return;
    if (!takeStep()) return;
    const positionId = isPositionKey(key) && position?.key === key ? position.id : undefined;
    if (isPositionKey(key) && !positionId) { speak({ lines: [{ key: "hands.pickPosition", values: { part: roleLabel(key) } }], mood: "point", point: "scene" }); return; }
    const r = placeSimplePart(state, key, positionId);
    if (!r.ok) {
      if (r.reason === "prepMissing" || r.reason === "prepWrong") sayEngine(r.message, "closeBlocked");
      else if (r.reason === "positionTaken" || r.reason === "positionWrong") speak({ lines: [{ key: `hands.${r.reason}` }], mood: "concerned", point: "scene" });
      else react({ type: "select", selection: { kind: "part", key } });
      return;
    }
    if (!keepHand(r.state, (sn) => withPlace(sn, key, positionId), line)) return;
    setPosition(null);
  }
  /** Chooses where a part with several places goes (memory or M.2 slot, bay, fan place); a taken or unsuitable one is refused with its reason. */
  function choosePlace(key: SimplePartKey, id: string) {
    if (handsOff()) return;
    const place = installPlaces(state, key).find((x) => x.id === id);
    if (!place) return;
    const name = { place: id };
    if (firstAttachment(state, key)) { speak({ lines: [{ key: "install.inPlaceAlready", values: { part: partName(key), place: { place: firstAttachment(state, key)!.target.mountPointId } } }], mood: "point", point: "scene" }); return; }
    if (!place.free) { speak({ lines: [{ key: "install.placeTaken", values: { place: name } }], mood: "concerned", point: "scene" }); return; }
    if (!place.fits) { speak({ lines: [isM2Key(key) ? { key: "hands.m2NoFit", values: { slot: name } } : { key: simplePositions(state, key).find((x) => x.id === id)?.radiator ? "hands.positionRadiator" : "hands.positionWrong" }], mood: "concerned", point: "scene" }); return; }
    setPosition({ key, id });
    setHold(installPose(state, key, id));
    speak({ lines: [{ key: "hands.positionPicked", values: { place: name } }], mood: "point", point: "scene" });
  }
  /** Takes one screw of a fitted board, power supply, drive or fan out again. */
  function handUnscrew(key: SimplePartKey) {
    if (handsOff()) return;
    if (!takeStep()) return;
    const r = unscrewSimplePart(state, key);
    if (!r.ok) return;
    const left = firstAttachment(r.state, key)?.fastenersSecured ?? 0;
    if (!keepHand(r.state, (sn) => withUnscrew(sn, key), left === 0 ? (roleOf(key) === "gpu" ? "gpuUnscrewed" : "unscrewedAll") : "unscrewedOne", "point", { left: String(left) })) return;
  }
  /** Lifts a fitted board, power supply, drive or fan out to the bench once its screws (and leads) are out. */
  function handLiftOut(key: SimplePartKey) {
    if (handsOff()) return;
    if (!takeStep()) return;
    const r = liftSimplePart(state, key);
    if (!r.ok) {
      speak({ lines: [{ key: r.reason === "unplugFirst" ? "hands.liftUnplug" : "hands.liftUnscrew", values: { part: roleLabel(key) } }], mood: "concerned", point: r.reason === "unplugFirst" ? "cables" : "scene" });
      return;
    }
    if (!commit(r.state, (sn) => withLift(sn, key))) return;
    setVerdict(null);
    setSelection(null);
    setTab("parts");
    react({ type: "removed", key }, r.state, false, null);
  }
  /** Plugs the end at `endIndex` into the socket the learner chose (`portId`, one of that end's own choices). */
  function handPlug(key: SimpleCableKey, endIndex: number, portId: string | null) {
    if (handsOff() || !plugHold || plugHold.key !== key) return;
    if (!takeStep()) return;
    if (!portId) { speak({ lines: [{ key: "hands.pickPort" }], mood: "point", point: "cables" }); return; }
    const r = plugSimpleEnd(state, key, endIndex, portId, plugHold.reversed);
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
    if (!commit(r.state, (sn) => withPlug(sn, key, endIndex, portId))) return;
    setVerdict(null);
    setPlugHold({ key, portId: null, reversed: true, end: null });
    if (all) { setSelection(null); setPlugHold(null); react({ type: "connected", key }, r.state, false, null); }
    else speak({ lines: [{ key: "hands.endIn" }], mood: "point", point: "cables" });
  }

  /**
   * One documented step of fitting or taking off a cooler, from the step-by-step panel (the panel and the robot offer
   * the same `nextCoolerStep` / `nextCoolerRemoval`; one click walks `nextCoolerStep` to the end, see one-click.ts).
   */
  function takeCoolerStep(key: SimplePartKey, step: CoolerStep, removal = false) {
    if (handsOff() || !step) return;
    // A fan in the radiator's way is not moved for the learner: the step selects it, and its own steps take it out.
    if (step.kind === "clearFans") {
      choosePart(step.fan);
      speak({ lines: [{ key: "cooler.clearFans", values: { fan: partName(step.fan) } }], mood: "point", point: "scene" });
      return;
    }
    if (!takeStep()) return;
    const r = applyCoolerStep(state, key, step);
    if (!r.ok) {
      if (r.message) sayEngine(r.message, "closeBlocked");
      else if (r.reason === "fanInTheWay") speak({ lines: [{ key: "blocked.fanInTheWay" }], mood: "concerned", point: "scene" });
      else { const line = coolerStepLine(state, key); speak({ lines: [line ?? { key: "hands.closeBlocked" }], mood: "concerned", point: "scene" }); }
      return;
    }
    const history = coolerStepHistory(state, key, step);
    if (!commit(r.state, (sn) => withSimpleStep(sn, history))) return;
    setVerdict(null);
    if (removal) {
      const next = nextCoolerRemoval(r.state, key);
      const line = next ? coolerRemovalLine(next, key) : null;
      if (line) { speak({ lines: [line], mood: "point", point: "scene" }); return; }
      setSelection(null);
      setTab("parts");
      react({ type: "removed", key }, r.state, false, null);
      return;
    }
    const line = nextCoolerStep(r.state, key) ? coolerStepLine(r.state, key) : coolerDoneLine(r.state, key);
    if (nextCoolerStep(r.state, key)) { speak({ lines: line ? [line] : [{ key: "hands.closeBlocked" }], mood: "point", point: "scene" }); return; }
    setSelection(null);
    if (simpleAllPartsIn(r.state)) setTab("cables");
    speak({ lines: line ? [line] : [], mood: "happy", point: "scene" });
  }
  /**
   * One optional step of taking the contact frame off and the original ILM back on (`nextMountingRemoval`), offered
   * only once no cooler body is on the socket. One engine change and one saved step, through the same step gate.
   */
  function takeMountingStep(step: MountingStep) {
    if (handsOff() || !step) return;
    if (!takeStep()) return;
    const r = applyMountingStep(state, step);
    if (!r.ok) { sayEngine(r.message, "closeBlocked"); return; }
    if (!commit(r.state, (sn) => withSimpleStep(sn, mountingStepHistory(step)))) return;
    setVerdict(null);
    const next = nextMountingRemoval(r.state);
    // With the frame off the CPU is free to lift; putting the ILM back is the learner's own choice.
    const line = step.kind === "ilmRefit" ? { key: "cooler.ilmBack" } : step.kind === "frameOff" ? { key: "cooler.cpuFree" } : mountingRemovalLine(next);
    if (line) speak({ lines: [line], mood: "point", point: "scene" });
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
    if (!keepHand(r.state, (sn) => withScrew(sn, key, corner), done ? (roleOf(key) === "gpu" ? "gpuScrewed" : "screwsDone") : "screwIn", done ? "happy" : "point")) return;
    if (done) { setSelection(null); if (simpleAllPartsIn(r.state)) setTab("cables"); }
  }

  /** One of the case's expansion-slot covers beside the card's slot: out before a card, back once no card is there. */
  function handCovers(id: string, desired: "open" | "closed") {
    if (handsOff()) return;
    if (!takeStep()) return;
    const r = setSimpleMechanism(state, id, desired);
    if (!r.ok) { speak({ lines: [{ key: "hands.coversBlocked" }], mood: "concerned", point: "scene" }); return; }
    const left = slotCovers(r.state).filter((c) => !c.open).length;
    if (!keepHand(r.state, (sn) => withMechanism(sn, id, desired), desired === "closed" ? "coversIn" : left ? "coverOut" : "coversOut", "point", { left: String(left) })) return;
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
    if (hasModelledMounting(to)) { speak({ lines: [{ key: "hands.takeOtherCooler" }], mood: "concerned", point: "scene" }); return; }
    const blocked = simpleSwapBlock(state, to);
    if (blocked) { react({ type: "removeBlocked", key: from, reason: blocked }); return; }
    if (!takeStep()) return;
    const next = withSwap(saved, from, to);
    let after: ReturnType<typeof simpleBuildFromSnapshot>;
    try { after = simpleBuildFromSnapshot(next); } catch { react({ type: "select", selection: { kind: "part", key: to } }); return; }
    if (!simplePartInstalled(after, to) || shutOut(after)) return;
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
    if (shutOut(after)) return;
    setSaved(next);
    setSelection(null);
    setVerdict(null);
    setTab("parts");
    react({ type: "removed", key }, after, false, null);
  }

  /** Selecting a lead opens its ends (CablePanel): each goes in, and comes out, by hand, one at a time. */
  function connect(key: SimpleCableKey) {
    if (mode === "fault" && (!fault || fault.solved)) return;
    if (mode !== "fault" && saved.powered) { react({ type: "select", selection: { kind: "cable", key } }); return; }
    if (!(selection?.kind === "cable" && selection.key === key)) chooseCable(key);
  }

  /** Takes one end of a lead out. Every other end stays where it is, and one Undo puts this one back. */
  function unplugEnd(key: SimpleCableKey, endIndex: number) {
    if (handsOff()) { if (lockedOn) speak({ lines: [{ key: "blocked.turnOff" }], mood: "concerned", point: "power" }); return; }
    if (!takeStep()) return;
    const r = unplugSimpleEnd(state, key, endIndex);
    if (!r.ok) {
      speak({ lines: [{ key: r.reason === "turnOffFirst" ? "blocked.turnOff" : "hands.endNotIn" }], mood: "concerned", point: r.reason === "turnOffFirst" ? "power" : "cables" });
      return;
    }
    if (!commit(r.state, (sn) => withUnplug(sn, key, endIndex))) return;
    setVerdict(null);
    // The end just taken out is the one to plug next; no stale socket or turn is carried over.
    setPlugHold({ key, portId: null, reversed: true, end: endIndex });
    react({ type: "unplugged", key }, r.state, false, selection);
  }

  function onTarget(id: string) {
    if (!selection) return;
    const [role, place] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
    if (selection.kind === "part") {
      // A tap in the view only chooses: one of the part's places becomes where it goes; installing is the button's.
      if (installPlaces(state, selection.key).some((p) => p.id === place)) { choosePlace(selection.key, place); return; }
      if (role === "target" || role === "aim") { speak({ lines: [{ key: "install.useButton", values: { part: partName(selection.key) } }], mood: "point", point: "parts" }); return; }
      react({ type: "wrongPlace", key: selection.key, place });
      return;
    }
    // A lit socket is chosen exactly like its button in the cable controls; the plug then goes in with its own button.
    if (role === "target") {
      if (plugHold?.key === selection.key) setPlugHold({ ...plugHold, portId: place });
      else connect(selection.key);
      return;
    }
    react({ type: "wrongPort", key: selection.key, portOf: cableOfPort(place, state) });
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

  /** The next checked step of a keyed part, for the step-by-step controls (and Enter in them): exactly one. */
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
      case "covers": handCovers(step.id, "open"); return;
      case "lower": handLower(key); return;
      case "seat": handSeat(key); return;
      case "fasten": handScrew(key, firstAttachment(state, key)?.fastenersSecured ?? 0); return;
      case "heatsink": handHeatsink(key, step.hsId, step.step); return;
      case "stand": handStand(key); return;
      case "tilt": tiltHeld(true); return;
    }
  }

  function onScenePart(instanceId: string) {
    const part = ALL_SIMPLE_PARTS.find((p) => p.id === instanceId);
    if (part && !simplePartInstalled(state, part.key)) { choosePart(part.key); return; }
    // A fitted fan or drive (the case's own included) is selected to work on it: its screws, then lifting it out.
    if (part && !selection && isPositionKey(part.key)) { choosePart(part.key); return; }
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
    const action = lastSimpleAction(saved);
    const next = undoSimpleStep(saved);
    if (!action.length || !next) { react({ type: "nothingToUndo" }); return; }
    const after = simpleBuildFromSnapshot(next);
    setSaved(next);
    setVerdict(null);
    if (action.length > 1) {
      // A one-click installation taken back whole: that part is where it was before, selected again; nothing else changed.
      const key = ALL_SIMPLE_PARTS.find((p) => JSON.stringify(after.parts.find((x) => x.instanceId === p.id)?.attachments) !== JSON.stringify(state.parts.find((x) => x.instanceId === p.id)?.attachments))?.key;
      setTab("parts");
      if (!key) { setSelection(null); setHold(null); react({ type: "undo", step: action.at(-1)! }, after, next.powered, null); return; }
      const place = autoPlace(after, key);
      setSelection({ kind: "part", key });
      setPosition(place ? { key, id: place } : null);
      setHold(firstAttachment(after, key) ? null : installPose(after, key, place));
      speak({ lines: [{ key: "install.undone", values: { part: partName(key) } }], mood: "idle", point: "parts" });
      return;
    }
    const step = action[0]!;
    // Undoing a lowering puts the part back in hand, above its place, exactly as it was held before.
    const pose = loweredPose(step);
    if (pose) { setSelection({ kind: "part", key: pose.key }); setHold(pose); }
    else setSelection(null);
    if (step.startsWith("part:")) setTab("parts");
    react({ type: "undo", step }, after, next.powered, pose ? { kind: "part", key: pose.key } : null);
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
    const start = withFault(kind)!;
    setFault({ kind, state: start, solved: false, trail: [], baseScrews: boardFrameScrews(start) });
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

  /** One readiness step (panel, mains, PSU switch, power off) as its own saved step; the power button is `pressPower`. */
  function systemStep(control: SystemControl, value: string) {
    if (mode === "fault") return;
    setConfirmRestart(false);
    if (!takeStep()) return;
    const r = setSimpleSystem(state, control, value);
    if (!r.ok) { if (r.reason === "turnOffFirst") speak({ lines: [{ key: "blocked.turnOff" }], mood: "concerned", point: "power" }); return; }
    // A save from before the readiness steps says "running" with no step for it: switching off just clears that flag.
    const older = control === "power" && !saved.history.includes("sys:power:on");
    const next = older ? { ...saved, powered: false } : withSimpleStep(saved, `sys:${control}:${value}`);
    setSaved(next);
    setVerdict(null);
    if (control === "power") react({ type: "powerOff" }, simpleBuildFromSnapshot(next), false, selection);
  }

  /** Presses the button on the build exactly as it stands: the engine says whether it works, and what is wrong if not. */
  function pressPower() {
    if (!takeStep()) return;
    const result = pressSimplePower(state);
    setAttempt({ state: result.ok ? result.state : state, startup: result.startup });
    setVerdict(result.ok ? "success" : "failure");
    setFailedRule(result.ok ? null : result.rule);
    setSelection(null);
    if (result.ok) {
      setSaved((previous) => withSimpleStep(previous, "sys:power:on"));
      react({ type: "powerOn" }, result.state, true, null);
      return;
    }
    const missing = leads.find((c) => c.essential && !simpleCableConnected(state, c.key))?.key ?? null;
    if (result.rule) setTab("parts");
    else if (simpleBootPartsIn(state)) setTab("cables");
    react({ type: "powerFail", missingCable: missing, rule: result.rule }, state, false, null);
  }

  /** Fault finder: one press tries the build as it is. Otherwise the readiness steps below do it. */
  function power() {
    setConfirmRestart(false);
    if (!fault) return;
    const result = startSimplePC(fault.state);
    setAttempt({ state: fault.state, startup: result.startup });
    setVerdict(result.ok ? "success" : "failure");
    setFailedRule(result.ok ? null : result.rule);
    if (result.ok) setFault({ ...fault, solved: true });
  }

  /** "What next?" and "Help" for a selected part follow its one-click plan; explanations keep their detail. */
  const askedPlan = (intent: string | null) => (intent === "next" || intent === "help") && selection?.kind === "part" && !lockedOn ? planSay(selection.key) : null;
  function quick(intent: "next" | "help" | "explain") {
    setGuided(true);
    const say = askedPlan(intent);
    if (say) { speak(say); return; }
    react({ type: "ask", intent });
  }

  async function ask(text: string) {
    setGuided(true);
    const intent = intentOf(text);
    if (intent === "undo") { undo(); return; }
    // A question that names a part or lead ("why does RAM go in A2?") is answered about that part.
    const topic = topicOf(text);
    if (topic && intent !== "next" && (intent || ai !== "available")) { speak({ lines: [{ key: `explain.${topic}` }], mood: "thinking", point: "scene" }, { question: text }); return; }
    const planned = askedPlan(intent);
    if (planned) { speak(planned, { question: text }); return; }
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
  // Every part and lead is in but the panel, mains or PSU switch is not set: that is what to do first.
  const unreadied = nextReadiness(state)?.control !== "power" ? nextReadiness(state) : null;
  const missingMessage = rule ? ruleText : !simpleBootPartsIn(state) ? t("missing") : firstMissingCable ? t("missingCable", { cable: cableName(firstMissingCable.key) }) : unreadied ? t("ready.fixFirst", { step: t(`ready.do.${unreadied.control}.${unreadied.value}`) }) : t("checkCables");
  const placeName = (key: SimplePartKey) => {
    // A memory module: the slot it is in, else the slot it is held over, else none. Never a default slot.
    if (isRamKey(key)) {
      const ramIn = firstAttachment(state, key);
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
  /** Where one click puts `key`: the place chosen for it now, else the automatic one (null for a part with one place). */
  const chosenPlace = (key: SimplePartKey) => (position?.key === key ? position.id : autoPlace(state, key));
  /** A place as the page names it: a memory or M.2 slot's printed name, a bay or fan place's label, else the part's one place. */
  const placeText = (key: SimplePartKey, place: string | null) => {
    if (place && isRamKey(key)) return ramSlotName(place);
    if (place && isM2Key(key)) return m2SlotName(place);
    return (place ? installPlaces(state, key).find((x) => x.id === place)?.label[lang] : null) ?? placeName(key);
  };
  /**
   * A place named in a robot line, in the page's language when the line is drawn (so switching language renames it):
   * the practice build's own names, else the board's or case's label. Lines carry the place id, never its words.
   */
  const robotPlace = (id: string) => (!planned && t.has(`companion.places.${id}`) ? t(`companion.places.${id}`) : placeLabelOf(id));
  /** The place a robot line names for `key`: the chosen slot or place, else the part's one place. */
  const placeValue = (key: SimplePartKey, place: string | null) => ({ place: place ?? simpleTarget(state, key).mountPointId });
  /** Why one click cannot fit the part now: a mandatory step or part first, or a place that cannot take it. */
  function installBlockLine(key: SimplePartKey, plan: Extract<InstallPlan, { ok: false }>, at: PCBuildState = state): CompanionLine {
    switch (plan.reason) {
      case "turnOff": return { key: "install.turnOff" };
      case "alreadyIn": return { key: "already", values: { part: partName(key) } };
      case "required": return blockLine(at, key, plan.block);
      case "placeTaken": return { key: "install.placeTaken", values: { place: placeValue(key, plan.place) } };
      case "placeWrong": return { key: "install.placeWrong", values: { part: partName(key), place: placeValue(key, plan.place) } };
      case "noPlace": return { key: "install.noPlace", values: { part: partName(key) } };
      case "fanInTheWay": return { key: "install.fanInTheWay", values: { fan: partName(plan.fan) } };
      case "refused": return plan.message ? { key: "hands.engine", values: { text: plan.message[lang] } } : { key: "blocked.cannotFit" };
    }
  }
  /**
   * The robot's guidance for a selected part, from its actual one-click plan: ready, so press Install; refused, so the
   * exact prerequisite; already in, null (the usual next part). Mechanical detail stays in the explanations and the
   * step-by-step controls; it is never given as the next thing to click.
   */
  function planSay(key: SimplePartKey, at: PCBuildState = state, history: readonly SimpleStep[] = stepsTaken, place: string | null = chosenPlace(key)): CompanionSay | null {
    const plan = planInstall(at, key, place, history);
    if (plan.ok) return { lines: [{ key: "install.ready", values: { part: partName(key), place: placeValue(key, plan.place) } }], mood: "point", point: "parts" };
    if (plan.reason === "alreadyIn") return null;
    return { lines: [installBlockLine(key, plan, at)], mood: "concerned", point: plan.reason === "turnOff" ? "power" : "parts" };
  }
  /** What the robot says after one click: done and where, how it was done (the educational part), any advice, and what is next. */
  function installedLines(key: SimplePartKey, plan: Extract<InstallPlan, { ok: true }>, after: PCBuildState): CompanionLine[] {
    const role = roleOf(key);
    const radiator = plan.steps.includes(`rad:${key}` as SimpleStep);
    const exhaust = after.parts.find((p) => p.instanceId === partSpec(key).id)?.prep?.airflow === "exhaust";
    const how = radiator && !plan.steps.some((st) => st.startsWith(`place:${key}`)) ? "radiator"
      : role === "aio" || (role === "cooler" && partSpec(key).radiator) ? "liquid" : role === "storage" ? (isM2Key(key) ? "m2" : "drive")
      : role === "fan" ? (exhaust ? "fanExhaust" : "fanIntake") : role;
    const place = plan.place ? installPlaces(state, key).find((x) => x.id === plan.place) : undefined;
    const recommended = installPlaces(state, key).find((x) => x.recommended && x.free && x.fits && x.id !== plan.place);
    return [
      { key: "install.doneIn", values: { part: partName(key), place: placeValue(key, plan.place) } },
      { key: `install.how.${how}` },
      // Advice, never a rule: the place works, the manual or the usual layout recommends another.
      ...(place && !place.recommended && recommended ? [{ key: "install.tipNotRecommended", values: { rec: { place: recommended.id } } }] : []),
      ...(mode === "guided" ? [nextLine(after, false)] : []),
    ];
  }
  const summary = complete ? {
    parts: SIMPLE_PARTS.flatMap((p) => simpleSlotPart(state, slotOf(p.key)) ?? []).map((key) => (isRamKey(key) ? `${label(key)} · ${placeName(key)}` : label(key))),
    cables: leads.map((c) => cableName(c.key)),
  } : null;
  const removable = selectedPart ? REMOVABLE.includes(selectedPart) : false;
  /** A board, power supply, drive or fan already in its place (its screws are in, partly in or out). */
  const placedScrewed = Boolean(selectedPart && simpleUsesScrews(selectedPart) && roleOf(selectedPart) !== "cooler" && !simpleIsLiquid(selectedPart) && firstAttachment(state, selectedPart));
  const removeBlocked = selectedPart && partInstalled && removable ? simpleRemoveBlock(state, selectedPart) : null;
  /** The part this one would replace: the other CPU or cooler, when that one is in. */
  const rival = selectedPart && !partInstalled && SWAPPABLE.includes(selectedPart) ? simpleSlotPart(state, slotOf(selectedPart)) : null;
  const swapBlocked = selectedPart && rival ? simpleSwapBlock(state, selectedPart) : null;
  const blockHint = (reason: string) => t(reason === "turnOffFirst" ? "turnOffToSwap" : reason);
  const canUndo = lastSimpleAction(saved).length > 0;
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
  // The CPU's socket in the view: its lever and plate still answer clicks and taps (one checked step each, a
  // secondary control); nothing on it glows, since one click does the whole fitting.
  const socketHands = cpuKind && selectedPart && keyed ? {
    hostInstanceId: keyed.hostInstanceId,
    highlight: null,
    onLever: () => (keyed.leverId ? handLever(selectedPart, keyed.leverOpen ? "closed" : "open") : handMechanism(selectedPart, keyed.open ? "closed" : "open")),
    onPlate: keyed.leverId ? () => handMechanism(selectedPart, keyed.open ? "closed" : "open") : undefined,
  } : null;
  // Memory in hand: the slot it is over, the clip the next step is about, and clip clicks in the view.
  const ramKey = selectedPart && isRamKey(selectedPart) ? selectedPart : null;
  const ramAt = ramKey ? firstAttachment(state, ramKey) : undefined;
  const ramTarget = ramKey && !ramAt && hold?.key === ramKey ? simpleRamTargetFor(state, hold.offsetMm) : null;
  // The slot the module is held over (its chosen place) is marked; its clips still answer clicks (a secondary control).
  const ramScene = { onClip: handClip, glowClip: null, targetSlot: ramTarget?.slotId ?? null, targetOk: Boolean(ramTarget && Math.hypot(ramTarget.residual[0], ramTarget.residual[1]) <= 1.5 && hold?.rotationDeg === 0) };
  // The robot points at where the selected part goes (or what has to come first), not at a lever or a clip.
  const sceneGuide = guide;
  ramDebug.current = ramKey ? { key: ramKey, target: ramTarget?.slotId ?? null, installedIn: ramAt?.target.mountPointId ?? null, seating: ramAt?.seating ?? null, glow: null, highlight: ramScene.targetSlot, guide: sceneGuide?.targets ?? null, heading: placeName(ramKey) } : null;
  const heldNow = selectedPart && keyed && hold?.key === selectedPart && !(state.parts.find((p) => p.instanceId === partSpec(selectedPart).id)?.attachments.length)
    ? { instanceId: partSpec(selectedPart).id, target: isRamKey(selectedPart) ? simpleRamReference(state) : simpleTarget(state, selectedPart, hold.slotId), rotationDeg: hold.rotationDeg, offsetMm: hold.offsetMm, liftMm: keyed.kind === "pcie_latch" ? 40 : isRamKey(selectedPart) ? 12 : 22, ...(hold.tiltDeg ? { tiltDeg: hold.tiltDeg } : {}) }
    : null;

  /** The CPU's or module's own mechanism, alignment and lowering, one honest step at a time. */
  function HandsPanel() {
    const kind = handKind(keyed!.kind);
    if (kind === "gpu") return GpuHands();
    if (kind === "cpu") return CpuHands();
    if (kind === "ram") return RamHands();
    return M2Hands();
  }

  /** Panel, mains, PSU switch and power button as separate steps; the next one is marked, the order is not forced. */
  function Readiness() {
    const next = nextReadiness(state);
    const rows = [["panel", ["closed", "open"]], ["wall", ["in", "out"]], ["psu", ["on", "off"]]] as const;
    return (
      <div className={styles.readiness}>
        <p className={styles.hint}>{t(lockedOn ? "ready.running" : "ready.title")}</p>
        <ul>
          {rows.map(([control, [good, other]]) => {
            const value = simpleSystemValue(state, control);
            const flip = value === good ? other : good;
            return <li key={control}>
              <span>{t(`ready.state.${control}.${value}`)}</span>
              <button type="button" aria-current={next?.control === control ? "step" : undefined} disabled={!ready || lockedOn || handsOff()} onClick={() => systemStep(control, flip)}>{t(`ready.do.${control}.${flip}`)}</button>
            </li>;
          })}
        </ul>
        <button className={styles.powerButton} type="button" aria-current={next?.control === "power" ? "step" : undefined} disabled={!ready} onClick={() => (lockedOn ? systemStep("power", "off") : pressPower())}>
          <span aria-hidden="true">⏻</span>{t(lockedOn ? "ready.off" : "ready.press")}
        </button>
      </div>
    );
  }

  /** One lead: each end into a port the learner picks, turned the right way. */
  function CablePanel() {
    const key = selectedCable!;
    const ends = simpleCableEnds(key);
    const hold = plugHold?.key === key ? plugHold : { key, portId: null, reversed: true, end: null };
    const next = simpleActiveEnd(state, key, hold.end);
    const end = ends[next];
    const disabled = !ready || handsOff() || Boolean(cableBlocked);
    const choices = end ? simplePortChoices(state, end) : [];
    // A choice made for another end (or before an undo) is not carried over.
    const picked = choices.some((c) => c.portId === hold.portId) ? hold.portId : null;
    const hostName = (instanceId: string) => { const p = ALL_SIMPLE_PARTS.find((x) => x.id === instanceId); return p ? label(p.key) : t("hands.theDrive"); };
    const owner = state.cables.find((c) => c.id === cableSpec(key).id)?.ownerInstanceId;
    const captive = ends.length === 1 && Boolean(owner && pcCatalog.entries.find((e) => e.id === state.parts.find((p) => p.instanceId === owner)?.catalogId)?.category === "psu");
    return (
      <div className={styles.hands}>
        <ol className={styles.substeps}>
          {ends.map((e, i) => {
            const socket = actualEndPort(state, e);
            const socketName = socket ? simpleSocketName(state, e.instanceId, socket) : null;
            const loose = !simpleEndPlugged(state, e);
            const choosable = loose && ends.filter((x) => !simpleEndPlugged(state, x)).length > 1;
            return <li key={i}><span aria-hidden="true">{loose ? i + 1 : "✓"}</span> {choosable
              ? <button type="button" aria-pressed={next === i} disabled={!ready || handsOff()} onClick={() => setPlugHold({ ...hold, end: i, portId: null, reversed: true })}>{t("hands.endInto", { part: hostName(e.instanceId) })}</button>
              : t("hands.endInto", { part: hostName(e.instanceId) })}
              {socketName && <> · {socketName[lang]} <button type="button" disabled={!ready || handsOff()} aria-label={t("hands.unplugEnd", { part: hostName(e.instanceId) })} onClick={() => unplugEnd(key, i)}>{t("hands.unplugEndShort")}</button></>}
            </li>;
          })}
        </ol>
        {captive && <p className={styles.cablesNote}>{t("hands.captive")}</p>}
        {end && <div className={styles.holdControls} role="group" aria-label={t("hands.endInto", { part: hostName(end.instanceId) })}>
          <div className={styles.holdRow} role="radiogroup" aria-label={t("hands.whichPort")}>
            {choices.map((c) => <button key={c.portId} type="button" role="radio" disabled={disabled} aria-checked={picked === c.portId} onClick={() => setPlugHold({ ...hold, portId: c.portId })}>{picked === c.portId ? "● " : ""}{locale === "ar" ? c.label.ar : c.label.en}{c.occupied && ` · ${t("hands.positionTag.taken")}`}</button>)}
          </div>
          <p className={styles.alignState} aria-live="polite">{t(hold.reversed ? "hands.plugReversed" : "hands.plugMatched")}</p>
          <div className={styles.holdRow}><button type="button" disabled={disabled} onClick={() => setPlugHold({ ...hold, reversed: !hold.reversed })}>{t("hands.turnPlug")}</button></div>
          <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handPlug(key, next, picked)}>{t("hands.plugIn")}</button>
        </div>}
        <p className={styles.cablesNote}>{t("hands.plugNote")}</p>
      </div>
    );
  }

  /**
   * The optional mounting-hardware step (contact frame screws, frame off, original ILM back), as a secondary choice
   * under the reason it is optional. Nothing while a cooler body is on the socket or no frame work is left.
   */
  function mountingControls(lead: string) {
    const next = nextMountingRemoval(state);
    const line = mountingRemovalLine(next);
    if (!next || !line) return null;
    const disabled = !ready || handsOff();
    return <>
      <p className={styles.hint}>{lead}</p>
      <div role="group" aria-label={t("hands.mountingGroup")}>
        <button type="button" className={styles.cancel} disabled={disabled} onClick={() => takeMountingStep(next)}>{t(`companion.${line.key}`, line.values as never)}</button>
      </div>
    </>;
  }

  /** Cooler, board, PSU or fan: the preparation it needs, putting it in place, then its screws one by one. */
  /** Fitting or taking off a cooler with a documented mounting: the next step, and the choices the manual leaves open. */
  function CoolerPanel() {
    const key = selectedPart!;
    const disabled = !ready || handsOff();
    const words = (l: CompanionLine | null) => (l ? lineWords(l) : "");
    const step = nextCoolerStep(state, key);
    const removal = nextCoolerRemoval(state, key);
    const part = state.parts.find((p) => p.instanceId === partSpec(key).id);
    const started = Boolean(part?.attachments.length);
    const choose = (active: boolean, label: string, run: () => void) =>
      <button type="button" className={styles.installButton} aria-pressed={active} disabled={disabled} onClick={run}>{label}</button>;
    // Taking the frame off has been chosen: its next step leads, and the fitting step it replaced stays as the way back.
    const dismantle = mountingDismantling(stepsTaken, mode === "fault" ? fault?.baseScrews : undefined) ? nextMountingRemoval(state) : null;
    if (dismantle) {
      return (
        <div className={styles.hands}>
          <div role="group" aria-label={t("hands.mountingGroup")}>
            <button type="button" className={styles.installButton} disabled={disabled} onClick={() => takeMountingStep(dismantle)}>{words(mountingRemovalLine(dismantle))}</button>
          </div>
          {step && <>
            <p className={styles.hint}>{t("hands.refitInstead")}</p>
            <div role="group" aria-label={t("hands.refitGroup")}>
              <button type="button" className={styles.cancel} disabled={disabled} onClick={() => takeCoolerStep(key, step)}>{words(coolerStepLine(state, key))}</button>
            </div>
          </>}
          <p className={styles.hint}>{t("hands.why.cooler")}</p>
        </div>
      );
    }
    return (
      <div className={styles.hands}>
        {step && (step.kind === "cpuFirst" || step.kind === "boardFirst"
          ? <p className={styles.hint}>{words(coolerStepLine(state, key))}</p>
          : step.kind === "backplate"
            ? <>
                {choose(false, t("companion.cooler.backplatePadding"), () => takeCoolerStep(key, { kind: "backplate", value: "padding" }))}
                {choose(false, t("companion.cooler.backplateTape"), () => takeCoolerStep(key, { kind: "backplate", value: "tape" }))}
              </>
            : choose(false, words(coolerStepLine(state, key)), () => takeCoolerStep(key, step)))}
        {removal && started && <button type="button" className={styles.cancel} disabled={disabled} onClick={() => takeCoolerStep(key, removal, true)}>{words(coolerRemovalLine(removal, key))}</button>}
        {!step && !removal && <p className={styles.handsState}>{words(coolerDoneLine(state, key))}</p>}
        {mountingControls(t("hands.mountingOptional"))}
        <p className={styles.hint}>{t("hands.why.cooler")}</p>
        <p className={styles.cablesNote}>{t("hands.prepNote")}</p>
      </div>
    );
  }

  function PrepPanel() {
    const key = selectedPart!;
    const liquid = simpleIsLiquid(key);
    const role = liquid ? "cooler" : roleOf(key);
    const spec = partSpec(key);
    const part = state.parts.find((p) => p.instanceId === spec.id);
    const at = part?.attachments[0];
    const prep = part?.prep ?? {};
    const disabled = !ready || handsOff();
    const secured = at?.fastenersSecured ?? 0;
    const required = simpleRequiredScrews(state, key);
    const advice = !at && (role === "psu" || role === "fan") ? simpleOrientationAdvice(state, key, position?.key === key ? position.id : undefined) : null;
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
          {isPositionKey(key) && <div className={styles.holdRow} role="group" aria-label={t(`hands.positionTitle.${role}`)}>
            {simplePositions(state, key).map((place) => {
              const tag = place.occupant ? t(place.supplied ? "hands.positionTag.supplied" : "hands.positionTag.taken") : place.radiator ? t("hands.positionTag.radiator") : !place.fits ? t("hands.positionTag.wrong") : "";
              return <button key={place.id} type="button" disabled={disabled} aria-pressed={position?.key === key && position.id === place.id} onClick={() => choosePlace(key, place.id)}><bdi>{place.label[lang]}</bdi>{tag && <small> · {tag}</small>}</button>;
            })}
          </div>}
          {liquid
            ? <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handPlace(key, "coolerPlaced")}>{t("hands.place.liquid")}</button>
            : <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handPlace(key, role === "cooler" ? "coolerPlaced" : "placedScrews")}>{t(`hands.place.${role}`)}</button>}
        </>}
        {at && secured < required && (role === "cooler"
          ? <div className={styles.holdRow} role="group" aria-label={t("hands.screwsTitle")}>
              {[0, 1, 2, 3].map((c) => <button key={c} type="button" disabled={disabled || order.done.includes(c)} aria-pressed={order.done.includes(c)} onClick={() => handScrew(key, c)}>{order.done.includes(c) ? "✓ " : ""}{t(`hands.corner${c}`)}</button>)}
            </div>
          : <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handScrew(key, secured)}>{t("hands.nextScrew", { n: secured + 1, total: required })}</button>)}
        {at && <p className={styles.handsState}>{t("hands.screwsState", { n: secured, total: required })}</p>}
        <p className={styles.hint}>{t(`hands.why.${role}`)}</p>
        {advice && <p className={styles.hint}>{t(`hands.advice.${advice}`)}</p>}
        {liquid && <p className={styles.cablesNote}>{t("hands.liquidNote")}</p>}
        <p className={styles.cablesNote}>{t("hands.prepNote")}</p>
      </div>
    );
  }

  /** A board, power supply, drive or fan that is in its place: tighten the next screw, take one out, or (screws out) lift it to the bench. */
  function PlacedPanel() {
    const key = selectedPart!;
    const secured = firstAttachment(state, key)?.fastenersSecured ?? 0;
    const required = simpleRequiredScrews(state, key);
    const disabled = !ready || handsOff();
    const role = roleOf(key);
    return (
      <div className={styles.hands}>
        <p className={styles.handsState}>{t("hands.screwsState", { n: secured, total: required })}</p>
        {secured < required && <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handScrew(key, secured)}>{t("hands.nextScrew", { n: secured + 1, total: required })}</button>}
        {secured > 0
          ? <button className={styles.cancel} type="button" disabled={disabled} onClick={() => handUnscrew(key)}>{t("hands.unscrewNext", { n: secured, total: required })}</button>
          : <button className={styles.cancel} type="button" disabled={disabled} onClick={() => handLiftOut(key)}>{t(`hands.liftOutOf.${role}`)}</button>}
        <p className={styles.hint}>{t(`hands.removeWhy.${role}`)}</p>
      </div>
    );
  }

  /** The CPU and its socket: lever and plate (Intel) or lever (AM4), the CPU held, turned and centred, then lowered. */
  function CpuHands() {
    const key = selectedPart!;
    const ret = keyed!;
    const lga = Boolean(ret.leverId);
    const at = firstAttachment(state, key);
    const host = state.parts.find((p) => p.instanceId === ret.hostInstanceId);
    const coverOn = lga && host?.mechanisms?.[`${ret.id}:cover`] !== "open";
    const rival = simpleSlotPart(state, "cpu");
    const otherIn = rival && rival !== key ? rival : null;
    const off = hold ? Math.hypot(hold.offsetMm[0], hold.offsetMm[1]) : 0;
    const disabled = !ready || handsOff();
    const leverUp = lga ? ret.leverOpen : ret.open;
    // A cooler's contact frame in place of the ILM: the engine refuses the plate and lever, and lifting the CPU under the frame.
    const boardHw: Record<string, string> = (lga ? host?.hardware : undefined) ?? {};
    const frameOn = boardHw.frame === "placed";
    const ilmOff = boardHw.ilm === "removed";
    const btn =(label: string, onClick: () => void, primary = true) => <button className={primary ? styles.installButton : styles.cancel} type="button" disabled={disabled} onClick={onClick}>{label}</button>;
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
            {!ilmOff && btn(t(lga ? "hands.closePlate" : "hands.lowerZif"), () => handMechanism(key, "closed"))}
            {!frameOn && btn(t("hands.liftOut"), () => handLift(key), false)}
          </>}
          {/* The way out from under a contact frame: its own optional steps, here as well as on the cooler. */}
          {frameOn && at && (nextMountingRemoval(state) ? mountingControls(t("hands.frameHoldsCpu")) : <p className={styles.hint}>{t("removeCoolerFirst")}</p>)}
          {!frameOn && ilmOff && mountingControls(t("hands.ilmOff"))}
        </>}
        <p className={styles.hint}>{t("hands.markCpu")}</p>
        <p className={styles.cablesNote}>{t(simpleCpuSourceKey(lga))}</p>
        <p className={styles.cablesNote}>{t("hands.note")}</p>
      </div>
    );
  }
  /** A memory module: the slot it is over, that slot's clip(s), the module turned and lined up, lowered, then pressed home. */
  function RamHands() {
    const key = selectedPart!;
    const at = firstAttachment(state, key);
    const slots = simpleRamSlots(state);
    const target = !at && hold?.key === key ? simpleRamTargetFor(state, hold.offsetMm) : null;
    const slot = slots.find((x) => x.id === (at ? at.target.mountPointId : target?.slotId));
    const name = ramSlotName;
    const count = slots.filter((x) => x.occupant && x.occupant !== key).length + 1;
    const rec = simpleRamRecommended(state, count);
    const disabled = !ready || handsOff();
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
    const at = firstAttachment(state, key);
    const slotId = at?.target.mountPointId ?? (hold?.key === key ? hold.slotId : undefined);
    const hs = slotId ? simpleM2Heatsink(state, slotId) : null;
    const screw = ret.kind === "m2_screw";
    const m2Note = simpleM2SourceNote(state, key, slotId ?? undefined);
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
        <p className={styles.cablesNote}>{t(m2Note.key, m2Note.values)}</p>
        <p className={styles.cablesNote}>{t("hands.note")}</p>
      </div>
    );
  }

  /** The graphics card: slot covers, the slot's push latch, bracket alignment, screws; and the same in reverse. */
  function GpuHands() {
    const key = selectedPart!;
    const ret = keyed!;
    const at = firstAttachment(state, key);
    const covers = slotCovers(state);
    // The covers matter once the board is in the case; before that the card has no case opening to meet.
    const boardInCase = simplePartInstalled(state, "motherboard");
    const secured = at?.fastenersSecured ?? 0;
    const required = simpleRequiredScrews(state, key);
    const off = hold ? Math.hypot(hold.offsetMm[0], hold.offsetMm[1]) : 0;
    const disabled = !ready || handsOff();
    const st = (open: boolean) => t(open ? "hands.open" : "hands.closed");
    return (
      <div className={styles.hands}>
        <div className={styles.handsHead}>
          <p className={styles.handsState}>{t("hands.pcieLatch", { state: st(ret.open) })} · {boardInCase ? t("hands.coversCount", { n: covers.filter((c) => c.open).length, total: covers.length }) : t("hands.covers", { state: t("hands.coversLater") })}{at ? ` · ${t("hands.screwsState", { n: secured, total: required })}` : ""}</p>
          <button type="button" className={styles.closeup} onClick={() => focusOn(ret.hostInstanceId, ret.mountPointId)}>{t("hands.closeup")}</button>
        </div>
        {!at && <>
          {boardInCase && covers.map((c, i) => (
            <button key={c.id} className={c.open ? styles.cancel : styles.installButton} type="button" disabled={disabled} onClick={() => handCovers(c.id, c.open ? "closed" : "open")}>{t(c.open ? "hands.refitCover" : "hands.removeCover", { n: i + 1 })}</button>
          ))}
          {!ret.open && <button className={covers.some((c) => !c.open) ? styles.cancel : styles.installButton} type="button" disabled={disabled} onClick={() => handMechanism(key, "open")}>{t("hands.openPcie")}</button>}
          {hold && <div className={styles.holdControls} role="group" aria-label={t("hands.title")} tabIndex={0} onKeyDown={(e) => holdKeys(e, key)}>
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
          {!boardInCase && <p className={styles.hint}>{t("hands.gpuBoardFirst")}</p>}
        </>}
        {at && <>
          {at.seating === "seated" && secured < required && <button className={styles.installButton} type="button" disabled={disabled} onClick={() => handScrew(key, secured)}>{t("hands.nextScrew", { n: secured + 1, total: required })}</button>}
          {secured > 0 && <button className={styles.cancel} type="button" disabled={disabled} onClick={() => handUnscrew(key)}>{t("hands.unscrewNext", { n: secured, total: required })}</button>}
          {secured === 0 && !ret.open && <button className={styles.cancel} type="button" disabled={disabled} onClick={() => handMechanism(key, "open")}>{t("hands.releasePcie")}</button>}
          {secured === 0 && ret.open && <button className={styles.cancel} type="button" disabled={disabled} onClick={() => handLift(key)}>{t("hands.liftOut")}</button>}
        </>}
        <p className={styles.hint}>{t("hands.markGpu")}</p>
        <p className={styles.cablesNote}>{t(simpleGpuSourceKey())}</p>
        <p className={styles.cablesNote}>{t("hands.note")}</p>
      </div>
    );
  }

  // ---------- The selected part's card: what it is, where it goes, the one Install button, Undo and the view toggles ----------

  /** One click's plan for the selected part as the card shows it beforehand (the click itself plans again from the build). */
  const selectedPlace = selectedPart ? chosenPlace(selectedPart) : null;
  const selectedPlan = useMemo(
    () => (selectedPart && ready && !partInstalled && !(mode === "fault" && (!fault || fault.solved)) ? planInstall(state, selectedPart, selectedPlace, stepsTaken) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedPart, ready, partInstalled, mode, fault, state, selectedPlace, stepsTaken],
  );
  type CardStatus = "none" | "ready" | "installing" | "installed" | "blocked";
  const cardStatus: CardStatus = !selectedPart ? "none" : installing === selectedPart ? "installing" : partInstalled ? "installed" : selectedPlan?.ok ? "ready" : "blocked";
  // The places it could go, to choose another (only before it is in one).
  const placeChoices = selectedPart && !partInstalled && !firstAttachment(state, selectedPart) ? installPlaces(state, selectedPart) : [];
  const choiceNow = placeChoices.find((x) => x.id === selectedPlace);
  const otherRecommended = selectedPart && choiceNow && !choiceNow.recommended ? placeChoices.filter((x) => x.recommended && x.free && x.fits).map((x) => placeText(selectedPart, x.id)) : [];
  /** "Focus selected part": the camera goes to it only when asked (in its place, held over where it goes, or on the bench). */
  function focusSelected() {
    if (!selectedPart) return;
    const at = firstAttachment(state, selectedPart);
    if (at) focusOn(partSpec(selectedPart).id);
    else if (heldNow) focusOn(heldNow.target.hostInstanceId, heldNow.target.mountPointId);
    else focusOn(partSpec(selectedPart).id);
  }
  const optionsKey = selection ? `${selection.kind}:${selection.key}` : "";
  // A lead's ends are plugged in its controls, so they open for a lead; a part's are secondary and stay folded.
  const optionsOpen = optionsChoice?.key === optionsKey ? optionsChoice.open : Boolean(selectedCable);
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

      {/* The parts and the selected part's card sit left of the 3D view in both languages (stacked on phones). */}
      <div className={styles.workspace}>
        <div className={styles.side}>
          <div className={styles.actionCard} role="group" aria-label={t("action.label")} data-status={cardStatus}>
            <div className={styles.actionHead}>
              <span className={styles.actionKicker}>{t("action.selected")}</span>
              <strong>{selectedPart ? label(selectedPart) : selectedCable ? cableName(selectedCable) : t("action.none")}</strong>
              {selectedPart && <span className={styles.actionStatus} data-status={cardStatus} role="status">{t(`action.status.${cardStatus}`)}</span>}
            </div>
            {selectedPart && <p className={styles.actionPlace}>{firstAttachment(state, selectedPart) ? t("action.isIn", { place: placeText(selectedPart, firstAttachment(state, selectedPart)!.target.mountPointId) }) : t("action.goesIn", { place: placeText(selectedPart, selectedPlace) })}</p>}
            {placeChoices.length > 1 && <div className={styles.placeChoices} role="radiogroup" aria-label={t("action.place")}>
              {placeChoices.map((x) => <button key={x.id} type="button" role="radio" aria-checked={x.id === selectedPlace} disabled={!ready || !x.free || !x.fits || handsOff()} onClick={() => choosePlace(selectedPart!, x.id)}>
                <bdi>{placeText(selectedPart!, x.id)}</bdi>{x.recommended && <small> · {t("action.recommended")}</small>}{!x.free ? <small> · {t("hands.positionTag.taken")}</small> : !x.fits && <small> · {t("hands.positionTag.wrong")}</small>}
              </button>)}
            </div>}
            {cardStatus === "blocked" && selectedPlan && !selectedPlan.ok && <p className={styles.actionWhy} id="install-why"><strong>{t(selectedPlan.reason === "required" || selectedPlan.reason === "fanInTheWay" ? "action.requiredFirst" : "action.notNow")}</strong> {lineWords(installBlockLine(selectedPart!, selectedPlan))}</p>}
            {cardStatus === "ready" && otherRecommended.length > 0 && <p className={styles.actionTip}><strong>{t("action.tip")}</strong> {t("companion.install.tipNotRecommended", { rec: otherRecommended.join(locale === "ar" ? " أو " : " or ") })}</p>}
            {selectedCable
              ? <button className={styles.installButton} type="button" onClick={openPartOptions} disabled={!ready}>{t("toolbar.moreCable")}</button>
              : <button className={styles.installButton} type="button" onClick={() => selectedPart && installWhole(selectedPart)} disabled={cardStatus !== "ready"} aria-describedby={cardStatus === "blocked" ? "install-why" : undefined}>{cardStatus === "installing" ? t("action.installing") : cardStatus === "installed" ? t("installed") : t("action.install")}</button>}
            {!selection && <p className={styles.hint}>{t("selectFirst")}</p>}
            <div className={styles.actionRow}>
              {mode !== "fault" && <button type="button" className={styles.tool} onClick={undo} disabled={!ready || !canUndo}>{t("undo")}</button>}
              <div className={`${styles.toggles} ${styles.toolGroup}`} role="group" aria-label={t("view.label")}>
                <button type="button" aria-pressed={view.guide} onClick={() => changeView({ guide: !view.guide })}>{t("view.guide")}</button>
                <button type="button" aria-pressed={view.guideMotion && !reducedMotion} disabled={!view.guide || reducedMotion} onClick={() => changeView({ guideMotion: !view.guideMotion })} title={reducedMotion ? t("view.reduced") : undefined}>{t("view.motion")}</button>
                <button type="button" aria-pressed={view.rgb} onClick={() => changeView({ rgb: !view.rgb })}>{t("view.rgb")}</button>
              </div>
            </div>
          </div>
          {/* The parts (and leads) right under the card, so a part is chosen beside the model. */}
          <div className={styles.controls}>
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

            </div>

            <div ref={cablesTarget} hidden={tab !== "cables"}>
              <p className={styles.cablesIntro}>{t(!planned && simplePartInstalled(state, "aio") ? "cablesIntroLiquid" : "cablesIntro")}</p>
              <div className={styles.cables} role="group" aria-label={t("cablesLabel")}>
                {leads.map((item) => {
                  const done = simpleCableConnected(state, item.key);
                  const active = selectedCable === item.key;
                  return <button type="button" key={item.key} className={styles.cable} data-selected={active} data-connected={done} aria-pressed={active} onClick={() => chooseCable(item.key)}>
                    <span className={styles.wireIcon} aria-hidden="true">↳</span>
                    <span>{cableName(item.key)}{!item.essential && <small>{t(item.key.startsWith("caseFan") ? "fanOptional" : "leadOptional")}</small>}</span>
                    {done ? <CheckIcon /> : <span className={styles.unplugged}>{t("loose")}</span>}
                  </button>;
                })}
              </div>
              {!leads.some((c) => c.key.startsWith("sata")) && <p className={styles.cablesNote}>{t("noStorageCable")}</p>}
            </div>
          </div>

          <div className={styles.companionSlot}>
            <BuildCompanion message={message} ai={ai} thinking={thinking} reducedMotion={reducedMotion} onQuick={quick} onAsk={(text) => void ask(text)} summary={summary} placeLabel={robotPlace} {...(planned ? { partLabel: roleLabel } : {})} />
          </div>

          <div className={`${styles.controls} ${styles.more}`}>
            <div className={styles.modes} role="radiogroup" aria-label={t("modes.label")}>
              {(["guided", "independent", "fault"] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => chooseMode(m)} disabled={!ready}>{t(`modes.${m}`)}</button>)}
            </div>
            <p className={styles.hint}>{t(`modes.${mode}Hint`)}</p>
            {mode === "fault" && !fault && <p className={styles.hint}>{t("fault.none")}</p>}
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
                : Readiness()}
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

        <div className={styles.viewer}>
          {/* Every control for the selected part or lead, above the view: prep, screws, swap, removal, substeps,
              each end of a lead, and the reverse steps. Secondary for a part (one click installs it); open for a lead. */}
          {selection && <details key={optionsKey} className={styles.partOptions} open={optionsOpen} onToggle={(event) => { const open = event.currentTarget.open; if (open !== optionsOpen) setOptionsChoice({ key: optionsKey, open }); }}>
            <summary>
              <span className={styles.partOptionsTitle}>{t(selectedCable ? "toolbar.moreCable" : "toolbar.more")}</span>
              {selectedPart
                ? <span className={styles.selection}><strong>{label(selectedPart)}</strong><span>{partInstalled ? (isRamKey(selectedPart) ? `${t("installed")} · ${placeName(selectedPart)}` : t("installed")) : placeName(selectedPart)}</span></span>
                : <span className={styles.selection}><strong>{cableName(selectedCable!)}</strong></span>}
            </summary>
            <div className={styles.partOptionsBody}>
              {selectedPart ? <div className={styles.install}>
                {keyed ? HandsPanel() : hasModelledMounting(selectedPart) ? (rival ? <p className={styles.hint}>{t("hands.takeOtherCooler")}</p> : CoolerPanel()) : placedScrewed ? PlacedPanel() : !partInstalled && !rival && (simpleUsesScrews(selectedPart) || simpleIsLiquid(selectedPart)) ? PrepPanel() : partInstalled && removable
                  ? <button className={styles.installButton} type="button" onClick={() => remove(selectedPart)} disabled={!ready || Boolean(removeBlocked)}>{t("remove")}</button>
                  : rival
                    ? <button className={styles.installButton} type="button" onClick={() => swap(rival, selectedPart)} disabled={!ready || Boolean(swapBlocked)}>{t("swap", { other: label(rival) })}</button>
                    : <button className={styles.installButton} type="button" onClick={() => installWhole(selectedPart)} disabled={!ready || partInstalled || Boolean(partBlocked) || lockedOn}>{partInstalled ? t("installed") : t("action.install")}</button>}
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
                {CablePanel()}
                {cableBlocked && !cableDone && <p className={styles.hint}>{cableBlocked === "turnOffFirst" ? t("turnOffFirst") : t("fitCableParts", { parts: simpleCableMissingParts(state, selectedCable).map((key) => label(key)).join(locale === "ar" ? "، " : ", ") })}</p>}
                {lockedOn && <p className={styles.hint}>{t("turnOffFirst")}</p>}
                <button className={styles.cancel} type="button" onClick={cancel}>{t("cancel")}</button>
              </div>}
            </div>
          </details>}
          <div className={styles.stage}>
          <div className={styles.viewControls} role="group" aria-label={t("camera")}>
            <button type="button" onClick={focusSelected} disabled={!selectedPart}>{t("action.focus")}</button>
            <button type="button" onClick={() => moveCamera("fit")}>{t("action.resetView")}</button>
            <button type="button" aria-label={t("zoomIn")} onClick={() => moveCamera("in")}>+</button>
            <button type="button" aria-label={t("zoomOut")} onClick={() => moveCamera("out")}>−</button>
          </div>
          <div className={styles.canvas} role="group" tabIndex={0} aria-label={t("scene")} onKeyDown={(event) => {
            // The view's keys only move the camera (a part's own keys are in its step-by-step controls).
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
      </div>
    </section>
  );
}
