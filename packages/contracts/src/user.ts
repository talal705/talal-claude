import type { LabType, DifficultyLevel } from "./common";

export interface UserProfile {
  id: string;
  isGuest: boolean;
  displayName?: string;
  locale: "en" | "ar";
  createdAt: string;
}

export interface UserProgress {
  userId: string;
  lab: LabType;
  currentLevel: DifficultyLevel;
  completedLessons: string[];
  completedExercises: string[];
  hintsUsed: Record<string, number>;
  attemptHistory: AttemptRecord[];
  lastActivity: string;
}

export interface AttemptRecord {
  lessonId: string;
  exerciseId: string;
  timestamp: string;
  success: boolean;
  hintsUsed: number;
  diagnosticReasoning: boolean;
  independentCompletion: boolean;
  duration: number;
}
