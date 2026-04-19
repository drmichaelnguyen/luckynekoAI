import "server-only";

import { hash as hashPassword } from "bcryptjs";
import crypto from "crypto";

import { prisma } from "@/lib/prisma";
import { isMailConfigured, sendEmail } from "@/lib/email";

const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MS = 1000 * 60 * 60;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getBaseUrl(): string {
  return process.env.AUTH_URL?.trim() || "http://localhost:3200";
}

function buildResetUrl(token: string): string {
  return new URL(`/reset-password?token=${encodeURIComponent(token)}`, getBaseUrl()).toString();
}

export async function issuePasswordReset(email: string): Promise<void> {
  const normalized = email.toLowerCase().trim();
  if (!normalized) return;

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, email: true, name: true },
  });

  if (!user) return;

  const token = crypto.randomBytes(RESET_TOKEN_BYTES).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await prisma.passwordResetToken.deleteMany({
    where: { userId: user.id },
  });

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  const resetUrl = buildResetUrl(token);
  const recipientName = user.name?.trim() || user.email.split("@")[0] || "there";

  if (!isMailConfigured()) {
    console.warn(`[password-reset] SMTP not configured; reset link for ${user.email}: ${resetUrl}`);
    return;
  }

  const subject = "Reset your NekoZeni password";
  const text =
    `Hi ${recipientName},\n\n` +
    `We received a request to reset your NekoZeni password.\n\n` +
    `Reset it here: ${resetUrl}\n\n` +
    `This link expires in 1 hour. If you did not request this, you can ignore this email.`;
  const html =
    `<p>Hi ${recipientName},</p>` +
    `<p>We received a request to reset your NekoZeni password.</p>` +
    `<p><a href="${resetUrl}">Reset your password</a></p>` +
    `<p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>`;

  await sendEmail({
    to: user.email,
    subject,
    text,
    html,
  });
}

export async function getPasswordResetTokenState(token: string): Promise<"invalid" | "valid"> {
  const normalized = token.trim();
  if (!normalized) return "invalid";

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(normalized) },
    select: { expiresAt: true, usedAt: true },
  });

  if (!record) return "invalid";
  if (record.usedAt) return "invalid";
  if (record.expiresAt.getTime() <= Date.now()) return "invalid";
  return "valid";
}

export async function consumePasswordResetToken(token: string, nextPassword: string): Promise<boolean> {
  const normalized = token.trim();
  if (!normalized) return false;

  const tokenHash = hashToken(normalized);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record) return false;
  if (record.usedAt) return false;
  if (record.expiresAt.getTime() <= Date.now()) return false;

  const passwordHash = await hashPassword(nextPassword, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.deleteMany({
      where: {
        userId: record.userId,
        id: { not: record.id },
      },
    }),
  ]);

  return true;
}
