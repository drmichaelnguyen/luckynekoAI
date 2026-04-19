"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { signIn } from "@/auth";

const LoginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
  redirectTo: z.string().max(2048).optional(),
});

export type LoginState = {
  error: string | null;
};

export async function loginAction(
  _prev: LoginState | undefined,
  formData: FormData,
): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    redirectTo: formData.get("redirectTo") || undefined,
  });

  if (!parsed.success) {
    return { error: "Use a valid email and password." };
  }

  const { email, password, redirectTo } = parsed.data;
  const normalized = email.toLowerCase().trim();
  const safePath = redirectTo?.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/";

  try {
    const result = await signIn("credentials", {
      email: normalized,
      password,
      redirect: false,
    });

    const failed =
      !result ||
      (typeof result === "object" &&
        (("error" in result && Boolean(result.error)) ||
          ("ok" in result && result.ok === false)));

    if (failed) {
      return { error: "Wrong email or password." };
    }
  } catch (error) {
    console.error("[login] signIn failed", error);
    return { error: "Could not sign in right now. Try again." };
  }

  redirect(safePath);
}
