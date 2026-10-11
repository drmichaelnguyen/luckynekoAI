import { NextResponse } from "next/server";

import { handleChatInput } from "@/actions/chat";
import { auth } from "@/auth";

export const runtime = "nodejs";
/** Allow slow vision / multi-provider chat turns behind Cloudflare Tunnel. */
export const maxDuration = 300;

/**
 * Multipart chat endpoint used by the composer for attachment uploads.
 *
 * Large files are sent here instead of Next.js Server Actions so proxies
 * (Cloudflare Tunnel, mobile LTE) return plain JSON instead of a broken RSC
 * payload that surfaces as "An unexpected response was received from the server."
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false as const, error: "Sign in to chat and save entries to your ledger." },
      { status: 401 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      {
        ok: false as const,
        error:
          "Could not read the upload. Try a smaller JPEG, or tap Retry upload if the file is still attached.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await handleChatInput(formData);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error processing chat.";
    return NextResponse.json({ ok: false as const, error: message }, { status: 500 });
  }
}
