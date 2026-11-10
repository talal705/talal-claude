// POST /api/execute — submit a program for a server track. Answers 202 with a JobSnapshot.
import { withExecutionService } from "@/lib/server/execution/service";

export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return withExecutionService((service) => service.submit(request));
}
