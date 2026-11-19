// The physical steps inside one "install" (lift the lever, peel the film, check the standoffs …).
// The learner ticks them in order before the part goes in; the engine still decides the fit.
import { pcCatalog } from "./catalog";
import { ALL_SIMPLE_PARTS, roleOf, type SimplePartKey } from "./simple-model";

export function substepsFor(key: SimplePartKey): string[] {
  const spec = ALL_SIMPLE_PARTS.find((p) => p.key === key);
  const entry = pcCatalog.entries.find((e) => e.id === spec?.catalogId);
  const role = roleOf(key);
  switch (role) {
    // The CPU and memory are fitted with their real mechanisms in the scene (see SimplePcLab), not a list.
    case "cpu": return [];
    case "ram": return [];
    case "storage":
      if (entry?.category === "storage" && entry.spec.formFactor.startsWith("m2_")) return ["m2Latch", "m2Angle", "m2Secure"];
      return ["driveTray", "driveScrews"];
    case "cooler": return ["pasteCheck", "coolerFilm", "coolerBracket", "coolerDiagonal"];
    case "aio": return ["pasteCheck", "coolerFilm", "coolerBracket", "radiatorMount", "fanDirection"];
    case "motherboard": return ["standoffs", "ioShield", "boardAlign", "boardScrews"];
    case "gpu": return ["slotCovers", "gpuLatch", "gpuPress", "gpuBracket"];
    case "psu": return ["psuFan", "psuSlide", "psuScrews"];
    case "fan": return ["fanArrows", "fanScrews"];
    default: return [];
  }
}
