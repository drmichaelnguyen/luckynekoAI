import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { parseLedgerBackupJson, restoreLedgerBackupForUser } from "@/lib/backup/ledger-backup";
import { prisma } from "@/lib/prisma";

const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_BYTES) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  const formData = await request.formData();
  const confirm = formData.get("confirm") === "true" || formData.get("confirm") === "on";
  if (!confirm) {
    return NextResponse.json({ error: "Confirmation is required to replace your ledger." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Attach a backup .json file." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large." }, { status: 413 });
  }

  const text = await file.text();
  const parsed = parseLedgerBackupJson(text);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const restored = await restoreLedgerBackupForUser(prisma, {
    targetUserId: session.user.id,
    backup: parsed.data,
    expectedEmail: session.user.email,
  });

  if (!restored.ok) {
    return NextResponse.json({ error: restored.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
