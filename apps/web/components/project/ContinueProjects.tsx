"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { ProjectSummary } from "@ytl/contracts";
import { getGuestProjectStore } from "@/lib/storage";
import { labHref, type ActiveLab } from "../labs";

const SHOWN = 3;

/**
 * "Continue: <title>" for the lab's most recent saved projects, as the first action of the start
 * panel. Renders nothing while loading, when there are none, or when storage cannot be read: the
 * create form below is always there.
 */
export function ContinueProjects({ lab }: { lab: ActiveLab }) {
  const t = useTranslations("labPage.continue");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    let current = true;
    getGuestProjectStore()
      .list({ lab })
      .then(
        (result) => {
          if (current) setProjects([...result.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        },
        () => {},
      );
    return () => {
      current = false;
    };
  }, [lab]);

  if (projects.length === 0) return null;

  return (
    <div className="continue">
      <h3 className="subheading">{t("heading")}</h3>
      <ul className="button-row">
        {projects.slice(0, SHOWN).map((project, index) => (
          <li key={project.id}>
            <Link href={labHref(lab, { mode: project.mode, project: project.id })} className={`button${index === 0 ? " button-primary" : ""}`}>
              {/* The title is the learner's own text and may be in either direction. */}
              {t.rich("item", { title: () => <bdi>{project.title.trim() || t("untitled")}</bdi> })}
            </Link>
          </li>
        ))}
      </ul>
      {projects.length > SHOWN && (
        <Link href={`/projects?lab=${lab}`} className="text-link">
          {t("all", { count: projects.length })}
        </Link>
      )}
      <p className="settings-hint">{t("orNew")}</p>
    </div>
  );
}
