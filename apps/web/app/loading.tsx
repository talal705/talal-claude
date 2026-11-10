import { useTranslations } from "next-intl";

export default function Loading() {
  const t = useTranslations("common");
  return (
    <div className="page">
      <p className="state-panel" role="status">
        <span className="spinner" aria-hidden="true" />
        {t("loading")}
      </p>
    </div>
  );
}
