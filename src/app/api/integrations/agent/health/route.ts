import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyAgentRequest } from "@/lib/integrations/agent-auth";
import { prisma } from "@/lib/prisma";

const HealthSchema = z.object({
  trace_id: z.string().min(1),
  user_id: z.string().min(1),
});

export async function POST(request: Request) {
  const rawBody = await request.text();
  const json = (() => {
    try {
      return rawBody ? JSON.parse(rawBody) : null;
    } catch {
      return null;
    }
  })();

  const parsed = HealthSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", detail: parsed.error.flatten() }, { status: 400 });
  }

  const userId = request.headers.get("x-agent-user-id")?.trim() || parsed.data.user_id;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user?.id) {
    return NextResponse.json({ error: "User not found for health check" }, { status: 404 });
  }
  const verified = await verifyAgentRequest({ request, rawBody, userId: user.id });
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: verified.status });
  }

  return NextResponse.json({
    ok: true,
    service: "luckyneko-integration",
    trace_id: parsed.data.trace_id,
    signed_auth: true,
  });
}
