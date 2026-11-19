// The physical steps inside one "install" (lift the lever, peel the film, check the standoffs …).
// The learner ticks them in order before the part goes in; the engine still decides the fit.
import { pcCatalog } from "./catalog";
import { ALL_SIMPLE_PARTS, roleOf, type SimplePartKey } from "./simple-model";

/** The catalog entry of the part that carries an instance (the board an M.2 slot is on). */
const boardOf = (instanceId: string) => ALL_SIMPLE_PARTS.find((p) => p.id === instanceId)?.catalogId;

export function substepsFor(key: SimplePartKey): string[] {
  const spec = ALL_SIMPLE_PARTS.find((p) => p.key === key);
  const entry = pcCatalog.entries.find((e) => e.id === spec?.catalogId);
  const role = roleOf(key);
  switch (role) {
    // The CPU and memory are fitted with their real mechanisms in the scene (see SimplePcLab), not a list.
    case "cpu": return [];
    case "ram": return [];
    case "storage":
      // An M.2 drive in a Q-Latch slot is fitted with the latch in the scene; a screw-held slot keeps the list.
      if (entry?.category === "storage" && entry.spec.formFactor.startsWith("m2_")) return spec && pcCatalog.entries.find((e) => e.id === boardOf(spec.host))?.mountPoints.find((m) => m.id === spec.mount)?.retention ? [] : ["m2Latch", "m2Angle", "m2Secure"];
      return ["driveTray", "driveScrews"];
    case "cooler": return ["pasteCheck", "coolerFilm", "coolerBracket", "coolerDiagonal"];
    case "aio": return ["pasteCheck", "coolerFilm", "coolerBracket", "radiatorMount", "fanDirection"];
    case "motherboard": return ["standoffs", "ioShield", "boardAlign", "boardScrews"];
    // A card is fitted with the slot covers, latch, alignment and bracket screws in the scene.
    case "gpu": return [];
    case "psu": return ["psuFan", "psuSlide", "psuScrews"];
    case "fan": return ["fanArrows", "fanScrews"];
    default: return [];
  }
}
