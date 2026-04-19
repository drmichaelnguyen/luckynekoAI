"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { consumePasswordResetToken, issuePasswordReset } from "@/lib/password-reset";

const ForgotPasswordSchema = z.object({
  email: z.string().email().max(255),
});

const ResetPasswordSchema = z
  .object({
    token: z.string().min(1).max(512),
    password: z.string().min(8).max(128),
    confirmPassword: z.string().min(8).max(128),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type ForgotPasswordState = {
  error: string | null;
  message: string | null;
};

export type ResetPasswordState = {
  error: string | null;
};

export async function requestPasswordResetAction(
  _prev: ForgotPasswordState | undefined,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = ForgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { error: "Enter a valid email address.", message: null };
  }

  try {
    await issuePasswordReset(parsed.data.email);
  } catch (error) {
    console.error("[password-reset] failed to issue reset", error);
    return {
      error: "Could not send the reset email right now. Check SMTP settings and try again.",
      message: null,
    };
  }

  return {
    error: null,
    message: "If that email exists, we sent a password reset link.",
  };
}

export async function resetPasswordAction(
  _prev: ResetPasswordState | undefined,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = ResetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      error:
        fieldErrors.confirmPassword?.[0] ||
        fieldErrors.password?.[0] ||
        fieldErrors.token?.[0] ||
        "Could not reset password.",
    };
  }

  const ok = await consumePasswordResetToken(parsed.data.token, parsed.data.password);
  if (!ok) {
    return { error: "This reset link is invalid or expired." };
  }

  redirect("/login?reset=success");
}
