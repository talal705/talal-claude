import { reviewCode } from "@/lib/server/code-review";
export const dynamic = "force-dynamic";
export function POST(request: Request) { return reviewCode(request); }
