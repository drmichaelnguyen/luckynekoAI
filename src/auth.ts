import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { findUserForCredentialsByEmail } from "@/lib/prisma/user-select-compat";

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;

        const normalized = email.toLowerCase().trim();
        if (!normalized || !password) return null;

        const user = await findUserForCredentialsByEmail(prisma, normalized);
        if (!user?.passwordHash) return null;

        const valid = await compare(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? user.email.split("@")[0] ?? "Friend",
          nickname: user.nickname,
          role: user.role,
          image: user.avatarRelativePath ? "/api/user/avatar" : undefined,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.sub = user.id;
        token.email = user.email;
        if (user.name) token.name = user.name;
        const u = user as { nickname?: string | null; image?: string | null; role?: string | null };
        token.nickname = u.nickname ?? null;
        token.picture = u.image ?? undefined;
        token.role = u.role ?? "user";
      }
      if (trigger === "update" && session && typeof session === "object") {
        const s = session as {
          name?: string | null;
          nickname?: string | null;
          image?: string | null;
        };
        if (s.name !== undefined) token.name = s.name ?? undefined;
        if (s.nickname !== undefined) token.nickname = s.nickname ?? null;
        if (s.image !== undefined) token.picture = s.image ?? undefined;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        if (token.email) session.user.email = token.email as string;
        if (typeof token.name === "string") session.user.name = token.name;
        session.user.nickname = (token.nickname as string | null | undefined) ?? null;
        session.user.role = (token.role as string | null | undefined) ?? "user";
        session.user.image =
          typeof token.picture === "string" && token.picture.length > 0 ? token.picture : undefined;
      }
      return session;
    },
  },
});
