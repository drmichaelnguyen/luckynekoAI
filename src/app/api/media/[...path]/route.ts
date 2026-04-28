import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { readUserMediaFile } from "@/lib/media/user-media-storage";

function contentTypeForPath(relativePath: string): string {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolved = await params;
  const parts = resolved.path ?? [];
  const relativePath = parts.join("/");
  if (!relativePath) {
    return NextResponse.json({ error: "Missing path" }, { status: 404 });
  }

  const ownerPrefix = `${session.user.id}/`;
  if (!relativePath.startsWith(ownerPrefix)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buf = await readUserMediaFile(relativePath);
  if (!buf?.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": contentTypeForPath(relativePath),
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
