# Curriculum map

Status on 2026-10-15; counts reconciled on 2026-10-31. First written by the retired `interaction` teammate; the content is now owned by `engineer`, this document by the lead.
The brief (section 5) asks for four levels per lab and per programming track, each with measurable
outcomes, prerequisites, complete lessons, worked examples, practice exercises, fault exercises and
a capstone. This page records what exists against that. **Most of it does not exist yet.** One
beginner lesson per lab is a start, not a level, and a level is not a track.

## What counts as published

A lesson is counted only when all of this is true, and `packages/curriculum/src/lessons.test.ts`
checks it for every lesson in `content/lessons/index.ts`:

- English and Arabic text for every field (the Arabic is checked to be Arabic, not a copy of the English).
- A measurable outcome, ordered steps, three hints per task, an explanation per task, and a
  labelled completion condition (the rubric).
- A completion condition decided by the lab itself: the PC engine or the network engine.
- A worked example that completes the lesson through the lesson runner, and a check that the
  starting state does not already pass each step.
- No condition mixes a question with a lab check (needed for server re-checking).

## Counts

Reconciled by the lead on 2026-10-31 against `content/lessons/index.ts` after the scope change of
2026-10-27 (decision 8 removed Code Studio and its programming lessons; decision 9 made the PC lab
start from a disassembled workbench, so the earlier memory-slot lesson and challenge were replaced).

| Lab | Beginner | Intermediate | Advanced | Expert |
|---|---|---|---|---|
| PC lab | 1 lesson, 1 challenge, 1 fault exercise | none | none | none |
| Network lab | 1 lesson, 1 challenge, 1 fault exercise | none | none | none |

Totals: 6 published items (2 lessons, 2 challenges, 2 fault exercises) across the 2 labs, all at
Beginner. 0 capstones. No level is complete: a complete level needs several lessons covering its
outcomes, practice, fault exercises and a capstone.

## Published items

| ID | Kind | Steps | What the learner can do afterwards |
|---|---|---|---|
| `pc.beginner.first-build` | lesson | 8 (board, CPU, BIOS, memory, cooler, other parts, cables, power on) | Build Starter B (Core i7, DDR5, liquid cooler) from loose parts on the workbench to a running computer, without a monitor |
| `pc.beginner.build-challenge` | challenge | 1 | Without guidance, build Starter A (Core i5, DDR4, air cooler) from the workbench to a running computer, including the BIOS update the processor needs |
| `pc.beginner.memory-fault` | fault | 2 | From "power, but the self-test stops", name a half-seated memory module and repair it |
| `network.beginner.first-home-network` | lesson | 4 (follow-up on step 2) | Cable provider, ONT, router and computer so the computer gets a DHCP address and reaches a name |
| `network.beginner.gateway-challenge` | challenge | 1 | Without guidance, connect an integrated fibre gateway and join a Wi-Fi client that reaches a name |
| `network.beginner.wrong-gateway-fault` | fault | 2 | From "home works, the internet does not", name a wrong gateway and correct it |

Order and links: each lesson names its prerequisites and the next item; the lesson leads to its
challenge, the challenge to its fault exercise.

## What the curriculum machinery does

- `packages/curriculum`: the lesson contract, pure checkers, and the lesson runner (prediction,
  attempt, rubric, explanation, a related follow-up after a corrected error, session summary). Test
  mode uses the same checkers and withholds the third hint, the explanation and the example until an
  attempt has been submitted. Hints used are recorded per step as a count; the summary has no score.
- Progress is stored per lesson and mode in the guest store (`getLessonProgressStore()`); a stored run resumes where it was, and a run for an older lesson version starts over.
- A finished PC or network lesson can be re-checked on the server by replaying the learner's
  actions (`apps/web/lib/server/progress/verify.ts`).

## Baseline checks

`content/lessons/baselines.ts`: three questions each for the PC lab and the network lab, every question tied to a skill of the lesson that teaches it. "I don't know" is always an
answer and there is no score. The result names the skills shown and the skills to learn, and
suggests one place to start: the lesson for the first skill to learn, or the level's challenge when
everything was known. With only Beginner content the suggestion can only be one of those two.
Tested in `packages/curriculum/src/baseline.test.ts`.

## Not built yet

- "Show me an example" as a demonstrated action on the learner's project; today it is a short text.
- Capstones for any level.
- Every Intermediate, Advanced and Expert item in every lab and track.
- Browser evidence: the network lessons and the starting check are covered by
  `npm run check:browser:lessons-labs`; the new PC lesson was completed 8/8 in the S3 review
  (`docs/PROGRESS.md`), but `scripts/browser-check-lesson.mjs` still drives the replaced memory-slot
  lesson and must be rewritten.

## Planned shape of a level (not yet written)

For each lab and track a level is proposed to hold about five lessons, five challenges, three
fault exercises and one capstone, with outcomes listed before any lesson is written. Proposed
Beginner outcomes still to cover, in words only, with no lessons yet: PC — choosing a compatible
processor and board, power cables, storage and boot order; Network — addresses and masks by hand,
switches and access points, the Ethernet plug exercise, DNS. These are plans, not curriculum, and are not counted above.
