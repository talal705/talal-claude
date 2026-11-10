// GET /api/execute/:id — status, and the result once finished; `?wait=1` holds the answer until then.
// DELETE /api/execute/:id — Stop. Both answer 404 for a job of another session.
import { withExecutionService } from "@/lib/server/execution/service";

export const dynamic = "force-dynamic";
// A waiting request is held up to 25 s.
export const maxDuration = 60;

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const { id } = await params;
  return withExecutionService((service) => service.get(request, id));
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const { id } = await params;
  return withExecutionService((service) => service.stop(request, id));
}
