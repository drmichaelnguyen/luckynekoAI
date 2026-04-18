import { NextResponse } from "next/server";

import { LOCALE_COOKIE, locales, type Locale } from "@/lib/i18n/config";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const raw =
    typeof body === "object" && body !== null && "locale" in body
      ? (body as { locale: unknown }).locale
      : undefined;
  const candidate = typeof raw === "string" ? raw : "";
  const locale = locales.includes(candidate as Locale) ? (candidate as Locale) : null;
  if (!locale) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true, locale });
  res.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return res;
}
