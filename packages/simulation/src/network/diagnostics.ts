// Builders for NetworkDiagnostic values. One place words each fault, so a failed ping and the
// standing check of a topology report the same fault the same way.
import {
  networkTarget,
  type Localized,
  type NetworkDevice,
  type NetworkDiagnostic,
  type NetworkDiagnosticCode,
  type NetworkEvaluationContext,
  type NetworkEvidence,
  type TutorTargetRef,
} from "@ytl/contracts";
import { L, fill } from "./text";

export type Stamp = (ref: TutorTargetRef) => TutorTargetRef;

export function stamper(context: NetworkEvaluationContext = {}): Stamp {
  return (ref) => ({
    ...ref,
    ...(context.projectRevision !== undefined ? { projectRevision: context.projectRevision } : {}),
    ...(context.executionId !== undefined ? { executionId: context.executionId } : {}),
  });
}

export interface DiagnosticInput {
  code: NetworkDiagnosticCode;
  /** What the fault is about; makes the ID stable (`<code>:<subject>`). */
  subject: string;
  severity?: NetworkDiagnostic["severity"];
  observation?: Localized;
  message: Localized;
  explanation: Localized;
  evidence?: NetworkEvidence[];
  target: TutorTargetRef;
  related?: TutorTargetRef[];
}

export function diagnostic(input: DiagnosticInput, stamp: Stamp): NetworkDiagnostic {
  return {
    id: `${input.code}:${input.subject}`,
    code: input.code,
    severity: input.severity ?? "blocking",
    ...(input.observation ? { observation: input.observation } : {}),
    message: input.message,
    explanation: input.explanation,
    evidence: input.evidence ?? [],
    target: stamp(input.target),
    relatedTargets: (input.related ?? []).map(stamp),
  };
}

export const evidence = (en: string, ar: string, observed: string, expected?: string): NetworkEvidence => ({
  label: L(en, ar),
  observed,
  ...(expected !== undefined ? { expected } : {}),
});

/** A rejected action. */
export function rejection(code: NetworkDiagnosticCode, subject: string, message: Localized, target: TutorTargetRef): NetworkDiagnostic {
  return diagnostic({ code, subject, message, explanation: message, target }, (ref) => ref);
}

export const unknownDevice = (deviceId: string): NetworkDiagnostic =>
  rejection("unknown_reference", deviceId, fill(L("There is no device {id} in this network.", "ما في جهاز {id} في هذي الشبكة."), { id: deviceId }), networkTarget.device(deviceId));

export const SYMPTOM = {
  noReply: L("The ping gets no reply.", "البنق ما يجيه رد."),
  noAddress: L("This device has no address, so it cannot talk to anything.", "هذا الجهاز ما عنده عنوان، فما يقدر يكلّم أحد."),
  nameFails: L("The name does not open, even though the network may be fine.", "الاسم ما يفتح، مع إن الشبكة ممكن تكون سليمة."),
  localOnly: L("Devices at home answer, but nothing outside does.", "أجهزة البيت ترد، بس اللي برّا ما يرد."),
};

export const nameOf = (device: NetworkDevice): Localized => device.name;
