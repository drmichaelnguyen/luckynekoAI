"use server";

import { hash } from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";

import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";

const RegisterSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  redirectTo: z.string().max(2048).optional(),
});

export type RegisterState = { error: string | null };

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
    return {
      error:
        fe.email?.[0] ??
        fe.password?.[0] ??
        "Use a valid email and a password of at least 8 characters.",
    };
  }

  const { email, password, redirectTo } = parsed.data;
  const normalized = email.toLowerCase().trim();
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
      return { error: "An account with this email already exists." };
    }
    return { error: "Could not create account. Try again." };
  }

  const signInResult = await signIn("credentials", {
    email: normalized,
    password,
    redirect: false,
  });

  const signInFailed =
    signInResult &&
    typeof signInResult === "object" &&
    (("error" in signInResult && Boolean(signInResult.error)) ||
      ("ok" in signInResult && signInResult.ok === false));

  if (signInFailed) {
    return { error: "Account created — please sign in." };
  }

  const safePath = redirectTo?.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/";
  redirect(safePath);
}
