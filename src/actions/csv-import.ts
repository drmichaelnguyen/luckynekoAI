"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

import { auth } from "@/auth";
import { parseCsvTable } from "@/lib/csv-parse";
import { financeContextLines, ensureFinanceSeed } from "@/lib/finance/seed";
import { slugify } from "@/lib/finance/slug";
import { prisma } from "@/lib/prisma";

const CsvRowSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  amount: z.number(),
  currency: z.string().nullable().optional(),
  direction: z.enum(["in", "out"]),
  merchant: z.string().nullable().optional(),
  memo: z.string().nullable().optional(),
  categoryName: z.string().nullable().optional(),
  walletLabel: z.string().nullable().optional(),
  occurredAt: z.string().nullable().optional(),
  recurrence: z.enum(["one_time", "recurrent"]).optional(),
  needsUserConfirm: z.boolean().optional(),
  confirmReason: z.string().nullable().optional(),
});

const CsvMapResponseSchema = z.object({
  rows: z.array(CsvRowSchema),
  summary: z.string().optional(),
});

const MAX_CSV_PREVIEW_ROWS = 80;

export type CsvImportResult =
  | { ok: true; imported: number; pending: number; summary: string }
  | { ok: false; error: string };

export async function importCsvWithLlmAction(formData: FormData): Promise<CsvImportResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized." };

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return { ok: false, error: "Missing GOOGLE_GENERATIVE_AI_API_KEY." };

  const file = formData.get("file");
  let text = String(formData.get("csvText") ?? "").trim();
  if (file instanceof File && file.size > 0) {
    text = await file.text();
  }
  if (!text) return { ok: false, error: "Paste CSV text or choose a .csv file." };
  if (text.length > 600_000) return { ok: false, error: "CSV is too large (max ~600k characters)." };

  const { headers, rows } = parseCsvTable(text);
  if (headers.length === 0 || rows.length === 0) {
    return { ok: false, error: "Could not read headers or data rows from CSV." };
  }

  const slice = rows.slice(0, MAX_CSV_PREVIEW_ROWS);
  await ensureFinanceSeed(prisma, session.user.id);
  const ctx = await financeContextLines(prisma, session.user.id);

  const preview = [
    `HEADERS: ${headers.join(" | ")}`,
    "",
    "ROWS (0-based index after header):",
    ...slice.map((r, i) => `${i}: ${r.join(" | ")}`),
  ].join("\n");

  const modelName = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: `You map messy export CSV rows into structured ledger lines for NekoZeni.
${ctx}

Return JSON ONLY:
{
  "rows": [
    {
      "rowIndex": number,        // index of the data row in the preview (0 = first data row)
      "amount": number,          // absolute value in major currency units (e.g. 12.34)
      "currency": string | null,
      "direction": "in" | "out",
      "merchant": string | null,
      "memo": string | null,
      "categoryName": string | null,
      "walletLabel": string | null,
      "occurredAt": string | null,   // ISO yyyy-mm-dd if you can infer a date column
      "recurrence": "one_time" | "recurrent",
      "needsUserConfirm": boolean,
      "confirmReason": string | null
    }
  ],
  "summary": string
}

Rules:
- Guess column meanings from headers + cell content (date, description, debit/credit, amount).
- Use direction "out" for spending, "in" for income/deposits/refunds as appropriate.
- If a row looks like rent, loan payment, subscription, or utility bill, set recurrence "recurrent" and needsUserConfirm true with a short confirmReason.
- rowIndex MUST refer only to rows provided in the preview (0 .. ${Math.max(0, slice.length - 1)}).
- Skip header lines and completely blank rows.`,
    generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
  });

  try {
    const result = await model.generateContent([
      { text: "CSV PREVIEW:\n\n" + preview + "\n\nReturn JSON as specified." },
    ]);
    const raw = result.response.text();
    const json = JSON.parse(raw) as unknown;
    const parsed = CsvMapResponseSchema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, error: "Model returned an unexpected CSV map format." };
    }

    const wallets = await prisma.wallet.findMany({
      where: { userId: session.user.id },
      orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
    });
    const categories = await prisma.category.findMany({ where: { userId: session.user.id } });
    const defaultWallet = wallets.find((w) => w.isDefault) ?? wallets[0];
    if (!defaultWallet) return { ok: false, error: "No wallet available." };

    const batch = await prisma.importBatch.create({
      data: {
        userId: session.user.id,
        label: `CSV import ${new Date().toISOString().slice(0, 10)}`,
        rowCount: parsed.data.rows.length,
        status: "completed",
      },
    });

    let pending = 0;
    let imported = 0;

    for (const row of parsed.data.rows) {
      if (row.rowIndex < 0 || row.rowIndex >= slice.length) continue;
      const amountCents = Math.round(Math.abs(row.amount) * 100);
      if (amountCents <= 0) continue;

      let wallet = defaultWallet;
      if (row.walletLabel) {
        const hit = wallets.find(
          (w) => w.name.toLowerCase() === row.walletLabel!.toLowerCase(),
        );
        if (hit) wallet = hit;
      }

      const other = categories.find((c) => c.slug === "other");
      let categoryId: string | null = other?.id ?? null;
      if (row.categoryName) {
        const hit = categories.find(
          (c) =>
            c.name.toLowerCase() === row.categoryName!.toLowerCase() ||
            c.slug === slugify(row.categoryName!),
        );
        if (hit) categoryId = hit.id;
      }

      const recurrence = row.recurrence === "recurrent" ? "recurrent" : "one_time";
      const needs = Boolean(row.needsUserConfirm) || recurrence === "recurrent";
      const status = needs ? "pending_user" : "posted";
      if (status === "pending_user") pending += 1;

      const occurredAt = row.occurredAt ? new Date(row.occurredAt) : new Date();
      const safeDate = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;

      await prisma.transaction.create({
        data: {
          userId: session.user.id,
          walletId: wallet.id,
          categoryId,
          amountCents,
          direction: row.direction,
          currency: (row.currency ?? "CAD").toUpperCase().slice(0, 3),
          merchant: row.merchant ?? null,
          memo: row.memo ?? null,
          occurredAt: safeDate,
          recurrence,
          status,
          confirmReason: row.confirmReason ?? (needs ? "Confirm in Tools (recurring bill?)" : null),
          source: "csv_import",
          importBatchId: batch.id,
          rawStructuredJson: JSON.stringify(row),
        },
      });
      imported += 1;
    }

    return {
      ok: true,
      imported,
      pending,
      summary: parsed.data.summary ?? `Imported ${imported} row(s), ${pending} awaiting confirmation.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "CSV import failed.";
    return { ok: false, error: msg };
  }
}
