"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocale } from "@/app/actions/locale";
import { useTutorTarget } from "@/lib/targets";

export function LocaleSwitch() {
  const locale = useLocale();
  const t = useTranslations("nav");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const target = locale === "ar" ? "en" : "ar";
  const ref = useTutorTarget<HTMLButtonElement>("shell:ui:locale-switch", "ui");

  return (
    <button
      ref={ref}
      type="button"
      className="locale-switch"
      lang={target}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setLocale(target);
          router.refresh();
        })
      }
    >
      {t("language")}
    </button>
  );
}
