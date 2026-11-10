"use client";

import { TutorRoot } from "./tutor";

export function SiteTutor({ aiConfigured }: { aiConfigured: boolean }) {
  return <TutorRoot aiConfigured={aiConfigured} />;
}
