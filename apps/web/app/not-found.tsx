import Link from "next/link";
import { useTranslations } from "next-intl";

export default function NotFound() {
  const t = useTranslations("states.notFound");
  return (
    <div className="page">
      <div className="state-panel state-panel-block">
        <h1 className="page-heading">{t("heading")}</h1>
        <p className="page-lead">{t("body")}</p>
        <Link href="/" className="button">
          {t("home")}
        </Link>
      </div>
    </div>
  );
}
