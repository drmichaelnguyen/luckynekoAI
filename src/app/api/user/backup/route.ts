import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { buildLedgerBackupJson, buildLedgerBackupZip } from "@/lib/backup/ledger-backup";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const fullZip =
    url.searchParams.get("full") === "1" || url.searchParams.get("format") === "zip";

  try {
    if (fullZip) {
      const { buffer, filename } = await buildLedgerBackupZip(prisma, session.user.id, session.user.email);
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const { json, filename } = await buildLedgerBackupJson(
      prisma,
      session.user.id,
      session.user.email,
    );
    return new NextResponse(json, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Backup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
