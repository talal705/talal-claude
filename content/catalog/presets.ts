// The two starter configurations, built from the shared catalog. `pcPresets` holds each finished assembly as the
// actions that produce it (for tests, lessons and fault exercises); `pcStarterKits` is what a learner is given:
// the same parts on the workbench, nothing installed (owner decision 9).
// Each is verified by packages/simulation/src/pc/startup.test.ts: every action is accepted and the build starts.
import type { MountRef, PCAction, PCPreset, PortRef } from "@ytl/contracts";
import { L } from "./helpers";
import { pcCatalog, suppliedPartActions } from "./catalog";

/** Catalog ID by instance ID, for the script that is being written (reset by `script()`). */
let CATALOG_OF: Record<string, string> = {};

/** Writes an action list while tracking the IDs the engine will assign (one build-wide serial). */
function script() {
  CATALOG_OF = {};
  const actions: PCAction[] = [];
  let serial = 1;
  const at = (hostInstanceId: string, mountPointId: string): MountRef => ({ hostInstanceId, mountPointId });
  const on = (instanceId: string, portId: string): PortRef => ({ kind: "part", instanceId, portId });
  let benchEnd = -1;
  return {
    actions,
    at,
    on,
    /** The case's fitted parts (its factory fans), added and fixed in their positions; returns their IDs. */
    fitted(caseInstanceId: string, caseCatalogId: string): string[] {
      const { actions: steps, instanceIds } = suppliedPartActions(caseCatalogId, caseInstanceId, serial);
      actions.push(...steps);
      serial += instanceIds.length;
      return instanceIds;
    },
    /** Everything so far is how the parts arrive on the bench; what follows is the assembly. */
    endBench() {
      benchEnd = actions.length;
    },
    get benchEnd() {
      return benchEnd;
    },
    add(catalogId: string): string {
      const category = pcCatalog.entries.find((e) => e.id === catalogId)?.category ?? "unknown";
      actions.push({ type: "add_part", catalogId });
      const instanceId = `${category}-${serial++}`;
      CATALOG_OF[instanceId] = catalogId;
      return instanceId;
    },
    addCable(catalogId: string): string {
      actions.push({ type: "add_cable", catalogId });
      return `cable-${serial++}`;
    },
    /** Place, seat and secure in one go. */
    install(instanceId: string, target: MountRef, fasteners: number, role?: string) {
      actions.push({ type: "mount_part", instanceId, target, ...(role ? { role } : {}) });
      actions.push({ type: "set_seating", instanceId, seating: "seated", ...(role ? { role } : {}) });
      if (fasteners > 0) actions.push({ type: "set_fasteners", instanceId, secured: fasteners, ...(role ? { role } : {}) });
    },
    plug(cableId: string, endId: string, to: PortRef) {
      actions.push({ type: "connect_cable_end", cableId, endId, to });
    },
    tidy(...cableIds: string[]) {
      for (const cableId of cableIds) actions.push({ type: "set_cable_tidy", cableId, tidied: true });
    },
    push(action: PCAction) {
      actions.push(action);
    },
  };
}

/** A written build: its actions, and where the parts-on-the-bench part ends (the rest is the assembly). */
interface Written {
  actions: PCAction[];
  benchEnd: number;
}

/** Starter configuration B: Core i7 on the DDR5 board, with lighting and liquid cooling. */
function i7Ddr5RgbAio(): Written {
  const s = script();
  s.push({ type: "set_rgb_preference", preference: "with_rgb" });
  const pc = s.add("fractal-north-charcoal-black-mesh");
  const mb = s.add("asus-tuf-gaming-z790-plus-wifi");
  const cpu = s.add("intel-core-i7-14700k");
  const ram1 = s.add("corsair-vengeance-rgb-ddr5-6000-32gb-kit");
  const ram2 = s.add("corsair-vengeance-rgb-ddr5-6000-32gb-kit");
  const ssd = s.add("samsung-990-pro-1tb");
  const aio = s.add("arctic-liquid-freezer-iii-240-argb");
  const gpu = s.add("asus-tuf-rtx4070tis-o16g-gaming");
  const psu = s.add("corsair-rm850x-atx31");
  const fan = s.add("arctic-p12-pwm-pst-argb");
  // The case arrives with its fitted front fans already in their positions.
  const [ff1, ff2] = s.fitted(pc, CATALOG_OF[pc]!);
  s.endBench();

  // The i7-14700K is supported from BIOS 1205; the simulated board starts on 0802.
  s.push({ type: "update_bios", instanceId: mb, version: "1840" });
  s.install(cpu, s.at(mb, "cpu-socket"), 1);
  s.install(ram1, s.at(mb, "dimm-a2"), 0);
  s.install(ram2, s.at(mb, "dimm-b2"), 0);
  s.install(ssd, s.at(mb, "m2-1"), 1);
  s.install(aio, s.at(mb, "cooler-mount"), 4, "block");
  // Move the prepared motherboard and all its attached parts into the case together.
  s.install(mb, s.at(pc, "motherboard-tray"), 9);
  s.install(aio, s.at(pc, "rad-top"), 8, "radiator");
  s.install(gpu, s.at(mb, "pcie-x16-1"), 2);
  s.install(psu, s.at(pc, "psu-bay"), 4);
  s.install(fan, s.at(pc, "fan-rear-1"), 4);

  s.plug(`${psu}.atx24`, "psu", s.on(psu, "out-atx-1"));
  s.plug(`${psu}.atx24`, "device", s.on(mb, "atx-24"));
  s.plug(`${psu}.eps-1`, "psu", s.on(psu, "out-cpu-pcie-1"));
  s.plug(`${psu}.eps-1`, "device", s.on(mb, "eps-1"));
  s.plug(`${psu}.eps-2`, "psu", s.on(psu, "out-cpu-pcie-2"));
  s.plug(`${psu}.eps-2`, "device", s.on(mb, "eps-2"));
  s.plug(`${psu}.gpu-12v-2x6`, "psu-1", s.on(psu, "out-cpu-pcie-3"));
  s.plug(`${psu}.gpu-12v-2x6`, "psu-2", s.on(psu, "out-cpu-pcie-4"));
  s.plug(`${psu}.gpu-12v-2x6`, "device", s.on(gpu, "power-16pin"));
  s.plug(`${aio}.pump-fan`, "plug", s.on(mb, "aio-pump"));
  s.plug(`${aio}.argb`, "plug", s.on(mb, "argb-1"));
  s.plug(`${fan}.fan`, "plug", s.on(mb, "cha-fan-3"));
  s.plug(`${fan}.argb`, "plug", s.on(mb, "argb-2"));
  s.plug(`${pc}.power-switch`, "plug", s.on(mb, "panel-pwrsw"));
  s.plug(`${pc}.front-audio`, "plug", s.on(mb, "hd-audio"));
  s.plug(`${pc}.front-usb3`, "plug", s.on(mb, "usb3-header"));
  s.plug(`${pc}.front-usb-c`, "plug", s.on(mb, "usb-c-header"));
  s.plug(`${ff1}.fan`, "plug", s.on(mb, "cha-fan-1"));
  s.plug(`${ff2}.fan`, "plug", s.on(mb, "cha-fan-2"));
  s.tidy(
    `${psu}.atx24`, `${psu}.eps-1`, `${psu}.eps-2`, `${psu}.gpu-12v-2x6`, `${aio}.pump-fan`, `${aio}.argb`, `${fan}.fan`, `${fan}.argb`,
    `${pc}.power-switch`, `${pc}.front-audio`, `${pc}.front-usb3`, `${pc}.front-usb-c`, `${ff1}.fan`, `${ff2}.fan`,
  );
  s.push({ type: "set_side_panel", open: false });
  s.push({ type: "set_wall_power", connected: true });
  s.push({ type: "set_psu_switch", on: true });
  return { actions: s.actions, benchEnd: s.benchEnd };
}

/** Starter configuration A: Core i5 on the DDR4 board, without lighting, air cooled. */
function i5Ddr4Air(): Written {
  const s = script();
  s.push({ type: "set_rgb_preference", preference: "without_rgb" });
  const pc = s.add("corsair-4000d-airflow-black");
  const mb = s.add("asus-tuf-gaming-z790-plus-wifi-d4");
  const cpu = s.add("intel-core-i5-14600k");
  const ram1 = s.add("corsair-vengeance-lpx-ddr4-3600-16gb-kit");
  const ram2 = s.add("corsair-vengeance-lpx-ddr4-3600-16gb-kit");
  const ssd = s.add("samsung-870-evo-1tb");
  const cooler = s.add("arctic-freezer-36");
  const gpu = s.add("asus-dual-rtx4060-o8g");
  const psu = s.add("corsair-cx550");
  const fan = s.add("arctic-p12-pwm-pst");
  // The case arrives with its fitted front fans already in their positions.
  const [ff1, ff2] = s.fitted(pc, CATALOG_OF[pc]!);
  s.endBench();
  // The board ships with two SATA data cables; the first one connects the drive.
  const sata = `${mb}.sata-data-1`;

  // The i5-14600K is supported from BIOS 1205; the simulated board starts on 0411.
  s.push({ type: "update_bios", instanceId: mb, version: "1836" });
  s.install(cpu, s.at(mb, "cpu-socket"), 1);
  s.install(ram1, s.at(mb, "dimm-a2"), 0);
  s.install(ram2, s.at(mb, "dimm-b2"), 0);
  s.install(cooler, s.at(mb, "cooler-mount"), 4);
  // Move the prepared motherboard and all its attached parts into the case together.
  s.install(mb, s.at(pc, "motherboard-tray"), 9);
  s.install(gpu, s.at(mb, "pcie-x16-1"), 2);
  s.install(ssd, s.at(pc, "drive-25-1"), 4);
  s.install(psu, s.at(pc, "psu-bay"), 4);
  s.install(fan, s.at(pc, "fan-rear-1"), 4);

  s.plug(`${psu}.atx24`, "device", s.on(mb, "atx-24"));
  s.plug(`${psu}.eps`, "device", s.on(mb, "eps-1"));
  s.plug(`${psu}.pcie`, "device-1", s.on(gpu, "power-8pin"));
  s.plug(`${psu}.sata`, "sata-1", s.on(ssd, "sata-power"));
  s.plug(sata, "a", s.on(ssd, "sata-data"));
  s.plug(sata, "b", s.on(mb, "sata-1"));
  s.plug(`${cooler}.fan`, "plug", s.on(mb, "cpu-fan"));
  s.plug(`${fan}.fan`, "plug", s.on(mb, "cha-fan-3"));
  s.plug(`${pc}.power-switch`, "plug", s.on(mb, "panel-pwrsw"));
  s.plug(`${pc}.front-audio`, "plug", s.on(mb, "hd-audio"));
  s.plug(`${pc}.front-usb3`, "plug", s.on(mb, "usb3-header"));
  s.plug(`${pc}.front-usb-c`, "plug", s.on(mb, "usb-c-header"));
  s.plug(`${ff1}.fan`, "plug", s.on(mb, "cha-fan-1"));
  s.plug(`${ff2}.fan`, "plug", s.on(mb, "cha-fan-2"));
  s.tidy(
    `${psu}.atx24`, `${psu}.eps`, `${psu}.pcie`, `${psu}.sata`, sata, `${cooler}.fan`, `${fan}.fan`,
    `${pc}.power-switch`, `${pc}.front-audio`, `${pc}.front-usb3`, `${pc}.front-usb-c`, `${ff1}.fan`, `${ff2}.fan`,
  );
  s.push({ type: "set_side_panel", open: false });
  s.push({ type: "set_wall_power", connected: true });
  s.push({ type: "set_psu_switch", on: true });
  return { actions: s.actions, benchEnd: s.benchEnd };
}

/**
 * A computer brought in for repair: a genuinely compatible mix of parts from both starter sets (Core i5 on the
 * DDR5 board with the DDR5 kit, the tower air cooler in the case it fits, RTX 4060, 850 W modular supply).
 * Used, fully assembled, by the fault exercise; never offered as a starter (owner decision 9).
 */
function repairI5Ddr5Air(): Written {
  const s = script();
  s.push({ type: "set_rgb_preference", preference: "with_rgb" });
  const pc = s.add("corsair-4000d-airflow-black");
  const mb = s.add("asus-tuf-gaming-z790-plus-wifi");
  const cpu = s.add("intel-core-i5-14600k");
  const ram1 = s.add("corsair-vengeance-rgb-ddr5-6000-32gb-kit");
  const ram2 = s.add("corsair-vengeance-rgb-ddr5-6000-32gb-kit");
  const ssd = s.add("samsung-990-pro-1tb");
  const cooler = s.add("arctic-freezer-36");
  const gpu = s.add("asus-dual-rtx4060-o8g");
  const psu = s.add("corsair-rm850x-atx31");
  const fan = s.add("arctic-p12-pwm-pst");
  // The case arrives with its fitted front fans already in their positions.
  const [ff1, ff2] = s.fitted(pc, CATALOG_OF[pc]!);
  s.endBench();

  s.push({ type: "update_bios", instanceId: mb, version: "1840" });
  s.install(mb, s.at(pc, "motherboard-tray"), 9);
  s.install(cpu, s.at(mb, "cpu-socket"), 1);
  s.install(ram1, s.at(mb, "dimm-a2"), 0);
  s.install(ram2, s.at(mb, "dimm-b2"), 0);
  s.install(ssd, s.at(mb, "m2-1"), 1);
  s.install(cooler, s.at(mb, "cooler-mount"), 4);
  s.install(gpu, s.at(mb, "pcie-x16-1"), 2);
  s.install(psu, s.at(pc, "psu-bay"), 4);
  s.install(fan, s.at(pc, "fan-rear-1"), 4);

  s.plug(`${psu}.atx24`, "psu", s.on(psu, "out-atx-1"));
  s.plug(`${psu}.atx24`, "device", s.on(mb, "atx-24"));
  s.plug(`${psu}.eps-1`, "psu", s.on(psu, "out-cpu-pcie-1"));
  s.plug(`${psu}.eps-1`, "device", s.on(mb, "eps-1"));
  s.plug(`${psu}.eps-2`, "psu", s.on(psu, "out-cpu-pcie-2"));
  s.plug(`${psu}.eps-2`, "device", s.on(mb, "eps-2"));
  s.plug(`${psu}.pcie-1`, "psu", s.on(psu, "out-cpu-pcie-3"));
  s.plug(`${psu}.pcie-1`, "device", s.on(gpu, "power-8pin"));
  s.plug(`${cooler}.fan`, "plug", s.on(mb, "cpu-fan"));
  s.plug(`${fan}.fan`, "plug", s.on(mb, "cha-fan-3"));
  s.plug(`${pc}.power-switch`, "plug", s.on(mb, "panel-pwrsw"));
  s.plug(`${pc}.front-audio`, "plug", s.on(mb, "hd-audio"));
  s.plug(`${pc}.front-usb3`, "plug", s.on(mb, "usb3-header"));
  s.plug(`${pc}.front-usb-c`, "plug", s.on(mb, "usb-c-header"));
  s.plug(`${ff1}.fan`, "plug", s.on(mb, "cha-fan-1"));
  s.plug(`${ff2}.fan`, "plug", s.on(mb, "cha-fan-2"));
  s.tidy(
    `${psu}.atx24`, `${psu}.eps-1`, `${psu}.eps-2`, `${psu}.pcie-1`, `${cooler}.fan`, `${fan}.fan`,
    `${pc}.power-switch`, `${pc}.front-audio`, `${pc}.front-usb3`, `${pc}.front-usb-c`, `${ff1}.fan`, `${ff2}.fan`,
  );
  s.push({ type: "set_side_panel", open: false });
  s.push({ type: "set_wall_power", connected: true });
  s.push({ type: "set_psu_switch", on: true });
  return { actions: s.actions, benchEnd: s.benchEnd };
}

/** Finished computers used by fault exercises. Not starter configurations and never offered as a start. */
export const pcRepairBuilds: PCPreset[] = [
  {
    id: "repair-i5-ddr5-air",
    title: L("Computer brought in for repair: Core i5, DDR5, air cooled", "كمبيوتر جايك للتصليح: Core i5، و DDR5، وتبريد هوائي"),
    description: L(
      "An assembled computer someone built from a mix of parts: Core i5-14600K on the Z790 DDR5 board, two DDR5 modules, an RTX 4060, an NVMe drive, the tower air cooler and an 850 W modular power supply in a Corsair 4000D.",
      "كمبيوتر مركّب، واحد جمّعه من قطع مخلوطة: Core i5-14600K على لوحة Z790 برام DDR5، ورامين DDR5، وكرت RTX 4060، وقرص NVMe، والمبرّد الهوائي البرجي، ومزوّد طاقة مودولار 850 واط في هيكل Corsair 4000D.",
    ),
    rgb: "with_rgb",
    actions: repairI5Ddr5Air().actions,
  },
];

const STARTER_A = i5Ddr4Air();
const STARTER_B = i7Ddr5RgbAio();

export const pcPresets: PCPreset[] = [
  {
    id: "i5-ddr4-air",
    title: L("Starter A: Core i5 with DDR4, air cooled", "المجموعة أ: Core i5 مع DDR4 وتبريد هوائي"),
    description: L(
      "Core i5-14600K on the Z790 DDR4 board, 16 GB of DDR4 memory, an RTX 4060, a SATA solid-state drive, a tower air cooler, one extra case fan and a 550 W power supply with fixed cables, in a Corsair 4000D. No part has lighting. Parts can be swapped for compatible ones from the other set.",
      "معالج Core i5-14600K على لوحة Z790 برام DDR4، و 16 قيقا رام DDR4، وكرت RTX 4060، وقرص SSD SATA، ومبرّد هوائي برجي، ومروحة هيكل زيادة، ومزوّد طاقة 550 واط كيبلاته ثابتة، في هيكل Corsair 4000D. ولا قطعة فيها إضاءة. تقدر تبدّل القطع بقطع متوافقة من المجموعة الثانية.",
    ),
    rgb: "without_rgb",
    actions: STARTER_A.actions,
  },
  {
    id: "i7-ddr5-rgb-aio",
    title: L("Starter B: Core i7 with DDR5, RGB and liquid cooling", "المجموعة ب: Core i7 مع DDR5 وإضاءة وتبريد مائي"),
    description: L(
      "Core i7-14700K on the Z790 DDR5 board, 32 GB of lit DDR5 memory, an RTX 4070 Ti SUPER, an NVMe drive, a 240 mm liquid cooler, one lit case fan and an 850 W modular power supply, in a Fractal North. Parts can be swapped for compatible ones from the other set.",
      "معالج Core i7-14700K على لوحة Z790 برام DDR5، و 32 قيقا رام DDR5 بإضاءة، وكرت RTX 4070 Ti SUPER، وقرص NVMe، ومبرّد مائي 240 مم، ومروحة هيكل بإضاءة، ومزوّد طاقة مودولار 850 واط، في هيكل Fractal North. تقدر تبدّل القطع بقطع متوافقة من المجموعة الثانية.",
    ),
    rgb: "with_rgb",
    actions: STARTER_B.actions,
  },
];

/** A starter configuration as delivered: its parts on the workbench, nothing installed, cables still with their parts. */
export interface PCStarterKit {
  id: string;
  title: PCPreset["title"];
  description: PCPreset["description"];
  rgb: PCPreset["rgb"];
  /** The lighting choice, the parts added to the bench, and the case's fitted fans in their factory positions. */
  actions: PCAction[];
  /** One worked assembly from the bench to a running computer (the rest of the preset), for tests and lessons. */
  solution: PCAction[];
}

const KIT_TEXT: Record<string, Pick<PCStarterKit, "title" | "description">> = {
  "i5-ddr4-air": {
    title: L("Starter A: Core i5 with DDR4, air cooled", "المجموعة أ: Core i5 مع DDR4 وتبريد هوائي"),
    description: L(
      "Every part arrives separately on the workbench: Corsair 4000D case, Z790 DDR4 board, Core i5-14600K, two DDR4 modules, RTX 4060, SATA SSD, tower air cooler, one case fan and a 550 W power supply with fixed cables. No lighting. You install and connect everything yourself.",
      "كل قطعة توصل لحالها على طاولة الشغل: هيكل Corsair 4000D، ولوحة Z790 برام DDR4، ومعالج Core i5-14600K، ورامين DDR4، وكرت RTX 4060، وقرص SSD SATA، ومبرّد هوائي برجي، ومروحة هيكل، ومزوّد طاقة 550 واط كيبلاته ثابتة. بدون إضاءة. أنت تركّب وتوصّل كل شي بنفسك.",
    ),
  },
  "i7-ddr5-rgb-aio": {
    title: L("Starter B: Core i7 with DDR5, RGB and liquid cooling", "المجموعة ب: Core i7 مع DDR5 وإضاءة وتبريد مائي"),
    description: L(
      "Every part arrives separately on the workbench: Fractal North case, Z790 DDR5 board, Core i7-14700K, two lit DDR5 modules, RTX 4070 Ti SUPER, NVMe SSD, 240 mm liquid cooler, one lit case fan and an 850 W modular power supply with its cables. You install and connect everything yourself.",
      "كل قطعة توصل لحالها على طاولة الشغل: هيكل Fractal North، ولوحة Z790 برام DDR5، ومعالج Core i7-14700K، ورامين DDR5 بإضاءة، وكرت RTX 4070 Ti SUPER، وقرص NVMe، ومبرّد مائي 240 مم، ومروحة هيكل بإضاءة، ومزوّد طاقة مودولار 850 واط مع كيبلاته. أنت تركّب وتوصّل كل شي بنفسك.",
    ),
  },
};

const WRITTEN: Record<string, Written> = { "i5-ddr4-air": STARTER_A, "i7-ddr5-rgb-aio": STARTER_B };

export const pcStarterKits: PCStarterKit[] = pcPresets.map((preset) => {
  const { actions, benchEnd } = WRITTEN[preset.id]!;
  return {
    id: preset.id,
    ...KIT_TEXT[preset.id]!,
    rgb: preset.rgb,
    actions: actions.slice(0, benchEnd),
    solution: actions.slice(benchEnd),
  };
});
