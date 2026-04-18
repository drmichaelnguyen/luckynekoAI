import type { PrismaClient } from "@prisma/client";

/** Stale `prisma generate` / old schema (no `nickname`, etc.) throws this at query build time. */
export function isPrismaClientValidationError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: string }).name === "PrismaClientValidationError";
}

/** Persists nickname when the Prisma schema supports it; otherwise name only. */
export async function updateUserProfileNameAndNickname(
  db: PrismaClient,
  userId: string,
  input: { name: string | null; nickname: string | null },
): Promise<void> {
  try {
    await db.user.update({
      where: { id: userId },
      data: { name: input.name, nickname: input.nickname },
    });
  } catch (e) {
    if (!isPrismaClientValidationError(e)) throw e;
    await db.user.update({
      where: { id: userId },
      data: { name: input.name },
    });
  }
}

export async function findUserNameAndNicknameById(
  db: PrismaClient,
  userId: string,
): Promise<{ name: string | null; nickname: string | null } | null> {
  try {
    return await db.user.findUnique({
      where: { id: userId },
      select: { name: true, nickname: true },
    });
  } catch (e) {
    if (!isPrismaClientValidationError(e)) throw e;
    const row = await db.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return row ? { name: row.name, nickname: null } : null;
  }
}

export async function findUserForCredentialsByEmail(
  db: PrismaClient,
  email: string,
): Promise<{
  id: string;
  email: string;
  name: string | null;
  nickname: string | null;
  passwordHash: string;
  avatarRelativePath: string | null;
} | null> {
  try {
    return await db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        nickname: true,
        passwordHash: true,
        avatarRelativePath: true,
      },
    });
  } catch (e) {
    if (!isPrismaClientValidationError(e)) throw e;
    const row = await db.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, passwordHash: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      nickname: null,
      passwordHash: row.passwordHash,
      avatarRelativePath: null,
    };
  }
}

export async function findUserProfileById(
  db: PrismaClient,
  userId: string,
): Promise<{
  name: string | null;
  nickname: string | null;
  email: string;
  avatarRelativePath: string | null;
} | null> {
  try {
    return await db.user.findUnique({
      where: { id: userId },
      select: { name: true, nickname: true, email: true, avatarRelativePath: true },
    });
  } catch (e) {
    if (!isPrismaClientValidationError(e)) throw e;
    const row = await db.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    if (!row) return null;
    return {
      name: row.name,
      nickname: null,
      email: row.email,
      avatarRelativePath: null,
    };
  }
}

export async function findUserForLedgerBackupHeader(
  db: PrismaClient,
  userId: string,
): Promise<{
  preferredCurrency: string;
  onboardingCompleted: boolean;
  name: string | null;
  nickname: string | null;
}> {
  try {
    const row = await db.user.findUnique({
      where: { id: userId },
      select: { preferredCurrency: true, onboardingCompleted: true, name: true, nickname: true },
    });
    if (!row) throw new Error("User not found");
    return row;
  } catch (e) {
    if (!isPrismaClientValidationError(e)) throw e;
    const row = await db.user.findUnique({
      where: { id: userId },
      select: { preferredCurrency: true, onboardingCompleted: true, name: true },
    });
    if (!row) throw new Error("User not found");
    return { ...row, nickname: null };
  }
}
