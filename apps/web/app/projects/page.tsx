import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { isLab } from "@/components/labs";
import { ProjectsList } from "@/components/ProjectsList";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: `${t("projects.title")} | ${t("site.name")}`, description: t("projects.intro") };
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("projects");
  const { lab } = await searchParams;
  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-heading">{t("title")}</h1>
        <p className="page-kicker">{t("subtitle")}</p>
        <p className="page-lead">{t("intro")}</p>
      </header>
      <ProjectsList lab={isLab(lab) ? lab : null} />
    </div>
  );
}
