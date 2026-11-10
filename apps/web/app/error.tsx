"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { WarningIcon } from "@/components/icons";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="page">
      <div className="state-panel state-panel-block" role="alert">
        <h1 className="page-heading state-heading">
          <WarningIcon />
          {t("states.error.heading")}
        </h1>
        <p className="page-lead">{t("states.error.body")}</p>
        {error.digest && (
          <p className="state-meta">
            {t("states.error.reference")}: <code dir="ltr">{error.digest}</code>
          </p>
        )}
        <div className="button-row">
          <button type="button" className="button button-primary" onClick={() => retry()}>
            {t("common.retry")}
          </button>
          <Link href="/" className="button">
            {t("states.notFound.home")}
          </Link>
        </div>
      </div>
    </div>
  );
}
