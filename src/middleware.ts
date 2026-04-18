import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function isPublicPath(pathname: string) {
  if (pathname === "/manifest.json" || pathname === "/favicon.ico") return true;
  const publicPrefixes = ["/login", "/register", "/api/auth", "/share"];
  return publicPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/_next") || pathname.startsWith("/icons/")) {
    return NextResponse.next();
  }

  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    secureCookie: process.env.NODE_ENV === "production",
  });

  const isAuthed = Boolean(token);

  if (!isAuthed && !isPublicPath(pathname)) {
    const login = new URL("/login", req.url);
    const returnTo = `${pathname}${req.nextUrl.search}`;
    login.searchParams.set("from", returnTo);
    return NextResponse.redirect(login);
  }

  if (isAuthed && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|icons/|manifest\\.json|favicon\\.ico|sw\\.js|workbox|fallback-|worker-).*)",
  ],
};
