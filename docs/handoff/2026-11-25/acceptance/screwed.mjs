// Stages 6, 7 and 9 in the real page: the power supply (no board needed, vent-aware fan direction), a 3.5-inch and a
// 2.5-inch SATA drive in bays the learner chooses, a case fan at a chosen place with its airflow, one screw per click,
// removal one screw at a time, reload, undo. Usage: node screwed.mjs <base url> <en|ar> [width]
import { open, finish, ok } from "./lib.mjs";

const lang = process.argv[3] ?? "en";
const width = Number(process.argv[4] ?? 1440);
const plan = {
  case: "corsair-4000d-airflow-black", motherboard: "asus-tuf-gaming-z790-plus-wifi", cpu: "intel-core-i5-14600k", cooler: "arctic-freezer-36", psu: "corsair-rm850x-atx31",
  gpu: "asus-dual-rtx5060-o8g", ram: { id: "corsair-vengeance-rgb-ddr5-6000-32gb-kit", modules: 2 },
  storage: ["samsung-990-pro-1tb", "seagate-barracuda-2tb-st2000dm008", "samsung-870-evo-1tb"], fans: ["arctic-p12-pwm-pst"],
};
const h = await open({ plan, lang, width });
const { m, press, state, button, select, cam, lab } = h;
const said = async () => (await h.robot()).join(",");
let cam0 = await cam();
const group = (title) => lab.getByRole("group", { name: title });
const bay = (re) => group(m.hands.positionTitle.storage).getByRole("button", { name: re });
const fanPlace = (re) => group(m.hands.positionTitle.fan).getByRole("button", { name: re });
const screw = () => press(button(h.msg("hands.nextScrew")));

// ---------- Stage 6: power supply ----------
await select(/RM850x/i);
ok("the power supply is selectable with no board in the case (no 'board first' block)", !(await said()).includes("boardFirst"), await said());
ok("the filtered-vent advice (fan down) is shown before choosing", (await lab.getByText(m.hands.advice.psuDown).count()) === 1);
await press(button(h.msg("hands.place.psu")));
let s = await state();
ok("placing without a fan direction is refused by the engine (nothing placed)", !s.history.includes("place:psu") && (await said()).includes("hands.engine"), JSON.stringify(s.history.slice(-3)));
await press(button(h.msg("hands.psuFanUp")));
await press(button(h.msg("hands.place.psu")));
s = await state();
ok("fan up also fits over the vent: the supply is placed (advice, not a prohibition), not yet screwed", s.history.at(-1) === "place:psu" && !s.placed.includes("motherboard"), JSON.stringify(s.history.slice(-3)));
const before = s.history.length;
await screw();
s = await state();
ok("one click = one screw", s.history.length === before + 1 && s.history.at(-1).startsWith("screw:psu:"), JSON.stringify(s.history.slice(-2)));
await screw(); await screw(); await screw();
s = await state();
ok("four screws, then the supply is installed", s.history.filter((x) => x.startsWith("screw:psu:")).length === 4 && s.placed.includes("psu"), JSON.stringify(s.history.slice(-5)));
await h.shot("psu-installed");

// ---------- Stage 7: SATA drives ----------
await select(/Barracuda|ST2000/i);
await press(bay(h.ar ? /صينية قرص 2\.5 بوصة 1/ : /2\.5-inch SSD tray 1/));
ok("a 3.5-inch drive refused in a 2.5-inch-only tray with a spoken reason", (await said()).includes("positionWrong") && !(await state()).history.some((x) => x.startsWith("place:storage2")), await said());
await press(bay(h.ar ? /صينية قرص 3\.5 بوصة 1/ : /3\.5-inch drive tray 1/));
await press(button(h.msg("hands.place.storage")));
s = await state();
ok("the chosen bay is recorded with the place step", s.history.includes("place:storage2@drive-35-1"), JSON.stringify(s.history.slice(-2)));
for (let i = 0; i < 4; i += 1) await screw();
s = await state();
ok("the drive is installed after its four screws, one per click", s.placed.includes("storage2") && s.history.filter((x) => x.startsWith("screw:storage2:")).length === 4, JSON.stringify(s.history.slice(-5)));

// A second drive: the taken bay is refused, another is fine.
await select(/870/i);
await press(bay(h.ar ? /صينية قرص 3\.5 بوصة 1/ : /3\.5-inch drive tray 1/));
ok("a taken bay is refused with its reason", (await said()).includes("positionTaken") && !(await state()).history.some((x) => x.startsWith("place:storage3")), await said());
await press(bay(h.ar ? /صينية قرص 2\.5 بوصة 2/ : /2\.5-inch SSD tray 2/));
await press(button(h.msg("hands.place.storage")));
s = await state();
ok("the 2.5-inch drive goes into its own tray", s.history.includes("place:storage3@drive-25-2"), JSON.stringify(s.history.slice(-2)));
await screw(); await screw();
await h.reload();
cam0 = await cam(); // a reload fits the build once again; what must not move the camera is the work after it
s = await state();
ok("after a reload the drive is still half screwed in its tray", s.history.filter((x) => x.startsWith("screw:storage3:")).length === 2 && s.history.includes("place:storage3@drive-25-2"), JSON.stringify(s.history.slice(-4)));
await select(/870/i);
await screw(); await screw();
s = await state();
ok("it finishes with the remaining two screws and is put down", s.history.filter((x) => x.startsWith("screw:storage3:")).length === 4 && s.selection === null, JSON.stringify([s.history.slice(-3), s.selection]));

// ---------- Removal: one screw per click, then lift; undo is a separate path ----------
await select(/870/i);
if (process.env.DEBUG) console.log(await lab.locator("details").first().innerText(), JSON.stringify((await state()).selection));
for (let i = 0; i < 4; i += 1) await press(button(h.msg("hands.unscrewNext")));
s = await state();
ok("four clicks take the four screws out, one each", s.history.filter((x) => x === "unscrew:storage3").length === 4 && !s.history.includes("lift:storage3"), JSON.stringify(s.history.slice(-5)));
await press(button(h.msg("hands.liftOutOf.storage")));
s = await state();
ok("then it lifts out and the other drive stays in", s.history.at(-1) === "lift:storage3" && !s.placed.includes("storage3") && s.placed.includes("storage2"), JSON.stringify(s.placed));
await press(button(h.msg("undo")));
s = await state();
ok("undo reverses one step: the lift", !s.history.includes("lift:storage3") && s.history.at(-1) === "unscrew:storage3", JSON.stringify(s.history.slice(-2)));

// ---------- Stage 9: a case fan at a chosen place, with its airflow ----------
await select(/P12/i);
await press(fanPlace(h.ar ? /علوية رقم 1/ : /Top fan position 1/));
ok("the usual direction for a top place is advised (exhaust), not imposed", (await lab.getByText(m.hands.advice.exhaust).count()) === 1);
await press(button(h.msg("hands.place.fan")));
s = await state();
ok("placing without an airflow choice is refused by the engine", !s.history.some((x) => x.startsWith("place:fan1")) && (await said()).includes("hands.engine"), JSON.stringify(s.history.slice(-2)));
await press(fanPlace(h.ar ? /أمامية رقم 1/ : /Front fan position 1/));
ok("a place holding the case's own fan is refused", (await said()).includes("positionTaken"), await said());
await press(fanPlace(h.ar ? /علوية رقم 1/ : /Top fan position 1/));
await press(button(h.msg("hands.fanIntake")));
await press(button(h.msg("hands.place.fan")));
for (let i = 0; i < 4; i += 1) await screw();
s = await state();
ok("the fan is installed at the place chosen, turned the way the learner chose (intake at a top place also fits)", s.history.includes("place:fan1@fan-top-1") && s.placed.includes("fan1"), JSON.stringify(s.history.slice(-6)));
ok("none of this moved the camera", JSON.stringify(await cam()) === JSON.stringify(cam0), `${JSON.stringify(cam0)} -> ${JSON.stringify(await cam())}`);
await h.shot("fan-installed");

// ---------- PSU removal needs the screws out first ----------
await select(/RM850x/i);
ok("the remove panel offers the screws, not a lift, while screws are in", (await button(h.msg("hands.unscrewNext")).count()) === 1 && (await button(h.msg("hands.liftOutOf.psu")).count()) === 0);
for (let i = 0; i < 4; i += 1) await press(button(h.msg("hands.unscrewNext")));
await press(button(h.msg("hands.liftOutOf.psu")));
s = await state();
ok("the supply is out again after four unscrews and a lift", !s.placed.includes("psu") && s.history.at(-1) === "lift:psu", JSON.stringify(s.history.slice(-2)));
await finish(h);
