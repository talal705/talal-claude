// GET /api/tutor/status — whether an AI provider is configured. Never calls the provider.
import { withTutorService } from "@/lib/server/tutor/instance";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return withTutorService((service) => service.status());
}
