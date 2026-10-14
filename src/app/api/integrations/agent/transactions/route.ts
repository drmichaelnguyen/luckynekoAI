import { NextResponse } from "next/server";
import { z } from "zod";

import { ensureFinanceSeed } from "@/lib/finance/seed";
import { persistFreeformLedgerEntry } from "@/lib/finance/persist-from-chat";
import { verifyAgentRequest } from "@/lib/integrations/agent-auth";
import { prisma } from "@/lib/prisma";

const TransactionSchema = z.object({
  user_id: z.string().optional(),
  user_email: z.string().email().optional(),
  trace_id: z.string().min(1),
  description: z.string().optional().default("Agent transaction"),
  amount: z.number(),
  currency: z.string().optional().default("CAD"),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
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
  const parsed = TransactionSchema.safeParse(json);
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
        endpoint: "transactions",
        key: idempotencyKey,
      },
    },
    select: { responseJson: true },
  });
  if (existing) {
    return NextResponse.json(JSON.parse(existing.responseJson));
  }

  await ensureFinanceSeed(prisma, user.id);

  const amount = Math.abs(body.amount);
  const direction = body.amount >= 0 ? "out" : "in";
  const entry = {
    amount,
    direction,
    currency: body.currency,
    merchant: body.description,
    notes: body.description,
    occurredAt: new Date().toISOString(),
    ...body.metadata,
  } as Record<string, unknown>;

  const persisted = await persistFreeformLedgerEntry(
    prisma,
    user.id,
    entry,
    JSON.stringify({
      source: "agent_api",
      traceId: body.trace_id,
      metadata: body.metadata,
    }),
  );

  if (!persisted.saved) {
    return NextResponse.json({ ok: false, detail: persisted.detail }, { status: 400 });
  }

  const response = {
    ok: true,
    transactionId: persisted.transactionId,
    detail: persisted.detail,
  };
  await prisma.agentIdempotencyKey.create({
    data: {
      userId: user.id,
      endpoint: "transactions",
      key: idempotencyKey,
      responseJson: JSON.stringify(response),
    },
  });

  return NextResponse.json(response);
}
