import { LearningHome } from "@/components/learning/LearningHome";
import { getExecutionService } from "@/lib/server/execution/service";
import { isTutorAiConfigured } from "@/lib/server/tutor/providers";

export default function HomePage() {
  // Both are server settings: without them the page never calls the routes that would only answer 500.
  return <LearningHome aiConfigured={isTutorAiConfigured()} runnerConfigured={getExecutionService() !== null} />;
}
