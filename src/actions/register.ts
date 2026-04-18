"use server";

import { hash } from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";

import { signIn } from "@/auth";
import type { RegisterErrorKey } from "@/lib/i18n/register-errors";
import { prisma } from "@/lib/prisma";

const RegisterSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  redirectTo: z.string().max(2048).optional(),
});

export type RegisterState = { errorKey: RegisterErrorKey | null };

export async function registerAction(
  _prev: RegisterState | undefined,
  formData: FormData,
): Promise<RegisterState> {
  const parsed = RegisterSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    redirectTo: formData.get("redirectTo") || undefined,
  });

  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    if (fe.email?.[0]) return { errorKey: "validation_email" };
    if (fe.password?.[0]) return { errorKey: "validation_password" };
    return { errorKey: "validation_default" };
  }

  const { email, password, redirectTo } = parsed.data;
  const normalized = email.toLowerCase().trim();

  if (!process.env.AUTH_SECRET?.trim()) {
    return { errorKey: "auth_secret_missing" };
  }

  const passwordHash = await hash(password, 12);

  try {
    await prisma.user.create({
      data: {
        email: normalized,
        passwordHash,
        name: normalized.split("@")[0],
        onboardingCompleted: false,
        preferredCurrency: "CAD",
      },
    });
  } catch (e: unknown) {
    const code = typeof e === "object" && e !== null && "code" in e ? (e as { code?: string }).code : undefined;
    if (code === "P2002") {
      return { errorKey: "duplicate_email" };
    }
    if (process.env.NODE_ENV === "development") {
      console.error("[register] prisma.user.create failed", e);
    }
    return { errorKey: "create_failed" };
  }

  let signInResult: Awaited<ReturnType<typeof signIn>>;
  try {
    signInResult = await signIn("credentials", {
      email: normalized,
      password,
      redirect: false,
    });
  } catch (e: unknown) {
    if (process.env.NODE_ENV === "development") {
      console.error("[register] signIn threw after user create", e);
    }
    return { errorKey: "signin_autocreate_failed" };
  }

  const signInFailed =
    signInResult &&
    typeof signInResult === "object" &&
    (("error" in signInResult && Boolean(signInResult.error)) ||
      ("ok" in signInResult && signInResult.ok === false));

  if (signInFailed) {
    return { errorKey: "signin_manual" };
  }

  const safePath = redirectTo?.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/";
  redirect(safePath);
}
