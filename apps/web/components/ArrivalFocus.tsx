"use client";

import { useEffect } from "react";
import { useReducedMotion } from "@/lib/interaction";

/**
 * After a choice that leads to a next step (a link ending in `#<id>` of that step's heading),
 * brings the step into view and puts focus on its heading, so the learner sees and hears where
 * they are now. `token` changes whenever the page's choices change. Renders nothing.
 */
export function ArrivalFocus({ ids, token }: { ids: readonly string[]; token: string }) {
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    function arrive(hash: string) {
      const id = hash.replace(/^#/, "");
      if (!ids.includes(id)) return;
      const heading = document.getElementById(id);
      if (!heading) return;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
    }

    arrive(window.location.hash);

    // Pressing the same choice again changes nothing in the address, so the effect above would not
    // run; the step is still brought back into view.
    function onClick(event: MouseEvent) {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.origin !== window.location.origin) return;
      if (link.pathname + link.search === window.location.pathname + window.location.search) arrive(link.hash);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
    // `ids` is a literal list at the call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, reducedMotion]);

  return null;
}
