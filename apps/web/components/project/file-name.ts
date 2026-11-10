/** `my project!.json` is not a safe download name everywhere; keep ASCII letters, digits, `-` and `_`. */
export function exportFileName(title: string, fallback = "project"): string {
  const base = title
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || fallback}.ytl.json`;
}
