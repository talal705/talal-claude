import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, defaultLocale, isLocale } from "./config";

// Each module owns one file per locale; top-level keys must not collide across files.
const MODULES = ["core", "labs", "tutor"] as const;

export default getRequestConfig(async () => {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : defaultLocale;
  const parts = await Promise.all(
    MODULES.map(async (name) => (await import(`../../messages/${locale}/${name}.json`)).default),
  );
  return { locale, messages: Object.assign({}, ...parts) };
});
