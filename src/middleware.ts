import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function isPublicPath(pathname: string) {
  if (pathname === "/manifest.json" || pathname === "/favicon.ico") return true;
  const publicPrefixes = [
    "/login",
    "/login-basic",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/guide",
    "/api/auth",
    "/api/integrations/agent",
    "/api/locale",
    "/share",
  ];
  return publicPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function redirectUrl(req: NextRequest, pathname: string) {
  const baseUrl = process.env.AUTH_URL?.trim() || req.nextUrl.origin;
  return new URL(pathname, baseUrl);
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

  // #region agent log
  if (req.method === "POST") {
    const nextAction = req.headers.get("next-action") || req.headers.get("Next-Action");
    if (nextAction || pathname === "/" || pathname.startsWith("/chat")) {
      fetch("http://127.0.0.1:7539/ingest/4a8735a4-b80d-4c1d-9d63-f57ea9a4200a", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "51b9f5" },
        body: JSON.stringify({
          sessionId: "51b9f5",
          runId: "pre-fix",
          hypothesisId: "A-B-F",
          location: "middleware.ts:POST",
          message: "incoming POST (possible server action)",
          data: {
            pathname,
            isAuthed,
            hasNextAction: Boolean(nextAction),
            contentLength: req.headers.get("content-length"),
            contentType: (req.headers.get("content-type") || "").slice(0, 80),
            origin: req.headers.get("origin"),
            host: req.headers.get("host"),
            xfh: req.headers.get("x-forwarded-host"),
            xfproto: req.headers.get("x-forwarded-proto"),
            ua: (req.headers.get("user-agent") || "").includes("iPhone")
              ? "iphone"
              : (req.headers.get("user-agent") || "").includes("iPad")
                ? "ipad"
                : "other",
            willRedirectLogin: !isAuthed && !isPublicPath(pathname),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    }
  }
  // #endregion

  if (!isAuthed && !isPublicPath(pathname)) {
    const login = redirectUrl(req, "/login");
    const returnTo = `${pathname}${req.nextUrl.search}`;
    login.searchParams.set("from", returnTo);
    return NextResponse.redirect(login);
  }

  if (isAuthed && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(redirectUrl(req, "/"));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|icons/|manifest\\.json|favicon\\.ico|sw\\.js|workbox|fallback-|worker-).*)",
  ],
};
