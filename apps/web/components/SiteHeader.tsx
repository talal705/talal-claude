"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { LocaleSwitch } from "./LocaleSwitch";
import { NavLinks } from "./NavLinks";
import { SettingsDialog } from "./SettingsDialog";

export function SiteHeader() {
  const t = useTranslations();
  const path = usePathname();
  const simple = path === "/" || path === "/pc";
  const arabic = useLocale() === "ar";
  return (
    <header className="site-header" style={simple ? { justifyContent: "space-between" } : undefined}>
      <Link href="/" className="site-name">
        {t("site.name")}
      </Link>
      {!simple && <nav aria-label={t("nav.primary")}><NavLinks /></nav>}
      {path === "/" && <nav aria-label={t("nav.primary")}><ul className="nav-list"><li><Link className="nav-link" href="#welcome">{arabic ? "البداية" : "Home"}</Link></li><li><Link className="nav-link" href="#programming">{arabic ? "البرمجة" : "Code"}</Link></li><li><Link className="nav-link" href="#pc-builder">{arabic ? "تجميع الكمبيوتر" : "Build a PC"}</Link></li></ul></nav>}
      <div className="header-actions">
        <SettingsDialog />
        <LocaleSwitch />
      </div>
    </header>
  );
}
