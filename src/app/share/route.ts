import { NextResponse } from "next/server";

import { putShareImport } from "@/lib/share-import-cache";

export async function POST(request: Request) {
  const formData = await request.formData();

  const parts: Array<{ base64: string; mimeType: string; name: string }> = [];

  for (const [, value] of formData.entries()) {
    if (value instanceof File && value.size > 0) {
      const buffer = Buffer.from(await value.arrayBuffer());
      parts.push({
        base64: buffer.toString("base64"),
        mimeType: value.type || "application/octet-stream",
        name: value.name || "shared-file",
      });
    }
  }

  const title = formData.get("title")?.toString();
  const text = formData.get("text")?.toString();
  const url = formData.get("url")?.toString();

  const id = putShareImport({
    parts,
    title: title || undefined,
    text: text || undefined,
    url: url || undefined,
  });

  return NextResponse.redirect(new URL(`/?importId=${id}`, request.url), 303);
}
