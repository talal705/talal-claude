import type { Metadata } from "next";
import { Inter, IBM_Plex_Sans_Arabic } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteTutor } from "@/components/SiteTutor";
import { directionOf, type Locale } from "@/lib/i18n/config";
import { isTutorAiConfigured } from "@/lib/server/tutor/anthropic";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("site");
  return { title: t("name"), description: t("tagline") };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("common");
  return (
    <html lang={locale} dir={directionOf(locale)} className={`${inter.variable} ${plexArabic.variable}`}>
      <body>
        <NextIntlClientProvider>
          <a href="#main" className="skip-link">
            {t("skipToContent")}
          </a>
          <SiteHeader />
          <main id="main">{children}</main>
          {/* Read from the server environment on each request; the layout is dynamic (it reads the locale cookie). */}
          <SiteTutor aiConfigured={isTutorAiConfigured()} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
