# Guided PC build: robot guide, targets and animation states

This note is for whoever maintains the guided PC page (`/` last section, and `/pc`). It explains how the
robot guide knows where to point, and how its moods and motion are tied to the simulation. Nothing in
the guide decides what is allowed: every rule stays in the PC engine and `simple-model.ts`.

## Data flow

```
learner action ─► SimplePcLab (snapshot, selection, guided flag)
                     │
                     ├─► simple-model.ts   build state, slots, blocks, swaps, lab rule, startup
                     ├─► companion.ts      the words: one CompanionSay per event (EN/AR messages)
                     └─► guide.ts          guideFocus(): what the robot points at (pure, tested)
                              │
                              ▼
                     PcScene (3D) ─► GuideRobot.tsx   targetPoint() → hoverPoint() → animation
```

* **Words** come from `companion.ts`. Each learner event (`select`, `installed`, `powerFail`, `swapped`…)
  maps to message keys under `simplePc.companion` in `messages/{en,ar}/labs.json`. The Arabic text is
  written there, short and beginner-friendly; the optional AI tutor is only asked for free questions,
  through the existing server route, and never for targets or validity.
* **Targets** come from `guide.ts → guideFocus(state, selection, powered, guided)`:

  | Situation | `reason` | Target |
  |---|---|---|
  | Part in hand, can go in now | `place` | its mount (`simpleTarget`), plus the radiator place for the liquid cooler |
  | Part in hand, blocked | `prerequisite` | the first earlier part that can go in now (chain of `simplePrerequisites` / `simpleBlock`) |
  | Other CPU/cooler is in | `prerequisite` | the lead to unplug, the cooler to take off, or the part to swap |
  | Lead in hand | `place` / `prerequisite` | its port, or the part it waits for |
  | Nothing in hand, after a selection or "Help" / "What next?" | `next` | next step from `nextAction()`: part on the bench, a lead's port, or the power button |
  | Running and complete | `celebrate` | beside the case |

  `guided` becomes true on the first selection or question, so after each install or connection the
  robot moves on to the next step by itself until the PC runs. It never installs anything.
* **Scene positions** come from the same frames the scene draws with (`GuideRobot.tsx → targetPoint`):
  a mount is `host frame × mount frame`, a port is `host frame × port.at`, a part on the bench is the
  centre of its placed box, the power button is the case's top front (as `controls3d.ts` places it).
* **Where the robot hovers** (`hoverPoint`): candidate points around the target (outside the case's glass
  side when the target is inside the case); the first acceptable by score wins. A candidate is rejected
  when it is inside any part's solid box, inside or above the case, below the table, or on the line from
  the camera to the target (so it never covers what it points at). It re-chooses once the learner stops
  turning the view; it never moves the camera. A move whose straight path would cross the case is a
  quick shrink-and-reappear instead of a flight.

## Highlights

* `place`: the scene's own glowing target (`SimpleTargets`) shows the exact slot or port; the robot adds a
  dotted line from its fingertip.
* `prerequisite` (amber) and `next` (cyan): a breathing ring around the target and the dotted line. Rings
  sit around a target, never on it.

## Animation states

| Robot | Where | States |
|---|---|---|
| Speech-bubble robot | `BuildCompanion.tsx` + `companion.module.css` | `data-mood`: `idle` (float, look around, blink), `wave`, `point` (`data-point`: scene / parts / cables / power), `happy`, `concerned`, `thinking`, `celebrate` |
| 3D guide | `GuideRobot.tsx` | hidden → appears at its spot; flies between spots; turns toward the viewer and a third toward the target; the arm on the target's side points; head tilts to it; `celebrate`: hop, turn, both arms up |

Moods come from `CompanionSay.mood`; the 3D state from `GuideFocus.reason`.

## Motion and options

* View options under the 3D view, saved in `localStorage["ytl_simple_pc_view_v1"]` (separate from the build's
  own progress): **Robot guide** (on), **Guide motion** (on), and RGB lighting (off; see the RGB section when present).
* Reduced motion (site setting or the operating system) and "Guide motion" off: the 3D robot appears at its
  spot without flying, bobbing, blinking or breathing rings; the bubble robot stops its CSS animations.

## Tests

`guide.test.ts` (targets for both builds, prerequisites, swaps, cables, power, celebration),
`scene/liquid-cooler.test.ts`, `simple-model.test.ts`, `companion.test.ts`.
