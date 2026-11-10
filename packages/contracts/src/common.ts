export type Locale = "en" | "ar";

export interface Localized {
  en: string;
  ar: string;
}

export type LabType = "pc" | "network" | "code";
export type LabMode = "learn" | "free" | "test";
export type DifficultyLevel = "beginner" | "intermediate" | "advanced" | "expert";

export interface ValidationResult {
  valid: boolean;
  errors: DiagnosticEntry[];
  warnings: DiagnosticEntry[];
}

export interface DiagnosticEntry {
  id: string;
  severity: "error" | "warning" | "info";
  category: DiagnosticCategory;
  message: Localized;
  details?: Localized;
  targetId?: string;
}

export type DiagnosticCategory =
  | "impossible_fit"
  | "missing_connection"
  | "incorrect_assembly"
  | "startup_fault"
  | "operating_fault"
  | "optional_improvement"
  | "network_fault"
  | "code_error"
  | "compatibility";
