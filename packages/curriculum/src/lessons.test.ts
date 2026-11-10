// Every published lesson: well formed in both languages, its start state builds, and its worked
// example completes it through the runner, with the checks telling the right state from the
// starting one. PC and network checks run on the real engines and catalog.
import { describe, expect, it } from "vitest";
import { TARGET_ID_PATTERN, type NetworkState, type PCAction, type PCBuildState } from "@ytl/contracts";
import { network, pc } from "@ytl/simulation";
import { pcCatalog, pcStarterKits } from "../../../content/catalog";
import { lessonById, lessons } from "../../../content/lessons";
import { lessonExamples } from "../../../content/lessons/examples";
import { checkStep } from "./checkers";
import type { CheckSpec, ExampleSolution, Lesson, LessonEvidence, LessonTask } from "./contract";
import { LESSON_LEVELS } from "./contract";
import { lessonReducer, startLesson, summarize, type LessonRunState } from "./runner";

/** The start actions of a lesson. */
const startActions = (lesson: Lesson): never[] => [...lesson.start.actions] as never[];
const exampleOf = (lesson: Lesson) => lessonExamples.find((example) => example.lessonId === lesson.id)!;

/** Every `{ en, ar }` pair in a value, with where it was found. */
function localized(value: unknown, path = "lesson"): { path: string; en: unknown; ar: unknown }[] {
  if (!value || typeof value !== "object") return [];
  if ("en" in value && "ar" in value) return [{ path, en: (value as { en: unknown }).en, ar: (value as { ar: unknown }).ar }];
  return Object.entries(value).flatMap(([key, inner]) => localized(inner, `${path}.${key}`));
}
const leaves = (spec: CheckSpec): CheckSpec[] => (spec.type === "all" || spec.type === "any" ? spec.of.flatMap(leaves) : [spec]);
const tasksOf = (lesson: Lesson): LessonTask[] => lesson.steps.flatMap((step) => [step, ...(step.followUp ? [step.followUp] : [])]);

describe("every published lesson is well formed", () => {
  it("lesson IDs are unique, every lesson has a worked example covering each step, and links point at real lessons", () => {
    expect(new Set(lessons.map((lesson) => lesson.id)).size).toBe(lessons.length);
    for (const lesson of lessons) {
      const example = exampleOf(lesson);
      expect(example, lesson.id).toBeDefined();
      expect(example.steps.map((step) => step.stepId), lesson.id).toEqual(lesson.steps.map((step) => step.id));
      for (const id of [...lesson.prerequisites, ...(lesson.nextLessonId ? [lesson.nextLessonId] : [])]) expect(lessonById(id), `${lesson.id} -> ${id}`).toBeDefined();
      expect(LESSON_LEVELS).toContain(lesson.level);
      expect(lesson.steps.length, lesson.id).toBeGreaterThan(0);
    }
  });

  it("every text exists in English and Arabic, and the Arabic is Arabic", () => {
    for (const lesson of lessons) {
      for (const { path, en, ar } of localized(lesson)) {
        expect(typeof en === "string" && en.trim().length > 0, `${lesson.id} ${path}.en`).toBe(true);
        expect(typeof ar === "string" && ar.trim().length > 0, `${lesson.id} ${path}.ar`).toBe(true);
      }
      for (const text of [lesson.title, lesson.summary, lesson.outcome, ...lesson.steps.flatMap((step) => [step.goal, step.explanation, ...step.hints.map((hint) => hint.text)])]) {
        expect(text.ar, `${lesson.id}: ${text.en}`).toMatch(/[؀-ۿ]/);
        expect(text.ar, `${lesson.id}`).not.toBe(text.en);
      }
    }
  });

  it("every task has three hints, an explanation and a labelled condition; every hint target is a well-formed ID", () => {
    for (const lesson of lessons) {
      for (const task of tasksOf(lesson)) {
        expect(task.hints, lesson.id).toHaveLength(3);
        for (const hint of task.hints) if (hint.target) expect(hint.target.id, lesson.id).toMatch(TARGET_ID_PATTERN);
        for (const leaf of leaves(task.check)) expect(leaf.label.en.length, lesson.id).toBeGreaterThan(0);
        if (leaves(task.check).some((leaf) => leaf.type === "choice")) {
          expect(task.options?.length, `${lesson.id}: a choice needs options`).toBeGreaterThan(1);
          const right = leaves(task.check).find((leaf) => leaf.type === "choice") as Extract<CheckSpec, { type: "choice" }>;
          expect(task.options!.map((option) => option.id), lesson.id).toContain(right.correctOptionId);
        }
      }
    }
  });

  it("no condition mixes a question with an engine check, so one kind of evidence can decide it (server re-checking relies on this)", () => {
    for (const lesson of lessons) {
      for (const task of tasksOf(lesson)) {
        const kinds = new Set(leaves(task.check).map((leaf) => (leaf.type === "choice" ? "choice" : leaf.type.split(".")[0])));
        expect(kinds.size, `${lesson.id}: ${[...kinds].join(", ")}`).toBe(1);
        if (!kinds.has("choice")) expect([...kinds][0], lesson.id).toBe({ pc: "pc", network: "net" }[lesson.lab as "pc" | "network"]);
      }
    }
  });

  it("each lab has a beginner lesson, a Test Yourself challenge and a fault exercise", () => {
    for (const lab of ["pc", "network"] as const) {
      expect(lessons.filter((lesson) => lesson.lab === lab && lesson.level === "beginner").map((lesson) => lesson.kind).sort(), lab).toEqual(["challenge", "fault", "lesson"]);
    }
  });
});

// ---------- Simulated labs ----------

interface Workspace {
  state: PCBuildState | NetworkState;
}

function startWorkspace(lesson: Lesson): Workspace {
  if (lesson.start.lab === "pc") {
    const built = pc.replay(lesson.start.actions, pcCatalog);
    expect(built.clean, `${lesson.id}: start replays without a rejection`).toBe(true);
    return { state: built.state };
  }
  if (lesson.start.lab === "network") {
    const built = network.replay(lesson.start.actions);
    expect(built.rejection, `${lesson.id}: start replays without a rejection`).toBeUndefined();
    return { state: built.state };
  }
  throw new Error("not a simulated lab");
}

function apply(lesson: Lesson, workspace: Workspace, solution: ExampleSolution): void {
  if (solution.lab === "pc") {
    const result = pc.replay(solution.actions, pcCatalog, workspace.state as PCBuildState);
    expect(result.clean, `${lesson.id}: ${JSON.stringify(result.events.filter((e) => !e.accepted).map((e) => e.rejection?.message.en))}`).toBe(true);
    workspace.state = result.state;
  } else if (solution.lab === "network") {
    const result = network.replay(solution.actions, workspace.state as NetworkState);
    expect(result.rejection?.message.en, lesson.id).toBeUndefined();
    workspace.state = result.state;
  }
}

function evidenceOf(lesson: Lesson, workspace: Workspace, solution?: ExampleSolution): LessonEvidence {
  if (solution?.lab === "choice") return { lab: "choice", optionId: solution.optionId };
  return lesson.lab === "pc" ? { lab: "pc", state: workspace.state as PCBuildState, catalog: pcCatalog } : { lab: "network", state: workspace.state as NetworkState };
}

describe.each(lessons.map((lesson) => [lesson.id, lesson] as const))("%s", (_id, lesson) => {
  it("the worked example completes the lesson through the runner, in the lesson's own mode", () => {
    const workspace = startWorkspace(lesson);
    let run: LessonRunState = startLesson(lesson, lesson.kind === "challenge" ? "test" : "learn");
    for (const [index, step] of lesson.steps.entries()) {
      const worked = exampleOf(lesson).steps[index];
      if (run.phase === "predict") run = lessonReducer(run, { type: "skip_prediction" });
      // Before the learner acts, the step's condition is not met (except a final check of work already done).
      const empty = worked.solution.lab === "pc" || worked.solution.lab === "network" ? worked.solution.actions.length === 0 : false;
      if (!empty) {
        const before = checkStep(step.check, worked.solution.lab === "choice" ? { lab: "choice", optionId: "__none__" } : evidenceOf(lesson, workspace));
        expect(before.passed, `${lesson.id}/${step.id} must not pass before the learner acts`).toBe(false);
        // A first, unsuccessful attempt, so that a follow-up is offered where the step has one.
        if (step.followUp) run = lessonReducer(run, { type: "submit", evidence: worked.solution.lab === "choice" ? { lab: "choice", optionId: "__none__" } : evidenceOf(lesson, workspace) });
      }
      apply(lesson, workspace, worked.solution);
      run = lessonReducer(run, { type: "submit", evidence: evidenceOf(lesson, workspace, worked.solution) });
      expect(run.phase, `${lesson.id}/${step.id}: ${JSON.stringify(run.lastCheck?.lines.filter((line) => !line.passed))}`).toBe("explained");
      run = lessonReducer(run, { type: "continue" });
      if (step.followUp && worked.followUp) {
        expect(run.phase, `${lesson.id}/${step.id}`).toBe("follow_up");
        run = lessonReducer(run, { type: "submit", evidence: evidenceOf(lesson, workspace, worked.followUp) });
        expect(run.notice, `${lesson.id}/${step.id} follow-up`).toBe("follow_up_passed");
        run = lessonReducer(run, { type: "continue" });
      }
    }
    expect(run.phase).toBe("summary");
    expect(summarize(run).completed).toBe(true);
  });

  it("every wrong option of every question is refused", () => {
    for (const task of tasksOf(lesson)) {
      const choice = leaves(task.check).find((leaf) => leaf.type === "choice") as Extract<CheckSpec, { type: "choice" }> | undefined;
      if (!choice) continue;
      for (const option of task.options ?? []) {
        expect(checkStep(task.check, { lab: "choice", optionId: option.id }).passed, `${lesson.id}: ${option.id}`).toBe(option.id === choice.correctOptionId);
      }
    }
  });
});

describe("lesson-specific behaviour on the real engines", () => {
  it("PC: both builds start from their starter kit with every part on the workbench and nothing connected", () => {
    for (const id of ["pc.beginner.first-build", "pc.beginner.build-challenge"]) {
      const { state } = pc.replay(startActions(lessonById(id)!), pcCatalog);
      expect(state.parts.map((part) => part.instanceId), id).toEqual(["case-1", "motherboard-2", "cpu-3", "ram-4", "ram-5", "storage-6", "cooling-7", "gpu-8", "psu-9", "fan-10", "fan-11", "fan-12"]);
      // Only the case's two factory-fitted fans sit in it; everything else is loose on the bench.
      expect(state.parts.filter((part) => part.attachments.length > 0).map((part) => part.instanceId), id).toEqual(["fan-11", "fan-12"]);
      expect(state.cables.every((cable) => Object.values(cable.ends).every((to) => to === null)), id).toBe(true);
      expect(state.sidePanelOpen, id).toBe(true);
    }
  });

  it("PC: memory in A1 and A2 does not pass the memory step, even fully seated", () => {
    const lesson = lessonById("pc.beginner.first-build")!;
    const example = exampleOf(lesson);
    const index = lesson.steps.findIndex((step) => step.id === "seat-memory");
    const before = example.steps.slice(0, index).flatMap((step) => (step.solution.lab === "pc" ? step.solution.actions : []));
    const at = (mountPointId: string) => ({ hostInstanceId: "motherboard-2", mountPointId });
    const { state } = pc.replay([...startActions(lesson), ...before, { type: "mount_part", instanceId: "ram-4", target: at("dimm-a1") }, { type: "set_seating", instanceId: "ram-4", seating: "seated" }, { type: "mount_part", instanceId: "ram-5", target: at("dimm-a2") }, { type: "set_seating", instanceId: "ram-5", seating: "seated" }], pcCatalog);
    const result = checkStep(lesson.steps[index].check, { lab: "pc", state, catalog: pcCatalog });
    expect(result.passed).toBe(false);
    expect(result.lines.map((line) => line.passed)).toEqual([false, false]);
  });

  it("PC: the cooler step needs the pump block fastened, not only placed", () => {
    const lesson = lessonById("pc.beginner.first-build")!;
    const example = exampleOf(lesson);
    const index = lesson.steps.findIndex((step) => step.id === "cooler");
    const before = example.steps.slice(0, index).flatMap((step) => (step.solution.lab === "pc" ? step.solution.actions : []));
    const loose: PCAction[] = [
      { type: "mount_part", instanceId: "cooling-7", role: "block", target: { hostInstanceId: "motherboard-2", mountPointId: "cooler-mount" } },
      { type: "set_seating", instanceId: "cooling-7", role: "block", seating: "seated" },
    ];
    const { state } = pc.replay([...startActions(lesson), ...before, ...loose], pcCatalog);
    expect(checkStep(lesson.steps[index].check, { lab: "pc", state, catalog: pcCatalog }).passed).toBe(false);
  });

  it("PC fault: starts from a computer brought in for repair, a compatible mix of both sets, not an assembled starter", () => {
    const lesson = lessonById("pc.beginner.memory-fault")!;
    const { state } = pc.replay(startActions(lesson), pcCatalog);
    const used = state.parts.map((part) => part.catalogId).sort();
    for (const kit of pcStarterKits) {
      const kitParts = kit.actions.flatMap((action) => (action.type === "add_part" ? [action.catalogId] : [])).sort();
      expect(used, kit.id).not.toEqual(kitParts);
    }
    // Parts from both sets: the i5 of starter A on the DDR5 board and memory of starter B.
    expect(used).toEqual(expect.arrayContaining(["intel-core-i5-14600k", "asus-tuf-gaming-z790-plus-wifi", "corsair-vengeance-rgb-ddr5-6000-32gb-kit", "arctic-freezer-36"]));
    // Repaired, it is a working computer: the mix is genuinely compatible.
    const repaired = pc.replay([...startActions(lesson), { type: "set_seating", instanceId: "ram-5", seating: "seated" }, { type: "set_side_panel", open: false }, { type: "press_power" }], pcCatalog).state;
    expect(pc.evaluateStartup(repaired, pcCatalog).outcome).toBe("operational");
  });

  it("PC fault: the starting state really fails at the self-test with the power stage passing", () => {
    const { state } = pc.replay([...startActions(lessonById("pc.beginner.memory-fault")!), { type: "press_power" }], pcCatalog);
    const startup = pc.evaluateStartup(state, pcCatalog);
    expect(startup.stages.map((stage) => stage.status)).toEqual(["passed", "failed", "not_reached", "not_reached", "not_reached"]);
    expect(startup.stages[1].diagnostics.map((d) => d.code)).toEqual(["ram_partially_seated"]);
  });

  it("network: plugging the ONT into a LAN port does not pass the WAN step", () => {
    const lesson = lessonById("network.beginner.first-home-network")!;
    const state = network.replay([...startActions(lesson), { type: "connect_cable_end", cableId: "cable-2", endId: "a", to: { deviceId: "ont-1", portId: "eth" } }, { type: "connect_cable_end", cableId: "cable-2", endId: "b", to: { deviceId: "router-1", portId: "lan-1" } }]).state;
    expect(checkStep(lesson.steps[1].check, { lab: "network", state }).passed).toBe(false);
  });

  it("network: an address typed by hand does not pass the DHCP step, even with the cable right", () => {
    const lesson = lessonById("network.beginner.first-home-network")!;
    const example = exampleOf(lesson);
    const done = example.steps.slice(0, 3).flatMap((step) => (step.solution.lab === "network" ? step.solution.actions : []));
    const state = network.replay([...startActions(lesson), ...done, { type: "set_interface", deviceId: "pc-1", interface: "nic", config: { mode: "static", address: "192.168.1.50", mask: "255.255.255.0", gateway: "192.168.1.1" } }]).state;
    expect(checkStep(lesson.steps[2].check, { lab: "network", state }).passed).toBe(false);
  });

  it("network fault: the starting state reaches the phone but not the internet, and the engine names the gateway", () => {
    const { state } = network.replay(startActions(lessonById("network.beginner.wrong-gateway-fault")!));
    expect(network.runConnectivity(state, { kind: "ping", fromDeviceId: "pc-1", to: "192.168.1.100" }).succeeded).toBe(true);
    const outside = network.runConnectivity(state, { kind: "ping", fromDeviceId: "pc-1", to: "203.0.113.10" });
    expect(outside.succeeded).toBe(false);
    expect(outside.diagnostics[0].code).toBe("gateway_wrong");
  });
});
