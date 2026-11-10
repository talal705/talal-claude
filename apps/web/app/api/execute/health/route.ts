// GET /api/execute/health — whether the runner is reachable and which toolchains it has.
import { withExecutionService } from "@/lib/server/execution/service";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return withExecutionService((service) => service.health());
}
