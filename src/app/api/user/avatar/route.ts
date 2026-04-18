import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { readAvatarBuffer } from "@/lib/media/avatar-storage";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const buf = await readAvatarBuffer(session.user.id);
  if (!buf?.length) {
    return NextResponse.json({ error: "No avatar" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-cache",
    },
  });
}
