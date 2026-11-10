// POST /api/tutor/ask — the learner's question with the hints on screen (TutorAskRequest); a
// validated answer comes back (TutorAskResponse). Without a provider it answers
// `{ status: "not_configured" }` and the page keeps its rule-based hints.
import { withTutorService } from "@/lib/server/tutor/instance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function POST(request: Request): Promise<Response> {
  return withTutorService((service) => service.ask(request));
}
