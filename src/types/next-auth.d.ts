import type { DefaultSession } from "next-auth";

declare module "next-auth/jwt" {
  interface JWT {
    nickname?: string | null;
  }
}

declare module "next-auth" {
  interface User {
    nickname?: string | null;
  }
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      /** Chat-style short name; assistant should use this when set. */
      nickname?: string | null;
    };
  }
}
