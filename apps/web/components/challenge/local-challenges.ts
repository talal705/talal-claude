// Challenges a learner made from their own builds, kept in this browser only. Each is a one-step
// "find and fix" lesson in the lesson contract, so the lesson panel and runner run it and the
// engine judges the repair. Nothing here is shared.
import type { LabType, Localized, NetworkAction, PCAction } from "@ytl/contracts";
import type { Lesson } from "@ytl/curriculum";
import type { NetworkProbe } from "./faults";

const KEY = "ytl_local_challenges";
const L = (en: string, ar: string): Localized => ({ en, ar });

export function isLocalChallengeId(id: string): boolean {
  return id.startsWith("local.");
}

export function localChallenges(): Lesson[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw.filter((item) => item && typeof item === "object" && typeof (item as Lesson).id === "string") as Lesson[]) : [];
  } catch {
    return [];
  }
}

/** Throws when this browser cannot store it; the caller says so. */
export function saveLocalChallenge(lesson: Lesson) {
  localStorage.setItem(KEY, JSON.stringify([...localChallenges().filter((item) => item.id !== lesson.id), lesson]));
}

// The words a learner reads while solving never name the fault that was put in: not in the title,
// the goal, the hints or the explanation. The engine's own results say where it stops.
const SUMMARY = L(
  "A build that worked has been broken in one place. Find where, fix it, and check.",
  "تجميعة كانت شغّالة انخربت في مكان واحد. لاقِ وين، صلّحه، وافحص.",
);
const OUTCOME = L("Find a fault by testing, fix it, and confirm the repair.", "تلاقي الخلل بالاختبار، تصلّحه، وتتأكد من التصليح.");
const SKILLS = { repair: L("Finding and fixing a fault", "لقاء الخلل وتصليحه") };
const EXPLANATION = L(
  "A fault is found by testing, not by guessing: each test rules part of the system in or out, and the place where it stops is where to look. Fixing one thing and testing again shows whether that was it.",
  "الخلل ينلقى بالاختبار مو بالتخمين: كل اختبار يأكد أو يستبعد جزء من النظام، والمكان اللي يوقف عنده هو المكان اللي تدوّر فيه. تصلّح شي واحد وتختبر مرة ثانية عشان تعرف إذا هو السبب.",
);

export interface ChallengeInput {
  /** The author's name for it; shown as the challenge's title. */
  name: string;
  /** The working build or network's log plus the fault's actions. */
  start: { lab: "pc"; actions: readonly PCAction[] } | { lab: "network"; actions: readonly NetworkAction[] };
  /** Network only: the ping that must arrive again. */
  probe?: NetworkProbe;
}

export function challengeLesson(input: ChallengeInput, id: string): Lesson {
  const lab: LabType = input.start.lab;
  const title = L(`Challenge: ${input.name}`, `تحدي: ${input.name}`);
  const pcStep = {
    goal: L("This computer does not reach the operating system. Find out why, fix it, then press the power button.", "هذا الكمبيوتر ما يوصل لنظام التشغيل. لاقِ السبب، صلّحه، وبعدين اضغط زر التشغيل."),
    check: { type: "pc.startup" as const, label: L("Power is on and the computer reaches the operating system", "الكمبيوتر شغّال ويوصل لنظام التشغيل"), outcome: ["operational" as const] },
    hints: [
      { text: L("What should happen when it is switched on, and what happens instead?", "وش المفروض يصير لما يشتغل، ووش اللي يصير بدال كذا؟") },
      { text: L("Press the power button and read the startup stages: the first one that fails tells you which part of the computer to look at.", "اضغط زر التشغيل واقرأ مراحل التشغيل: أول مرحلة تفشل تقول لك أي جزء من الكمبيوتر تشوفه.") },
      { text: L("Read the stage's line and the open problems list; fix what they name, switch off, and try again.", "اقرأ سطر المرحلة وقائمة المشاكل المفتوحة؛ صلّح اللي يذكرونه، طفّ الجهاز، وجرّب مرة ثانية.") },
    ] as const,
  };
  const probe = input.probe;
  const networkStep = {
    goal: L(`A device on this network can no longer reach ${probe?.to ?? "the internet"}. Find out why and fix it.`, `جهاز في هذي الشبكة ما عاد يوصل لـ ${probe?.to ?? "الإنترنت"}. لاقِ السبب وصلّحه.`),
    check: {
      type: "all" as const,
      label: L("The network works again", "الشبكة رجعت تشتغل"),
      of: [
        { type: "net.ping" as const, label: L(`A ping from the first computer to ${probe?.to ?? ""} arrives`, `Ping من أول كمبيوتر إلى ${probe?.to ?? ""} يوصل`), from: { id: probe?.fromDeviceId ?? "" }, to: probe?.to ?? "", succeeds: true },
        { type: "net.no_diagnostic" as const, label: L("The lab reports nothing that stops traffic", "المختبر ما يلقى شي يوقّف المرور") },
      ],
    },
    hints: [
      { text: L("What should work, and what does the lab say happens instead?", "وش المفروض يشتغل، ووش يقول المختبر إنه يصير بدال كذا؟") },
      { text: L("Send a ping and step through its journey: the step where it stops is the place to look.", "أرسل Ping وامشِ مع رحلته خطوة خطوة: الخطوة اللي يوقف عندها هي المكان اللي تشوفه.") },
      { text: L("Read that step's reason and the addresses table; fix what they point at and test again.", "اقرأ سبب الخطوة وجدول العناوين؛ صلّح اللي يأشرون عليه واختبر مرة ثانية.") },
    ] as const,
  };
  const step = lab === "pc" ? pcStep : networkStep;
  return {
    id,
    version: 1,
    lab,
    level: "beginner",
    kind: "fault",
    title,
    summary: SUMMARY,
    outcome: OUTCOME,
    prerequisites: [],
    skills: SKILLS,
    start: input.start,
    steps: [{ id: "repair", skill: "repair", goal: step.goal, check: step.check, hints: [...step.hints] as unknown as Lesson["steps"][number]["hints"], explanation: EXPLANATION }],
  };
}
