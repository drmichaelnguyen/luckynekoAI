"use server";

import { hash, compare } from "bcryptjs";
import { z } from "zod";

import { auth } from "@/auth";
import { removeAvatarFiles, writeAvatarFromUpload } from "@/lib/media/avatar-storage";
import { prisma } from "@/lib/prisma";
import { findUserProfileById, updateUserProfileNameAndNickname } from "@/lib/prisma/user-select-compat";

export type ProfileState = { ok: boolean; error: string | null; message: string | null };

export async function getProfileAction(): Promise<
  | { ok: true; name: string; nickname: string; email: string; hasAvatar: boolean }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized." };

  const u = await findUserProfileById(prisma, session.user.id);
  if (!u) return { ok: false, error: "User not found." };

  return {
    ok: true,
    name: u.name ?? "",
    nickname: u.nickname ?? "",
    email: u.email,
    hasAvatar: Boolean(u.avatarRelativePath),
  };
}

export async function updateProfileAction(
  _prev: ProfileState | undefined,
  formData: FormData,
): Promise<ProfileState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized.", message: null };

  const name = typeof formData.get("name") === "string" ? formData.get("name")!.trim() : "";
  const nickname = typeof formData.get("nickname") === "string" ? formData.get("nickname")!.trim() : "";
  if (name.length > 120 || nickname.length > 80) {
    return { ok: false, error: "Name or nickname is too long.", message: null };
  }

  await updateUserProfileNameAndNickname(prisma, session.user.id, {
    name: name || null,
    nickname: nickname || null,
  });

  return { ok: true, error: null, message: "Profile saved." };
}

const PasswordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(128),
  confirmPassword: z.string().min(8).max(128),
});

export async function changePasswordAction(
  _prev: ProfileState | undefined,
  formData: FormData,
): Promise<ProfileState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized.", message: null };

  const parsed = PasswordChangeSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { ok: false, error: "New password must be at least 8 characters.", message: null };
  }
  const { currentPassword, newPassword, confirmPassword } = parsed.data;
  if (newPassword !== confirmPassword) {
    return { ok: false, error: "New password and confirmation do not match.", message: null };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });
  if (!user?.passwordHash) {
    return { ok: false, error: "Password change is not available for this account.", message: null };
  }

  const valid = await compare(currentPassword, user.passwordHash);
  if (!valid) {
    return { ok: false, error: "Current password is incorrect.", message: null };
  }

  const passwordHash = await hash(newPassword, 12);
  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash },
  });

  return { ok: true, error: null, message: "Password updated." };
}

export async function uploadAvatarAction(formData: FormData): Promise<ProfileState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized.", message: null };

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image file.", message: null };
  }

  const mime = file.type || "";
  if (!mime.startsWith("image/") || mime === "image/svg+xml") {
    return { ok: false, error: "Use a JPG, PNG, WebP, or HEIC photo (not SVG).", message: null };
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const relativePath = await writeAvatarFromUpload(session.user.id, buf);
    await prisma.user.update({
      where: { id: session.user.id },
      data: { avatarRelativePath: relativePath },
    });
    return { ok: true, error: null, message: "Avatar updated." };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not process image.";
    return { ok: false, error: msg, message: null };
  }
}

export async function removeAvatarAction(): Promise<ProfileState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized.", message: null };

  await removeAvatarFiles(session.user.id);
  await prisma.user.update({
    where: { id: session.user.id },
    data: { avatarRelativePath: null },
  });
  return { ok: true, error: null, message: "Avatar removed." };
}
