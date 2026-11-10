import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrivalFocus } from "./ArrivalFocus";
import { CheckIcon } from "./icons";
import { ENTRIES, MODES, isEntry, isMode, labHref, modeLabelKey, type ActiveLab } from "./labs";
import { NetworkStarter } from "./network/NetworkStarter";
import { NetworkWorkspace } from "./network/NetworkWorkspace";
import { PcStarter } from "./pc/PcStarter";
import { PcWorkspace } from "./pc/PcWorkspace";
import { TargetLink } from "./TargetLink";

export type LabSearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function labMetadata(lab: ActiveLab) {
  const t = await getTranslations();
  return { title: `${t(`labs.${lab}.title`)} | ${t("site.name")}`, description: t(`labs.${lab}.description`) };
}

export async function LabPage({ lab, searchParams }: { lab: ActiveLab; searchParams: LabSearchParams }) {
  const t = await getTranslations();
  const query = await searchParams;
  const start = isEntry(query.start) ? query.start : null;
  const mode = isMode(query.mode) ? query.mode : null;
  // Every lab has a workspace; a chosen mode leads to its start panel.
  const studio = mode;
  const projectId = studio && typeof query.project === "string" && query.project.length <= 100 ? query.project : null;
  const lessonId = typeof query.lesson === "string" && query.lesson.length <= 200 ? query.lesson : null;
  const selected = (
    <span className="choice-mark">
      <CheckIcon />
      {t("labPage.selected")}
    </span>
  );

  // With a project open the page is the workspace: the scene and the entry choices step aside.
  if (studio && projectId) {
    return (
      <div className="page page-wide">
        <header className="page-header page-header-compact">
          <h1 className="page-heading">{t(`labs.${lab}.title`)}</h1>
          <p className="page-kicker">{t(`modes.${modeLabelKey(mode)}`)}</p>
        </header>
        {lab === "pc" ? (
          <PcWorkspace projectId={projectId} mode={mode} start={start} lessonId={lessonId} />
        ) : (
          <NetworkWorkspace projectId={projectId} mode={mode} start={start} lessonId={lessonId} />
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-heading">{t(`labs.${lab}.title`)}</h1>
        <p className="page-lead">{t(`labs.${lab}.description`)}</p>
      </header>

      <ArrivalFocus ids={["workspace-heading", "guided-heading"]} token={`${start}|${mode}`} />

      <section aria-labelledby="entry-heading" className="choice-section">
        <h2 id="entry-heading" className="section-heading">
          <span className="step-number">{t("labPage.steps.entry")}</span>
          {t("labPage.entryHeading")}
        </h2>
        <p className="step-cue">{t("labPage.entryCue")}</p>
        <ul className="choice-grid choice-grid-two">
          {ENTRIES.map((entry) => (
            <li key={entry.start}>
              <TargetLink
                targetId={`${lab}:ui:${entry.target}`}
                // "I know what I want" goes straight toward working: Free Lab unless another mode is
                // already chosen, and on to the start panel. "Help me start" goes to the plan.
                href={
                  entry.start === "direct"
                    ? `${labHref(lab, { start: "direct", mode: mode ?? "free" })}#workspace-heading`
                    : `${labHref(lab, { start: "guided", mode })}#guided-heading`
                }
                scroll={false}
                className="choice"
                aria-current={start === entry.start ? "true" : undefined}
              >
                <span className="choice-title">{t(`entry.${entry.labelKey}`)}</span>
                <span className="choice-desc">{t(`entry.${entry.labelKey}Description`)}</span>
                {start === entry.start && selected}
              </TargetLink>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="mode-heading" className="choice-section">
        <h2 id="mode-heading" className="section-heading">
          {t("labPage.modeHeading")}
        </h2>
        <p className="step-cue">{start === "direct" && mode === "free" ? t("labPage.modeAuto") : t("labPage.modeCue")}</p>
        <ul className="choice-grid">
          {MODES.map((item) => (
            <li key={item.mode}>
              <TargetLink
                targetId={`${lab}:ui:mode-${item.mode}`}
                href={`${labHref(lab, { start, mode: item.mode })}#workspace-heading`}
                scroll={false}
                className="choice"
                aria-current={mode === item.mode ? "true" : undefined}
              >
                <span className="choice-title">{t(`modes.${item.labelKey}`)}</span>
                <span className="choice-desc">{t(`modeDescriptions.${item.mode}`)}</span>
                {mode === item.mode && selected}
              </TargetLink>
            </li>
          ))}
        </ul>
      </section>

      <div className="lab-status">
        {start === "guided" && (
          <section aria-labelledby="guided-heading" className="panel">
            <h2 id="guided-heading" tabIndex={-1} className="section-heading">
              <span className="step-number">{t("labPage.steps.plan")}</span>
              {t("labPage.guided.heading")}
            </h2>
            <dl className="plan">
              <div>
                <dt>{t("labPage.guided.goal")}</dt>
                <dd>{t(`labPage.guided.goals.${lab}`)}</dd>
              </div>
              <div>
                <dt>{t("labPage.guided.startingPoint")}</dt>
                <dd>{t(`labPage.guided.starts.${lab}`)}</dd>
              </div>
              <div>
                <dt>{t("labPage.guided.nextAction")}</dt>
                <dd>
                  {t(`labPage.guided.next.${mode ?? "none"}`)}
                  {/* The plan ends in one action that leads to the start panel. */}
                  <Link
                    href={`${labHref(lab, { start, mode: mode ?? "learn" })}#workspace-heading`}
                    scroll={false}
                    className="button button-primary plan-action"
                  >
                    {mode ? t("labPage.guidedGo.next") : t("labPage.guidedGo.learn")}
                  </Link>
                </dd>
              </div>
            </dl>
          </section>
        )}

      </div>

      {studio &&
        (lab === "pc" ? (
          <PcStarter mode={mode} start={start} />
        ) : (
          <NetworkStarter mode={mode} start={start} />
        ))}

      <p className="page-links">
        <Link href={`/projects?lab=${lab}`} className="text-link">
          {t("labPage.projectsLink")}
        </Link>
        {(start || mode) && (
          <Link href={labHref(lab)} scroll={false} className="text-link">
            {t("labPage.clear")}
          </Link>
        )}
      </p>
    </div>
  );
}
