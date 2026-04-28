import type { Session } from "next-auth";

const DEFAULT_ADMIN_EMAILS = ["dr.trongto@gmail.com"];

function configuredAdminEmails(): string[] {
  const fromEnv = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set([...DEFAULT_ADMIN_EMAILS, ...fromEnv]));
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return configuredAdminEmails().includes(email.trim().toLowerCase());
}

export function resolveUserRole(input: {
  email?: string | null;
  role?: string | null;
}): string {
  if (isAdminEmail(input.email)) return "admin";
  return input.role ?? "user";
}

export function hasAdminAccess(session: Session | null): boolean {
  if (!session?.user?.id) return false;
  return resolveUserRole({
    email: session.user.email,
    role: session.user.role,
  }) === "admin";
}
