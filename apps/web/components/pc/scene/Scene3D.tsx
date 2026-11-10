"use client";

import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { Component, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import type { PCBuildState, PCDiagnostic, StartupResult } from "@ytl/contracts";
import { useReducedMotion } from "@/lib/interaction";
import { InfoIcon, WarningIcon } from "../../icons";
import { catalogIndex, entryName } from "../catalog";
import { pcStore } from "../pc-client";
import { SceneActions } from "./SceneActions";
import { moveCamera, sceneStore, useScene, type CameraCommand, type SceneQuality } from "./scene-store";

// Three.js and the scene are a separate chunk, fetched only when the 3D view is shown.
const PcScene = dynamic(() => import("./PcScene"), { ssr: false, loading: () => <SceneLoading /> });

function SceneLoading() {
  const t = useTranslations("pcLab.scene");
  return (
    <p className="state-panel" role="status">
      <span className="spinner" aria-hidden="true" />
      {t("loading")}
    </p>
  );
}

/** A failure inside the scene must not take the list view down with it. */
class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error(error);
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const SHOW_KEY = "ytl_pc_3d";
const QUALITY_KEY = "ytl_pc_3d_quality";
const QUALITIES = ["low", "medium", "high"] as const satisfies readonly SceneQuality[];
const VIEWS = ["front", "top", "side", "angle", "fit"] as const satisfies readonly CameraCommand[];
const MOVES = ["left", "right", "up", "down", "in", "out"] as const satisfies readonly CameraCommand[];
const KEY_MOVES: Record<string, CameraCommand> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", "+": "in", "=": "in", "-": "out" };

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * The 3D view of the build with its camera controls, above the list view. It can be switched
 * off (the scene is then unmounted, not hidden), and it steps aside with a plain message when
 * WebGL is missing or the scene fails; the list view never depends on it.
 */
export function Scene3D({
  state,
  startup,
  diagnostics,
  announce,
  onPress,
}: {
  state: PCBuildState;
  startup: StartupResult;
  diagnostics: readonly PCDiagnostic[];
  announce: (text: string) => void;
  /** Called when the power button press was accepted, so the run gets its own ID. */
  onPress: () => void;
}) {
  const t = useTranslations("pcLab.scene");
  const locale = useLocale();
  const reducedMotion = useReducedMotion();
  const quality = useScene((store) => store.quality);
  const selectedId = useScene((store) => store.selectedPartId);
  const pressSeq = useScene((store) => store.pressSeq);
  // A press of the button drawn in the picture starts a run like the one in the power panel.
  useEffect(() => {
    if (pressSeq > 0) onPress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressSeq]);
  const [show, setShow] = useState(true);
  // null: not checked yet (server render and first paint).
  const [supported, setSupported] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<"lost" | "failed" | null>(null);
  const [attempt, setAttempt] = useState(0);

  // The learner's own display choices for this browser.
  useEffect(() => {
    try {
      if (localStorage.getItem(SHOW_KEY) === "off") setShow(false);
      const stored = localStorage.getItem(QUALITY_KEY);
      if (QUALITIES.includes(stored as SceneQuality)) sceneStore.setState({ quality: stored as SceneQuality });
    } catch {
      // Storage is blocked: the defaults apply.
    }
    setSupported(webglAvailable());
  }, []);

  function remember(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Not remembered; it still applies now.
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    // Escape in the picture drops an open pick, as it does in the list.
    if (event.key === "Escape" && pcStore.getState().assembly.phase !== "idle") {
      event.preventDefault();
      pcStore.getState().send({ type: "cancel" });
      return;
    }
    const command = KEY_MOVES[event.key];
    if (!command || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    moveCamera(command);
  }

  const selectedPart = state.parts.find((part) => part.instanceId === selectedId);
  const selectedEntry = selectedPart && catalogIndex.byId.get(selectedPart.catalogId);
  const running = show && supported === true && problem === null;

  return (
    <section aria-labelledby="scene-heading" className="studio-editor pc-scene">
      <h3 id="scene-heading" className="subheading">
        {t("heading")}
      </h3>
      <label className="settings-option">
        <input
          type="checkbox"
          checked={show}
          onChange={(event) => {
            setShow(event.target.checked);
            remember(SHOW_KEY, event.target.checked ? "on" : "off");
          }}
        />
        <span>{t("show")}</span>
      </label>

      {show && supported === false && (
        <p className="notice">
          <InfoIcon />
          <span>{t("unavailable")}</span>
        </p>
      )}
      {show && problem && (
        <div className="state-panel state-panel-block state-panel-warning" role="alert">
          <p className="notice notice-danger">
            <WarningIcon />
            <span>{t(problem)}</span>
          </p>
          <div className="button-row">
            <button
              type="button"
              className="button"
              onClick={() => {
                setProblem(null);
                setSupported(webglAvailable());
                setAttempt((n) => n + 1);
              }}
            >
              {t("retry")}
            </button>
          </div>
        </div>
      )}

      {running && (
        <>
          <p className="settings-hint">{t("intro")}</p>
          <p className="notice">{t("benchAssembly")}</p>
          <div
            className="pc-scene-canvas"
            // The picture itself is not mirrored in Arabic: hardware has one layout.
            dir="ltr"
            role="group"
            tabIndex={0}
            aria-label={t("canvasLabel")}
            aria-describedby="scene-keys"
            onKeyDown={onKeyDown}
          >
            <SceneBoundary key={attempt} onError={() => setProblem("failed")}>
              <PcScene state={state} startup={startup} reducedMotion={reducedMotion} noModel={t("noModel")} rtl={locale === "ar"} onContextLost={() => setProblem("lost")} />
            </SceneBoundary>
          </div>
          <p id="scene-keys" className="settings-hint">
            {t("keys")}
          </p>
          <p className="state-meta" role="status">
            {selectedEntry ? t("selected", { name: `⁦${entryName(selectedEntry)}⁩` }) : ""}
          </p>
          <SceneActions diagnostics={diagnostics} announce={announce} onPress={onPress} />

          <div role="group" aria-label={t("viewsLabel")} className="button-row">
            {VIEWS.map((view) => (
              <button key={view} type="button" className="button button-small" onClick={() => moveCamera(view)}>
                {t(`views.${view}`)}
              </button>
            ))}
          </div>
          <div role="group" aria-label={t("moveLabel")} className="button-row">
            {MOVES.map((move) => (
              <button key={move} type="button" className="button button-small" onClick={() => moveCamera(move)}>
                {t(`moves.${move}`)}
              </button>
            ))}
          </div>
          <div className="field pc-scene-quality">
            <label htmlFor="scene-quality">{t("quality")}</label>
            <select
              id="scene-quality"
              className="input"
              value={quality}
              onChange={(event) => {
                sceneStore.setState({ quality: event.target.value as SceneQuality });
                remember(QUALITY_KEY, event.target.value);
              }}
            >
              {QUALITIES.map((item) => (
                <option key={item} value={item}>
                  {t(`qualities.${item}`)}
                </option>
              ))}
            </select>
          </div>
          <p className="notice">
            <InfoIcon />
            <span>{t("educational")}</span>
          </p>
        </>
      )}
    </section>
  );
}
