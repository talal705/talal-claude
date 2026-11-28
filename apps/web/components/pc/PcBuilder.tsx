"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { BuildPlanner } from "./BuildPlanner";
import { parsePlannedBuild, planModel, rebaseProgress, snapshotFromHistory, type PlannedBuild } from "./plan-model";
import { checkBuildPlan } from "./planner-data";
import dynamic from "next/dynamic";
import { activateSimpleModel, LEGACY_MODEL, SIMPLE_SAVE_KEY } from "./simple-model";

/** The planned build and which screen the learner was on. */
export const PLAN_KEY = "ytl_pc_plan_v1";
/** Assembly progress of the planned build (version 4 snapshots). The fixed practice build keeps SIMPLE_SAVE_KEY. */
export const PLAN_PROGRESS_KEY = "ytl_pc_plan_progress_v1";

type Phase = "loading" | "plan" | "assemble" | "legacy";
// The assembly workspace (and, behind it, the 3D scene) is fetched when the learner starts or resumes assembly,
// not with the planner: the planner needs only the catalog, the plan and the saved-state code.
const SimplePcLab = dynamic(() => import("./SimplePcLab").then((m) => m.SimplePcLab), {
  ssr: false,
  loading: () => <div style={{ minHeight: "60vh" }} role="status" aria-busy="true" />,
});
const EMPTY: PlannedBuild = { version: 1, purpose: null, workload: "", parts: { storage: [], fans: [] } };

const read = (key: string): unknown => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage is optional. */ } };

/** Purpose → parts → My Build → assembly of that build. The earlier fixed practice build stays reachable. */
export function PcBuilder({ aiConfigured = false }: { aiConfigured?: boolean }) {
  const t = useTranslations("simplePc.planner");
  const [phase, setPhase] = useState<Phase>("loading");
  const [build, setBuild] = useState<PlannedBuild>(EMPTY);
  /** The plan the saved assembly progress belongs to (null: none yet). */
  const [assembled, setAssembled] = useState<PlannedBuild | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mount, setMount] = useState(0);
  const model = useMemo(() => { if (phase === "legacy" || !assembled) return LEGACY_MODEL; try { return planModel(assembled); } catch { return LEGACY_MODEL; } }, [phase, assembled]);

  useEffect(() => {
    const stored = read(PLAN_KEY) as { build?: unknown; phase?: unknown } | null;
    const saved = parsePlannedBuild(stored?.build) ?? EMPTY;
    setBuild(saved);
    const progress = read(PLAN_PROGRESS_KEY) as { version?: unknown; plan?: unknown; history?: unknown[] } | null;
    const progressPlan = progress?.version === 4 ? parsePlannedBuild(progress.plan) : null;
    let ok = false;
    if (progressPlan && checkBuildPlan(progressPlan.parts).ready) {
      try { planModel(progressPlan); setAssembled(progressPlan); ok = true; } catch { /* A plan the catalog no longer assembles: planner only. */ }
    }
    // /pc?practice=1 (the home page's optional link) opens the older practice build.
    if (new URLSearchParams(window.location.search).get("practice") === "1") { activateSimpleModel(LEGACY_MODEL); setPhase("legacy"); }
    else if (stored?.phase === "assemble" && ok && progressPlan) { activateSimpleModel(planModel(progressPlan)); setPhase("assemble"); }
    else if (stored?.phase === "legacy") { activateSimpleModel(LEGACY_MODEL); setPhase("legacy"); }
    else setPhase("plan");
  }, []);

  useEffect(() => { if (phase !== "loading") write(PLAN_KEY, { build, phase }); }, [build, phase]);

  function start() {
    if (!checkBuildPlan(build.parts).ready) return;
    let next: ReturnType<typeof planModel>;
    try { next = planModel(build); } catch { setNotice(t("cannotAssemble")); return; }
    const progress = read(PLAN_PROGRESS_KEY) as { version?: number; placed: string[]; connected: string[]; history: string[]; powered: boolean } | null;
    if (assembled && progress?.version === 4 && Array.isArray(progress.history) && progress.history.length > 0) {
      // Same page, other parts: keep every step the change does not affect.
      const r = rebaseProgress({ ...progress, powered: false }, planModel(assembled), next);
      activateSimpleModel(next);
      const kept = snapshotFromHistory(r.history);
      write(PLAN_PROGRESS_KEY, kept);
      const undone = progress.history.length - kept.history.length;
      setNotice(undone > 0 ? t("progressKept", { kept: kept.history.length, undone }) : null);
    } else {
      activateSimpleModel(next);
      write(PLAN_PROGRESS_KEY, snapshotFromHistory([]));
      setNotice(null);
    }
    setAssembled(build);
    setMount((n) => n + 1);
    setPhase("assemble");
    window.scrollTo?.({ top: 0 });
  }

  function continueAssembly() {
    if (!assembled) return;
    activateSimpleModel(planModel(assembled));
    setMount((n) => n + 1);
    setPhase("assemble");
  }

  function openLegacy() {
    activateSimpleModel(LEGACY_MODEL);
    setMount((n) => n + 1);
    setPhase("legacy");
  }

  const back = () => { setPhase("plan"); window.scrollTo?.({ top: 0 }); };


  if (phase === "loading") return <div style={{ minHeight: "60vh" }} aria-busy="true" />;
  if (phase === "plan") {
    return <BuildPlanner build={build} onChange={setBuild} onStart={start} hasProgress={assembled !== null} onContinue={continueAssembly} legacyAvailable onLegacy={openLegacy} notice={phase === "plan" ? notice : null} />;
  }
  return (
    <>
      {notice && phase === "assemble" && <p role="status" style={{ maxWidth: 1480, margin: "16px auto 0", padding: "10px 14px", border: "1px solid #2c5e46", borderRadius: 12, background: "#0d1a14", color: "#cfeedd", fontSize: 13 }}>{notice}</p>}
      <SimplePcLab key={`${phase}-${mount}`} aiConfigured={aiConfigured} onEditBuild={back} saveKey={phase === "legacy" ? SIMPLE_SAVE_KEY : PLAN_PROGRESS_KEY} model={model} />
    </>
  );
}
