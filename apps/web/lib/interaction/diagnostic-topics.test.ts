import { describe, expect, it } from "vitest";
import { pcTarget, type PCDiagnostic, type StageResult } from "@ytl/contracts";
import { isValidTargetId } from "@/lib/targets/registry";
import {
  MAX_TOPICS,
  topicFromPCDiagnostic,
  topicsFromPCDiagnostics,
  topicsFromStartup,
} from "./diagnostic-topics";
import { isTopicStale } from "./hint-ladder";

const atx = { ...pcTarget.port({ kind: "part", instanceId: "motherboard-1", portId: "atx-24" }), projectRevision: 7, executionId: "start-3" };

function pcDiagnostic(over: Partial<PCDiagnostic> = {}): PCDiagnostic {
  return {
    id: "storage_missing:build",
    code: "storage_missing",
    class: "startup_fault",
    severity: "blocking",
    message: { en: "The 24-pin power cable is not connected to the motherboard.", ar: "سلك الطاقة 24 بن مو موصّل باللوحة الأم." },
    explanation: { en: "The motherboard gets its main power through the 24-pin connector.", ar: "اللوحة الأم تاخذ طاقتها الرئيسية من موصّل 24 بن." },
    evidence: [],
    target: atx,
    relatedTargets: [],
    ...over,
  };
}

describe("topic from a PCDiagnostic", () => {
  it("maps observation, message and explanation to levels 1, 2 and 3 and points from level 2", () => {
    const observation = { en: "Nothing happens when you press the power button.", ar: "ما يصير شي لما تضغط زر التشغيل." };
    const diagnostic = pcDiagnostic({ observation });
    const topic = topicFromPCDiagnostic(diagnostic);
    expect(topic.id).toBe("pc:storage_missing:build");
    expect(topic.levels[0]).toEqual({ text: observation });
    expect(topic.levels[1]).toEqual({ text: diagnostic.message, target: atx });
    expect(topic.levels[2]).toEqual({ text: diagnostic.explanation, target: atx });
    expect(topic.title).toEqual({ key: "hints.pc.class.startup_fault" });
    expect(topic.source).toBe("rule_based");
  });

  it("level 1 never names the cause: it falls back to the stage observation, then to a general question", () => {
    const stage = { en: "The fans spin but the screen stays black.", ar: "المراوح تدور بس الشاشة سودا." };
    expect(topicFromPCDiagnostic(pcDiagnostic(), stage).levels[0]).toEqual({ text: stage });
    expect(topicFromPCDiagnostic(pcDiagnostic()).levels[0]).toEqual({ text: { key: "hints.generic.symptom" } });
    expect(topicFromPCDiagnostic(pcDiagnostic()).levels[0].target).toBeUndefined();
  });

  it("is tied to the revision and run stamped on the target", () => {
    const topic = topicFromPCDiagnostic(pcDiagnostic());
    expect(topic.madeFor).toEqual({ projectRevision: 7, executionId: "start-3" });
    expect(isTopicStale(topic, { projectRevision: 7, executionId: "start-3" })).toBe(false);
    expect(isTopicStale(topic, { projectRevision: 8, executionId: "start-3" })).toBe(true);
    expect(isTopicStale(topic, { projectRevision: 7, executionId: "start-4" })).toBe(true);
  });

  it("an assembly diagnostic without an execution stamp stays valid across startup runs of the same revision", () => {
    const ram = { ...pcTarget.part("ram-1"), projectRevision: 7 };
    const topic = topicFromPCDiagnostic(pcDiagnostic({ id: "cable_end_loose:ram-1", class: "assembly", target: ram }));
    expect(isTopicStale(topic, { projectRevision: 7, executionId: "start-9" })).toBe(false);
    expect(isTopicStale(topic, { projectRevision: 8 })).toBe(true);
  });

  it("startup result: failed-stage faults first with their stage observation, then advisories by severity, no duplicates", () => {
    const observation = { en: "No lights, no fans.", ar: "لا أنوار ولا مراوح." };
    const stages = [
      { stage: "power", status: "failed", observation, diagnostics: [pcDiagnostic()] },
    ] as unknown as StageResult[];
    const advisories = [
      pcDiagnostic({ id: "cable_untidy:psu-1", class: "optional_improvement", severity: "info" }),
      pcDiagnostic({ id: "ram_single_module:build", class: "assembly", severity: "warning" }),
      pcDiagnostic(),
    ];
    const topics = topicsFromStartup({ stages, advisories });
    expect(topics.map((topic) => topic.id)).toEqual(["pc:storage_missing:build", "pc:ram_single_module:build", "pc:cable_untidy:psu-1"]);
    expect(topics[0].levels[0]).toEqual({ text: observation });
  });

  it("a list of diagnostics is ordered blocking, warning, info and capped", () => {
    const many = Array.from({ length: 30 }, (_, index) => pcDiagnostic({ id: `side_panel_open:${index}`, severity: index === 29 ? "blocking" : "info" }));
    const topics = topicsFromPCDiagnostics(many);
    expect(topics).toHaveLength(MAX_TOPICS);
    expect(topics[0].id).toBe("pc:side_panel_open:29");
  });
});

