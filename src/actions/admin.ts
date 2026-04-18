"use server";

import { hash } from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    throw new Error("Unauthorized");
  }
  return session.user.id;
}

export async function listUsersAction(): Promise<
  { id: string; email: string; name: string | null; role: string; createdAt: string }[]
> {
  await requireAdmin();
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }));
}

export async function resetUserPasswordAction(
  targetUserId: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  if (!newPassword || newPassword.length < 4) {
    return { ok: false, error: "Password must be at least 4 characters" };
  }
  const passwordHash = await hash(newPassword, 12);
  await prisma.user.update({ where: { id: targetUserId }, data: { passwordHash } });
  return { ok: true };
}

export async function setUserRoleAction(
  targetUserId: string,
  role: "user" | "admin",
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  await prisma.user.update({ where: { id: targetUserId }, data: { role } });
  return { ok: true };
}
