import crypto from "crypto";

import { prisma } from "@/lib/prisma";

const MAX_SKEW_SECONDS = 5 * 60;

export function isAgentAuthorized(request: Request): boolean {
  const secret = process.env.INTEGRATION_SHARED_SECRET?.trim();
  if (!secret) return false;

  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return false;
  const token = auth.slice(7).trim();
  return token.length > 0 && token === secret;
}

export async function verifyAgentRequest(args: {
  request: Request;
  rawBody: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!isAgentAuthorized(args.request)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const secret = process.env.INTEGRATION_SHARED_SECRET?.trim();
  if (!secret) {
    return { ok: false, status: 500, error: "Integration secret not configured" };
  }

  const timestampRaw = args.request.headers.get("x-agent-timestamp")?.trim();
  const nonce = args.request.headers.get("x-agent-nonce")?.trim();
  const providedSignature = args.request.headers.get("x-agent-signature")?.trim();
  if (!timestampRaw || !nonce || !providedSignature) {
    return { ok: false, status: 400, error: "Missing signature headers" };
  }

  const timestamp = Number.parseInt(timestampRaw, 10);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, status: 400, error: "Invalid timestamp" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > MAX_SKEW_SECONDS) {
    return { ok: false, status: 401, error: "Request timestamp expired" };
  }

  const signed = `${timestampRaw}.${nonce}.${args.rawBody}`;
  const expectedSignature = crypto.createHmac("sha256", secret).update(signed).digest("hex");
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return { ok: false, status: 401, error: "Invalid request signature" };
  }

  try {
    await prisma.agentRequestNonce.create({
      data: {
        userId: args.userId,
        nonce,
        expiresAt: new Date((timestamp + MAX_SKEW_SECONDS) * 1000),
      },
    });
  } catch {
    return { ok: false, status: 409, error: "Replay detected for nonce" };
  }

  return { ok: true };
}
