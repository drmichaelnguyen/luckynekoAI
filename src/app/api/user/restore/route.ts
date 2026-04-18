import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  isZipMagic,
  parseBackupZip,
  parseLedgerBackupJson,
  restoreLedgerBackupForUser,
} from "@/lib/backup/ledger-backup";
import { prisma } from "@/lib/prisma";

const MAX_BYTES_JSON = 12 * 1024 * 1024;
const MAX_BYTES_ZIP = 80 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentLength = request.headers.get("content-length");
  const cl = contentLength ? Number.parseInt(contentLength, 10) : 0;
  if (cl > MAX_BYTES_ZIP) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  const formData = await request.formData();
  const confirm = formData.get("confirm") === "true" || formData.get("confirm") === "on";
  if (!confirm) {
    return NextResponse.json({ error: "Confirmation is required to replace your ledger." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Attach a backup .json or .zip file." }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const u8 = new Uint8Array(arrayBuffer);
  const maxBytes =
    file.name.toLowerCase().endsWith(".zip") || isZipMagic(u8) ? MAX_BYTES_ZIP : MAX_BYTES_JSON;
  if (file.size > maxBytes) {
    return NextResponse.json({ error: "File too large." }, { status: 413 });
  }

  let ledgerText: string;
  let mediaZipFiles: Record<string, Uint8Array> | undefined;
  let replaceStoredMedia = false;

  if (file.name.toLowerCase().endsWith(".zip") || isZipMagic(u8)) {
    const unzipped = parseBackupZip(u8);
    if (!unzipped.ok) {
      return NextResponse.json({ error: unzipped.error }, { status: 400 });
    }
    ledgerText = unzipped.ledgerText;
    mediaZipFiles = unzipped.mediaFiles;
    replaceStoredMedia = true;
  } else {
    ledgerText = new TextDecoder("utf-8").decode(u8);
  }

  const parsed = parseLedgerBackupJson(ledgerText);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const restored = await restoreLedgerBackupForUser(prisma, {
    targetUserId: session.user.id,
    backup: parsed.data,
    expectedEmail: session.user.email,
    replaceStoredMedia,
    mediaZipFiles,
  });

  if (!restored.ok) {
    return NextResponse.json({ error: restored.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
