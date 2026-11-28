# Phase 1 (CPU): interaction log — 2026-11-19

Branch `phase1-cpu-direct`, commits bb4fd7f and 2d29b23. Production (main) is unchanged.

**Browser:** a local production build (`next build` then `next start`), Chrome with Playwright, Arabic UI. The page uses the planner's gaming build: TUF GAMING Z790-PLUS WIFI with a Core i5-14600K, LGA1700. Mouse clicks and drags were sent at the real screen positions of the lever, the plate and the held CPU, read from the scene's camera.

## Install (cpu-direct.mjs, 14/14 PASS)

**Socket closed**
- Enter pressed in the view to lower the CPU → refused: «ارفع ذراع المقبس أول.»
- Plate clicked before the lever → refused, with the same message.

**Opening the socket**
- Lever clicked in the view → `mech:cpu-socket-plate:lever:open`. The lever turns up about its pivot.
- Plate clicked in the view → `mech:cpu-socket-plate:open`. The plate swings up about its hinge.

**Aligning the CPU**
- Drag: the CPU starts 36.7 mm off the socket. After the drag it is offset [3.5, 3] mm, i.e. 4.6 mm.
- Enter while the CPU is still turned 90° → refused: «لفّ المعالج لين تتطابق علامة المثلث مع علامة المقبس.»
- Q turns it to 0°, then the arrows centre it → offset [0.5, 0], saved.

**Reload**
- The held angle and offset come back exactly as they were.
- The lever and plate states come back too.

**Seating and closing**
- Enter → `lower:cpu`: «نزل مسطّح في المقبس. سكّر الغطا، وبعدين ثبّت الذراع.»
- Lever clicked while the plate is up → refused: «سكّر الغطا أول، وبعدين ثبّت الذراع تحت مشبكه.»
- Plate, then lever → CPU installed: «تثبّت. غطا الحماية طاح: احتفظ فيه.»
- Undo → the lever is up again and the CPU no longer counts as installed.

No page errors.

## Removal and blocking (cpu-remove.mjs, 7/7 PASS)

- Cooler mounted, lever clicked → nothing moves: «المبرّد فوقه. شيل المبرّد أول.»
- Plate clicked while the lever is locked → nothing moves, and no lift-out button is offered.
- Lever, then plate clicked in the view → `lift:cpu`. The CPU is back in hand with its pose saved.

No page errors.

## Unit tests

882 pass (94 skipped). The engine is checked on three sockets:

- **LGA1700**, ASUS TUF GAMING Z790-PLUS WIFI:
  - closed socket, wrong rotation and off-centre are refused;
  - the lever comes before the plate, the plate before the lever lock, and the lever lock is refused while the plate is up;
  - the cover pops off only over a seated CPU;
  - removal sequence, and the cooler blocking the socket.
- **LGA1150**, ASUS H81M-K with a Core i5-4590: the same lever-then-plate sequence.
- **AM4**, ASUS TUF GAMING B550-PLUS with a Ryzen 5 5600 (archived, not offered in the planner):
  - ZIF lever and triangle keying;
  - the lever cannot be lowered over a CPU that is not seated;
  - removal needs the lever up.

Simple model:
- strict lever and plate steps;
- an older save is read with the lever as its own step;
- a held pose survives a save, and impossible poses are refused;
- undo and replay.
