// Every published lesson. Order is the order shown to learners. Worked examples are in
// ./examples.ts, which pages must not import.
import type { Lesson } from "@ytl/curriculum";
import { gatewayChallenge, homeLesson, wrongGatewayFault } from "./network/home";
import { buildChallenge, firstBuild, memoryFault } from "./pc/build";

export const lessons: readonly Lesson[] = [firstBuild, buildChallenge, memoryFault, homeLesson, gatewayChallenge, wrongGatewayFault];

export const lessonById = (id: string): Lesson | undefined => lessons.find((lesson) => lesson.id === id);
