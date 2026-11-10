"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { TargetLink } from "./TargetLink";

const links = [
  { href: "/pc", key: "buildPC", target: "shell:ui:nav-pc" },
  { href: "/network", key: "networks", target: "shell:ui:nav-network" },
  { href: "/projects", key: "myProjects", target: "shell:ui:nav-projects" },
] as const;

export function NavLinks() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <ul className="nav-list">
      {links.map((link) => (
        <li key={link.href}>
          <TargetLink
            targetId={link.target}
            href={link.href}
            className="nav-link"
            aria-current={pathname === link.href || pathname.startsWith(`${link.href}/`) ? "page" : undefined}
          >
            {t(link.key)}
          </TargetLink>
        </li>
      ))}
    </ul>
  );
}
