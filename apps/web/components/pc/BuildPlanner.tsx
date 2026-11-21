"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CatalogEntry } from "@ytl/contracts";
import { pc } from "@ytl/simulation";
import { CheckIcon } from "../icons";
import { pcCatalog } from "./catalog";
import { PURPOSES, type BuildPurpose, type PlannedBuild } from "./plan-model";
import {
  BOARD_TIER, categoryOfSlot, checkBuildPlan, compatibleOptions, explainTopic, PLANNER_CATEGORIES, PLANNER_IDS, plannerEntry, slotOfCategory, suggestBuild, WORKLOADS, withChoice, withoutChoice, withoutModel,
  type PlannerCategory,
} from "./planner-data";
import styles from "./planner.module.css";

const byId = new Map(pcCatalog.entries.map((e) => [e.id, e]));
const FORM: Record<string, string> = { atx: "ATX", micro_atx: "micro-ATX", mini_itx: "Mini-ITX", e_atx: "E-ATX" };

/** A few facts per card, read from the catalog entry. */
function specsOf(e: CatalogEntry, t: (k: string) => string): [string, string][] {
  switch (e.category) {
    case "cpu": return [[t("specs.socket"), e.spec.socket.toUpperCase()], [t("specs.cores"), String(e.spec.cores)], [t("specs.memory"), e.spec.memorySupport.map((m) => m.generation.toUpperCase()).join(" / ")], [t("specs.power"), `${e.spec.maxPowerW ?? e.spec.basePowerW} W`]];
    case "motherboard": return [[t("specs.socket"), e.spec.socket.toUpperCase()], [t("specs.form"), FORM[e.spec.formFactor] ?? e.spec.formFactor], [t("specs.memory"), `${e.spec.memory.slots} × ${e.spec.memory.generation.toUpperCase()}`], ["M.2", String(e.mountPoints.filter((m) => m.kind === "m2_slot").length)]];
    case "ram": return [[t("specs.memory"), e.spec.generation.toUpperCase()], [t("specs.capacity"), `${e.spec.modulesInKit} × ${e.spec.capacityPerModuleGb} GB`], [t("specs.speed"), `${e.spec.ratedSpeedMTs} MT/s`]];
    case "storage": return [[t("specs.capacity"), e.spec.capacityGb >= 1000 ? `${e.spec.capacityGb / 1000} TB` : `${e.spec.capacityGb} GB`], [t("specs.form"), e.spec.formFactor.replace("m2_", "M.2 ").replace("_inch", "\"")], [t("specs.interface"), e.spec.interface.toUpperCase()]];
    case "cooling": return e.spec.type === "aio_liquid" ? [[t("specs.radiator"), `${e.spec.radiatorSizeMm} mm`], [t("specs.socket"), e.spec.supportedSockets.map((s) => s.toUpperCase()).join(" ")]] : [[t("specs.height"), `${e.spec.heightMm} mm`], [t("specs.socket"), e.spec.supportedSockets.map((s) => s.toUpperCase()).join(" ")]];
    case "gpu": return [[t("specs.length"), `${e.spec.lengthMm} mm`], [t("specs.power"), `${e.spec.powerDrawW} W`], [t("specs.rec"), `${e.spec.recommendedPsuW} W`]];
    case "psu": return [[t("specs.watts"), `${e.spec.wattageW} W`], [t("specs.length"), `${e.dimensions.lengthMm} mm`], [t("specs.modular"), e.spec.modularity === "none" ? t("modularNone") : t("modularFull")]];
    case "case": return [[t("specs.form"), e.mountPoints.flatMap((m) => (m.kind === "motherboard_tray" ? m.formFactors.map((f) => FORM[f] ?? f) : [])).join(" / ")], [t("specs.gpuMax"), `${e.spec.maxGpuLengthMm} mm`], [t("specs.coolerMax"), `${e.spec.maxCpuCoolerHeightMm} mm`]];
    case "fan": return [[t("specs.fanSize"), `${e.spec.sizeMm} mm`], [t("specs.speed"), `${e.spec.maxRpm} rpm`]];
    default: return [];
  }
}

const chosenIds = (plan: pc.BuildPlan, c: PlannerCategory): string[] => {
  if (c === "storage") return [...(plan.storage ?? [])];
  if (c === "fans") return [...(plan.fans ?? [])];
  if (c === "ram") return plan.ram ? [plan.ram.id] : [];
  const v = plan[c as "cpu"];
  return v ? [v] : [];
};

export function BuildPlanner({ build, onChange, onStart, hasProgress, onContinue, legacyAvailable, onLegacy, notice }: {
  build: PlannedBuild;
  onChange: (next: PlannedBuild) => void;
  onStart: () => void;
  hasProgress: boolean;
  onContinue: () => void;
  legacyAvailable: boolean;
  onLegacy: () => void;
  notice: string | null;
}) {
  const t = useTranslations("simplePc.planner");
  const tr = useTranslations("simplePc.roles");
  const locale = useLocale();
  const lang = locale === "ar" ? "ar" : "en";
  const [category, setCategory] = useState<PlannerCategory>("cpu");
  const [filter, setFilter] = useState<string[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [explain, setExplain] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<pc.PlanSlot[]>([]);
  const [said, setSaid] = useState<string | null>(null);
  const report = useMemo(() => checkBuildPlan(build.parts), [build.parts]);
  const plan = build.parts;
  const set = (parts: pc.BuildPlan) => { onChange({ ...build, parts }); setFilter(null); setExplain(null); setHighlight([]); };
  const nameOf = (id: string) => { const e = byId.get(id); return e ? `${e.brand} ${e.model}` : id; };
  const catName = (c: PlannerCategory) => t(`categories.${c}`);
  const sep = lang === "ar" ? "، " : ", ";

  const findingText = (f: pc.PlanFinding) => {
    const params: Record<string, string | number> = { ...f.params };
    if (f.code === "board_form_factor_unsupported") { const b = byId.get(plan.motherboard ?? ""); params.formFactor = b?.category === "motherboard" ? FORM[b.spec.formFactor] ?? "" : ""; }
    if (t.has(`findingText.${f.code}`)) return t(`findingText.${f.code}`, params);
    return f.engineMessage?.[lang] ?? t("findingText.generic");
  };
  const top = report.findings[0];

  function choosePurpose(p: BuildPurpose) { onChange({ ...build, purpose: p, workload: WORKLOADS[p][0] ?? "" }); }
  function helpMe() {
    if (!build.purpose) return;
    set(suggestBuild(build.purpose, build.workload));
    setSaid(t("suggested"));
  }

  const list = (filter ?? PLANNER_IDS[category]).map((id) => plannerEntry(id)).filter((e): e is CatalogEntry => !!e);

  return (
    <section className={styles.planner} aria-labelledby="planner-title">
      <header className={styles.head}>
        <div><h1 id="planner-title">{t("title")}</h1><p>{t("intro")}</p></div>
        <div className={styles.headActions}>
          {hasProgress && <button type="button" className={styles.secondary} onClick={onContinue}>{t("continueAssembly")}</button>}
          {legacyAvailable && <button type="button" className={styles.ghost} onClick={onLegacy}>{t("legacyBuild")}</button>}
        </div>
      </header>
      {notice && <p className={styles.notice} role="status">{notice}</p>}

      <section className={styles.purpose} aria-labelledby="purpose-title">
        <h2 id="purpose-title">{t("stepPurpose")} · {t("purposeQuestion")}</h2>
        <div className={styles.purposes} role="radiogroup" aria-labelledby="purpose-title">
          {PURPOSES.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={build.purpose === p} className={styles.purposeCard} onClick={() => choosePurpose(p)}>
              <strong>{t(`purposes.${p}.name`)}</strong><span>{t(`purposes.${p}.desc`)}</span>
            </button>
          ))}
        </div>
        {build.purpose && <div className={styles.purposeNext}>
          {WORKLOADS[build.purpose].length > 0 && <div className={styles.chips} role="radiogroup" aria-label={t("workloadLabel")}>
            {WORKLOADS[build.purpose].map((w) => <button key={w} type="button" role="radio" aria-checked={build.workload === w} onClick={() => onChange({ ...build, workload: w })}>{t(`workloads.${w}`)}</button>)}
          </div>}
          <div className={styles.purposeButtons}>
            <button type="button" className={styles.primary} onClick={helpMe}>{t("helpMe")}</button>
            <button type="button" className={styles.secondary} onClick={() => { setCategory("cpu"); document.getElementById("planner-catalog")?.focus(); }}>{t("chooseMyself")}</button>
          </div>
          <p className={styles.small}>{t("suggestion")}</p>
        </div>}
      </section>

      <div className={styles.columns}>
        <section className={styles.catalog} aria-labelledby="catalog-title">
          <h2 id="catalog-title">{t("stepCatalog")}</h2>
          <div className={styles.tabs} role="tablist" aria-label={t("stepCatalog")}>
            {PLANNER_CATEGORIES.map((c) => (
              <button key={c} type="button" role="tab" aria-selected={category === c} data-highlight={highlight.includes(slotOfCategory[c]) || undefined} onClick={() => { setCategory(c); setFilter(null); }}>{catName(c)}</button>
            ))}
          </div>
          {filter && <p className={styles.filterNote}>{filter.length ? t("alternativesFor", { category: catName(category) }) : t("noAlternatives")} <button type="button" onClick={() => setFilter(null)}>✕</button></p>}
          {category === "motherboard" && <p className={styles.small}>{t("tierNote")}</p>}
          <div id="planner-catalog" tabIndex={-1} className={styles.cards} role="tabpanel" aria-label={catName(category)}>
            {list.map((e) => {
              const ids = chosenIds(plan, category);
              const inBuild = ids.includes(e.id);
              const multi = category === "storage" || category === "fans";
              const single = !multi && ids.length > 0 && !inBuild;
              const removed = withoutModel(plan, category, e.id);
              const tier = BOARD_TIER[e.id];
              return (
                <article key={e.id} className={styles.card} data-in={inBuild || undefined}>
                  <img src={`/assets/pc/thumbnails/${e.id}.svg`} alt="" width={120} height={80} loading="lazy" />
                  <div className={styles.cardBody}>
                    <span className={styles.cat}>{catName(category)}{tier && <em> · {t(`tiers.${tier}`)}</em>}</span>
                    <h3>{e.brand} {e.model}</h3>
                    <dl>{specsOf(e, t).slice(0, 4).map(([k, v]) => <div key={k}><dt>{k}</dt><dd dir="ltr">{v}</dd></div>)}</dl>
                    {inBuild && <span className={styles.inBuildNote}><CheckIcon /> {t("inBuild")}</span>}
                    <div className={styles.cardActions}>
                      <div className={styles.choice}>
                        <button type="button" className={styles.primary} disabled={inBuild && !multi} aria-label={`${single ? t("replace") : t("add")} ${nameOf(e.id)}`} onClick={() => set(withChoice(plan, category, e.id))}>{single ? t("replace") : t("add")}</button>
                        <button type="button" className={styles.remove} disabled={!removed} aria-label={`${t("removeFromBuild")} ${nameOf(e.id)}`} onClick={() => removed && set(removed)}>{t("removeFromBuild")}</button>
                      </div>
                      <button type="button" className={styles.ghost} aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? t("less") : t("more")}</button>
                    </div>
                    {open === e.id && <div className={styles.details}>
                      <p>{e.description[lang]}</p>
                      <p className={styles.small}>{t("sources")}: {e.sources.map((s, i) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.publisher}{i < e.sources.length - 1 ? sep : ""}</a>)}</p>
                    </div>}
                  </div>
                </article>
              );
            })}
          </div>
          <details className={styles.included}><summary>{t("included")}</summary><p>{t("includedItems")}</p><p>{t("colorNote")}</p></details>
        </section>

        <aside className={styles.build} aria-labelledby="build-title">
          <h2 id="build-title">{t("stepBuild")}</h2>
          <ul className={styles.slots}>
            {PLANNER_CATEGORIES.map((c) => {
              const ids = chosenIds(plan, c);
              const slot = slotOfCategory[c];
              const missing = report.missing.includes(slot);
              return (
                <li key={c} data-missing={missing || undefined} data-highlight={highlight.includes(slot) || undefined}>
                  <button type="button" className={styles.slotName} onClick={() => setCategory(c)}>{catName(c)}</button>
                  {ids.length === 0 ? <span className={styles.none}>—</span> : <div className={styles.slotParts}>
                    {ids.map((id, i) => <span key={`${id}-${i}`}>{nameOf(id)}{c === "ram" && plan.ram && <em> · {t("modules", { count: plan.ram.modules })}</em>}
                      {(c === "storage" || c === "fans") && <button type="button" aria-label={`${t("remove")} ${nameOf(id)}`} onClick={() => set(withoutChoice(plan, c, i))}>✕</button>}</span>)}
                    {c === "ram" && plan.ram && <span className={styles.qty}>
                      <button type="button" onClick={() => set({ ...plan, ram: { ...plan.ram!, modules: Math.max(2, plan.ram!.modules - 2) } })} disabled={plan.ram.modules <= 2}>{t("fewerModules")}</button>
                      <button type="button" onClick={() => set({ ...plan, ram: { ...plan.ram!, modules: plan.ram!.modules + 2 } })} disabled={plan.ram.modules >= 4}>{t("moreModules")}</button>
                    </span>}
                  </div>}
                </li>
              );
            })}
          </ul>
          {report.missing.length > 0 && <p className={styles.missing}>{t("missing", { list: report.missing.map((s) => (s === "fans" ? catName("fans") : tr(s === "cooler" ? "cooler" : s))).join(sep) })}</p>}
          {report.estimatedLoadW !== null && plan.psu && <p className={styles.small}>{t("estimate", { load: report.estimatedLoadW, psu: (byId.get(plan.psu) as { spec?: { wattageW?: number } })?.spec?.wattageW ?? 0 })}</p>}

          <h3 className={styles.findingsTitle}>{t("findings")}</h3>
          <div className={styles.robot} role="status" aria-live="polite">
            <span className={styles.face} aria-hidden="true"><i /><i /></span>
            <p>{top ? findingText(top) : said ?? (report.ready ? t("noFindings") : t("startBlocked"))}</p>
          </div>
          {top && <div className={styles.findingActions}>
            <button type="button" onClick={() => { const c = categoryOfSlot(top.slots[0]!); setCategory(c); setFilter(compatibleOptions(plan, c)); }}>{t("showAlternatives")}</button>
            <button type="button" onClick={() => setExplain(explainTopic(top.code))}>{t("explainDifference")}</button>
            <button type="button" onClick={() => setHighlight(top.slots)}>{t("reviewParts")}</button>
          </div>}
          {explain && <p className={styles.explain}>{t(`explainText.${explain}`)}</p>}
          <ul className={styles.findings}>
            {report.findings.map((f, i) => (
              <li key={`${f.code}-${i}`} data-severity={f.severity}>
                <span className={styles.badge}>{f.code === "exercise_needs_liquid" ? t("exerciseRule") : t(`severity.${f.severity}`)}</span>
                <span>{findingText(f)}</span>
              </li>
            ))}
          </ul>

          <button type="button" className={styles.start} onClick={onStart} disabled={!report.ready}>{t("start")}</button>
          {!report.ready && <p className={styles.small}>{t("startBlocked")}</p>}
          {hasProgress && <p className={styles.small}>{t("replaceKeeps")}</p>}
        </aside>
      </div>
    </section>
  );
}
