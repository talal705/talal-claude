import type { Localized } from "./common";
import type { TutorTargetRef } from "./platform";

export type HelpLevel = 1 | 2 | 3;

export interface TutorHint {
  level: HelpLevel;
  message: Localized;
  targetId?: string;
  showExample?: boolean;
}

export interface TutorContext {
  lab: "pc" | "network" | "code";
  lessonId?: string;
  exerciseId?: string;
  projectRevision: number;
  executionId?: string;
  currentState: Record<string, unknown>;
  diagnostics: string[];
  hintsGivenThisSession: number;
}

export interface TutorResponse {
  hint: TutorHint;
  targets: TutorTargetRef[];
  isAIGenerated: boolean;
  confidence: "certain" | "likely" | "possible";
}

export interface TutorProviderConfig {
  provider: "anthropic" | "openai" | "rule_based";
  model?: string;
  maxContextTokens: number;
  rateLimitPerMinute: number;
}

export interface RuleBasedHint {
  id: string;
  condition: HintCondition;
  hints: [TutorHint, TutorHint, TutorHint];
}

export interface HintCondition {
  lab: "pc" | "network" | "code";
  errorType?: string;
  partCategory?: string;
  codeTrack?: string;
  diagnosticPattern?: string;
}
