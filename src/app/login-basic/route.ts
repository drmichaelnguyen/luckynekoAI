import { NextResponse } from "next/server";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function GET(request: Request) {
  const csrfResponse = await fetch(new URL("/api/auth/csrf", request.url), {
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
    cache: "no-store",
  });

  if (!csrfResponse.ok) {
    return new NextResponse("Could not load login form.", { status: 500 });
  }

  const { csrfToken } = (await csrfResponse.json()) as { csrfToken?: string };
  if (!csrfToken) {
    return new NextResponse("Could not load login form.", { status: 500 });
  }

  const setCookie = csrfResponse.headers.get("set-cookie");
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>NekoZeni Basic Login</title>
    <style>
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #fffbeb;
        color: #1f2937;
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      .card {
        width: 100%;
        max-width: 360px;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 18px;
        padding: 24px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 22px;
      }
      p {
        margin: 0 0 16px;
        line-height: 1.5;
        color: #4b5563;
      }
      label {
        display: block;
        margin: 0 0 6px;
        font-size: 14px;
        font-weight: 600;
      }
      input {
        width: 100%;
        box-sizing: border-box;
        padding: 11px 12px;
        border: 1px solid #d1d5db;
        border-radius: 10px;
        font-size: 15px;
        margin: 0 0 14px;
      }
      button {
        width: 100%;
        border: 0;
        border-radius: 10px;
        padding: 12px 14px;
        font-size: 15px;
        font-weight: 700;
        color: white;
        background: #15803d;
        cursor: pointer;
      }
      a {
        color: #166534;
      }
      .note {
        margin-top: 14px;
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Basic Sign In</h1>
      <p>This page bypasses the main login UI and submits directly to the auth endpoint.</p>
      <form method="post" action="/api/auth/callback/credentials">
        <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
        <input type="hidden" name="callbackUrl" value="/" />
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" required />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required />
        <button type="submit">Sign in</button>
      </form>
      <p class="note"><a href="/login">Back to normal login</a></p>
    </main>
  </body>
</html>`;

  const response = new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });

  if (setCookie) {
    response.headers.append("set-cookie", setCookie);
  }

  return response;
}
