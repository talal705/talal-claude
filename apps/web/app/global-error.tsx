"use client";

// Replaces the root layout when it fails, so there is no locale or message provider here:
// the fallback shows both languages.
import { useEffect } from "react";
import "./globals.css";

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" dir="ltr">
      <body>
        <title>Your Tech Lab</title>
        <main className="page">
          <div className="state-panel state-panel-block" role="alert">
            <h1 className="page-heading">Something went wrong</h1>
            <p className="page-lead">The page could not be shown. Your saved projects were not touched.</p>
            <button type="button" className="button button-primary" onClick={() => retry()}>
              Try again
            </button>
            <div lang="ar" dir="rtl" className="state-panel-block global-error-ar">
              <h2 className="page-heading">صار خطأ</h2>
              <p className="page-lead">ما قدرنا نعرض الصفحة. مشاريعك المحفوظة ما انلمست.</p>
              <button type="button" className="button button-primary" onClick={() => retry()}>
                جرّب مرة ثانية
              </button>
            </div>
            {error.digest && (
              <p className="state-meta">
                <code>{error.digest}</code>
              </p>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}
