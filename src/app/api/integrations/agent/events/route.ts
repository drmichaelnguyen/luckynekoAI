import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { verifyAgentRequest } from "@/lib/integrations/agent-auth";

const EventSchema = z.object({
  event_type: z.string().min(1),
  source_agent: z.string().min(1),
  user_id: z.string().optional(),
  user_email: z.string().email().optional(),
  trace_id: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
  status: z.string().optional(),
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
  const parsed = EventSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", detail: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data;
  const user = body.user_id
    ? await prisma.user.findUnique({ where: { id: body.user_id }, select: { id: true } })
    : body.user_email
      ? await prisma.user.findUnique({ where: { email: body.user_email }, select: { id: true } })
      : null;

  if (!user?.id) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const verified = await verifyAgentRequest({ request, rawBody, userId: user.id });
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: verified.status });
  }

  const idempotencyKey = request.headers.get("x-idempotency-key")?.trim();
  if (!idempotencyKey) {
    return NextResponse.json({ error: "Missing X-Idempotency-Key header" }, { status: 400 });
  }

  const existing = await prisma.agentIdempotencyKey.findUnique({
    where: {
      userId_endpoint_key: {
        userId: user.id,
        endpoint: "events",
        key: idempotencyKey,
      },
    },
    select: { responseJson: true },
  });
  if (existing) {
    return NextResponse.json(JSON.parse(existing.responseJson));
  }

  const event = await prisma.agentEvent.create({
    data: {
      userId: user.id,
      eventType: body.event_type,
      sourceAgent: body.source_agent,
      traceId: body.trace_id,
      payloadJson: JSON.stringify(body.payload ?? {}),
      status: body.status ?? "received",
    },
    select: { id: true, createdAt: true },
  });

  const response = { ok: true, event };
  await prisma.agentIdempotencyKey.create({
    data: {
      userId: user.id,
      endpoint: "events",
      key: idempotencyKey,
      responseJson: JSON.stringify(response),
    },
  });

  return NextResponse.json(response);
}
