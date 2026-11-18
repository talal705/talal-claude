# PC planner, compatibility and assembly modes

`/pc` opens on the planner: purpose → parts → My Build → assembly of exactly that build.
The earlier fixed practice build (i5/i9, air/280 AIO) is kept as the *legacy model*; its saves
(`ytl_simple_pc_v1`, versions 1–3) still restore, from "Continue the earlier practice build".

## Pieces

| File | Role |
| --- | --- |
| `packages/simulation/src/pc/plan.ts` | `checkPlan`: fits every planned part with the assembly engine; findings are `incompatible`, `conditional` or `less_suitable`. |
| `apps/web/components/pc/plan-model.ts` | Assembly model of a plan (mounts, screws, leads from the catalog); `rebaseProgress` keeps steps a replacement does not affect. |
| `apps/web/components/pc/simple-model.ts` | Model-driven guided assembly (`activateSimpleModel`). |
| `apps/web/components/pc/planner-data.ts` | Offered parts, board tiers, suggestions per purpose (each tested to assemble and start). |
| `BuildPlanner.tsx`, `PcBuilder.tsx` | Planner UI and phase/persistence (`ytl_pc_plan_v1`, progress `ytl_pc_plan_progress_v1`, snapshot v4). |
| `faults.ts`, `PowerDiagnostics.tsx`, `substeps.ts` | Find-the-fault mode, stage-by-stage power panel and firmware summary, physical sub-steps. |

## Rules

- Never a finding: colour, cable colour, brand, being in a suggestion, or a PSU larger than needed.
- Power is a teaching estimate: CPU max power + card TGP + 50 W.
- The Core i9-14900K liquid-cooler requirement is this lab's **exercise rule** (shown as such), not a manufacturer rule.
- BIOS: boards whose BIOS history was not read carry version `unrecorded`; the planner reports
  "BIOS support not confirmed" (conditional) instead of inventing a version.

## Added catalog entries (sources on each entry, read 2026-11-18)

| Entry | Source |
| --- | --- |
| Intel Core i5-4590 (LGA1150, DDR3) | intel.com ARK specifications |
| ASUS H81M-K (micro-ATX, 2 × DDR3, 4-pin ATX12V, 1 chassis fan) | asus.com tech specs + ASUS manual E8601 |
| Corsair Vengeance LP 16GB DDR3-1600 (CML16GX3M2A1600C10) | Corsair SKU sheet (retailer-hosted copy) |
| ASUS PRIME B760M-A WIFI (micro-ATX, DDR5, no AIO_PUMP) | asus.com tech specs |
| ASUS Dual RTX 5060 8GB OC (DUAL-RTX5060-O8G) | asus.com tech specs; NVIDIA RTX 5060 family specs |
| Seagate BarraCuda 2TB 3.5" (ST2000DM008) | Seagate data sheet DS1900.14 |
| Fractal Design Pop Mini Air RGB TG | fractal-design.com specifications |
| Corsair 7000D AIRFLOW | corsair.com tech specs + Corsair case comparison |
| ARCTIC P14 PWM PST | arctic.de specifications |
| ARCTIC Freezer 7 X (mounts LGA115X incl. 1150) | arctic.de specifications |
| Corsair RM650e (2025) | corsair.com tech specs and cable listing |
| Corsair RM1200x SHIFT | corsair.com tech specs and cable listing |

Unverified fields are listed in each entry's `unverifiedFields`.

## Known limitations

- Lane sharing (M.2 vs SATA ports) is not modelled; no finding is produced for it.
- Fitted case fans of the Pop Mini Air and 7000D are not modelled as parts.
- The 7000D model draws 2 + 2 drive bays and 240–360 mm radiator positions (Corsair lists more).
- Sub-steps are ticked in order as buttons; there is no drag-and-drop and no per-sub-step 3D animation.
- Cable routing detail is unchanged: modular cables connect both ends in one learner step.
- 3D side-panel glass and hose routing are tuned for the 4000D; other cases render without them.
