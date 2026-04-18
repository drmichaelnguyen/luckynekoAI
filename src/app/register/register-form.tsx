"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { registerAction, type RegisterState } from "@/actions/register";
import { LuckyNekoMascot } from "@/components/mascot/lucky-neko";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function RegisterSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Creating account…" : "Create account"}
    </Button>
  );
}

export function RegisterForm() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/";
  const safeFrom = from.startsWith("/") && !from.startsWith("//") ? from : "/";
  const [state, formAction] = useActionState(registerAction, { error: null } satisfies RegisterState);

  const loginHref =
    safeFrom !== "/" ? `/login?from=${encodeURIComponent(safeFrom)}` : "/login";

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-amber-50/80 to-background px-4 py-10 dark:from-amber-950/20">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 ring-1 ring-amber-200/80 dark:bg-amber-950/40 dark:ring-amber-800/60">
          <LuckyNekoMascot variant="hero" celebrateOnMount />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          One email, one password — your lucky cat treasurer stays private to you.
        </p>
      </div>

      <form
        action={formAction}
        className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-6 shadow-sm"
      >
        <input type="hidden" name="redirectTo" value={safeFrom} />
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            placeholder="At least 8 characters"
            minLength={8}
          />
        </div>
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
        <RegisterSubmit />
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href={loginHref} className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
