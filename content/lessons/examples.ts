// A worked solution for every published lesson, used by the lesson tests. Not for pages.
import type { LessonExample } from "@ytl/curriculum";
import { gatewayChallengeExample, homeLessonExample, wrongGatewayFaultExample } from "./network/home";
import { buildChallengeExample, firstBuildExample, memoryFaultExample } from "./pc/build";

export const lessonExamples: readonly LessonExample[] = [
  firstBuildExample,
  buildChallengeExample,
  memoryFaultExample,
  homeLessonExample,
  gatewayChallengeExample,
  wrongGatewayFaultExample,
];
