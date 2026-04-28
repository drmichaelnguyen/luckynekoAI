"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

import { auth } from "@/auth";
import { call9RouterChatCompletion, has9RouterConfig } from "@/lib/ai/9router";
import {
  chooseStructuredTextPrimary,
  chooseStructuredTextRouterModel,
  orderedProviders,
  parseModelJson,
} from "@/lib/ai/model-router";
import { recordAiRequestLog, usageFromGeminiResult, type AiUsageMetrics } from "@/lib/ai/telemetry";
import { loadAdminRuntimeSettings, resolveProviderChoice } from "@/lib/admin-runtime-settings";
import { parseCsvTable } from "@/lib/csv-parse";
import { findOrCreateCategory } from "@/lib/finance/category-resolver";
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

const CSV_CHUNK_ROWS = 80;
const REFUND_TEXT_RE = /\b(refund|refunded|reimbursement|reimburse|return|returned|cashback|pay\s*back|paid\s*back)\b/i;

function headerIndex(headers: string[], name: string): number {
  return headers.findIndex((header) => header.trim().toLowerCase() === name.toLowerCase());
}

function cellByHeader(headers: string[], row: string[], name: string): string {
  const index = headerIndex(headers, name);
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function normalizeSourceCategory(label: string): string | null {
  const cleaned = label.trim();
  if (!cleaned) return null;
  const lowered = cleaned.toLowerCase();
  if (lowered.includes("apex dental") || lowered === "dental") return "Health > Dental";
  if (lowered.includes("prenuvo")) return "Health";
  if (lowered.includes("other income")) return "Income > Other income";
  if (lowered.includes("debt collection")) return "Income > Other income";
  return cleaned;
}

function sourceCategoryOverride(input: {
  headers: string[];
  sourceRow: string[];
  mappedCategoryName?: string | null;
}): string | null {
  const sourceCategory = normalizeSourceCategory(cellByHeader(input.headers, input.sourceRow, "Category"));
  if (!sourceCategory) return null;

  const note = cellByHeader(input.headers, input.sourceRow, "Note");
  const category = cellByHeader(input.headers, input.sourceRow, "Category");
  const event = cellByHeader(input.headers, input.sourceRow, "Event");
  const mapped = input.mappedCategoryName ?? "";
  const explicitRefund = REFUND_TEXT_RE.test(`${note} ${category} ${event}`);

  if (/refund/i.test(mapped) && !explicitRefund) return sourceCategory;
  return null;
}

export type CsvImportResult =
  | { ok: true; imported: number; pending: number; summary: string }
  | { ok: false; error: string };

export async function importCsvWithLlmAction(formData: FormData): Promise<CsvImportResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized." };

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey && !has9RouterConfig()) {
    return { ok: false, error: "Missing GOOGLE_GENERATIVE_AI_API_KEY or NINE_ROUTER_API_KEY." };
  }

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

  await ensureFinanceSeed(prisma, session.user.id);
  const ctx = await financeContextLines(prisma, session.user.id);
  const adminSettings = await loadAdminRuntimeSettings();

  const modelName = adminSettings.routing.geminiModel;
  const baseSystemInstruction = `You map messy export CSV rows into structured ledger lines for NekoZeni.
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
- If the CSV has a Category column, preserve that category unless the note/category text clearly says it is a refund, return, reimbursement, cashback, or payback.
- Do not categorize a positive amount as "Income > Refund" just because it is positive. Use "Refund" only when the source text explicitly indicates a refund/return/reimbursement/payback.
- If a row looks like rent, loan payment, subscription, or utility bill, set recurrence "recurrent" and needsUserConfirm true with a short confirmReason.
- rowIndex MUST be the exact source row index shown in the preview.
- Skip header lines and completely blank rows.`;
  const model = apiKey
    ? new GoogleGenerativeAI(apiKey).getGenerativeModel({
        model: modelName,
        systemInstruction: baseSystemInstruction,
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
      })
    : null;

  try {
    const providerOrder = orderedProviders({
      preferred: resolveProviderChoice(
        adminSettings.routing.structuredPrimaryProvider,
        chooseStructuredTextPrimary({ nineRouterAvailable: has9RouterConfig() }),
      ),
      geminiAvailable: Boolean(model),
      nineRouterAvailable: has9RouterConfig(),
    });
    type MappedCsvRow = z.infer<typeof CsvRowSchema> & {
      modelProvider: (typeof providerOrder)[number];
      modelProviderOrder: string[];
      chunkStartRowIndex: number;
      chunkEndRowIndex: number;
    };
    const mappedRows: MappedCsvRow[] = [];
    const chunkSummaries: string[] = [];

    for (let chunkStart = 0; chunkStart < rows.length; chunkStart += CSV_CHUNK_ROWS) {
      const chunk = rows.slice(chunkStart, chunkStart + CSV_CHUNK_ROWS);
      const chunkEnd = chunkStart + chunk.length - 1;
      const preview = [
        `HEADERS: ${headers.join(" | ")}`,
        "",
        `ROWS (0-based source row index after header, this chunk is ${chunkStart}..${chunkEnd}):`,
        ...chunk.map((r, i) => `${chunkStart + i}: ${r.join(" | ")}`),
      ].join("\n");
      const systemInstruction = `${baseSystemInstruction}
- For this request, rowIndex MUST be between ${chunkStart} and ${chunkEnd}.`;
      const userPrompt = "CSV PREVIEW:\n\n" + preview + "\n\nReturn JSON as specified.";
      let parsed: z.SafeParseReturnType<unknown, z.infer<typeof CsvMapResponseSchema>> | null = null;
      let lastModelError: unknown = null;
      let usedProvider: (typeof providerOrder)[number] | null = null;

      for (const provider of providerOrder) {
        const startedAt = Date.now();
        try {
          const selectedModel =
            provider === "gemini"
              ? modelName
              : chooseStructuredTextRouterModel({ miniModel: adminSettings.routing.nineRouterMiniModel });
          let text = "";
          let usage: AiUsageMetrics;
          if (provider === "gemini") {
            const raw = await model!.generateContent([{ text: userPrompt }]);
            text = raw.response.text();
            usage = usageFromGeminiResult(raw);
          } else {
            const raw = await call9RouterChatCompletion({
              systemInstruction,
              userPrompt,
              temperature: 0.1,
              model: chooseStructuredTextRouterModel({ miniModel: adminSettings.routing.nineRouterMiniModel }),
              url: adminSettings.routing.nineRouterUrl,
            });
            text = raw.text;
            usage = raw.usage;
          }
          parsed = CsvMapResponseSchema.safeParse(parseModelJson(text));
          await recordAiRequestLog({
            userId: session.user.id,
            feature: "csv_import_map",
            provider,
            model: selectedModel,
            success: parsed.success,
            usage,
            latencyMs: Date.now() - startedAt,
            errorMessage: parsed.success ? null : `Model returned invalid JSON for rows ${chunkStart}-${chunkEnd}.`,
          });
          if (parsed.success) {
            usedProvider = provider;
            break;
          }
        } catch (e) {
          lastModelError = e;
          await recordAiRequestLog({
            userId: session.user.id,
            feature: "csv_import_map",
            provider,
            model:
              provider === "gemini"
                ? modelName
                : chooseStructuredTextRouterModel({ miniModel: adminSettings.routing.nineRouterMiniModel }),
            success: false,
            latencyMs: Date.now() - startedAt,
            errorMessage: e instanceof Error ? e.message : "Unknown model error.",
          });
        }
      }

      if (!parsed?.success || !usedProvider) {
        const message = lastModelError instanceof Error ? lastModelError.message : null;
        return {
          ok: false,
          error:
            message ||
            `Model returned invalid JSON or an unexpected CSV map format for source rows ${chunkStart}-${chunkEnd}.`,
        };
      }

      for (const row of parsed.data.rows) {
        if (row.rowIndex < chunkStart || row.rowIndex > chunkEnd) continue;
        mappedRows.push({
          ...row,
          modelProvider: usedProvider,
          modelProviderOrder: providerOrder,
          chunkStartRowIndex: chunkStart,
          chunkEndRowIndex: chunkEnd,
        });
      }
      if (parsed.data.summary) chunkSummaries.push(parsed.data.summary);
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
        rowCount: rows.length,
        status: "completed",
      },
    });

    let pending = 0;
    let imported = 0;

    for (const row of mappedRows) {
      if (row.rowIndex < 0 || row.rowIndex >= rows.length) continue;
      const amountCents = Math.round(Math.abs(row.amount) * 100);
      if (amountCents <= 0) continue;

      let wallet = defaultWallet;
      if (row.walletLabel) {
        const hit = wallets.find(
          (w) => w.name.toLowerCase() === row.walletLabel!.toLowerCase(),
        );
        if (hit) wallet = hit;
      }

      const sourceRow = rows[row.rowIndex];
      const categoryOverride = sourceCategoryOverride({
        headers,
        sourceRow,
        mappedCategoryName: row.categoryName,
      });
      const categoryLabel = categoryOverride ?? row.categoryName;
      const other = categories.find((c) => c.slug === "other");
      let categoryId: string | null = other?.id ?? null;
      if (categoryLabel) {
        const hit = categories.find(
          (c) =>
            c.name.toLowerCase() === categoryLabel.toLowerCase() ||
            c.slug === slugify(categoryLabel),
        );
        if (hit) {
          categoryId = hit.id;
        } else {
          const created = await findOrCreateCategory({
            db: prisma,
            userId: session.user.id,
            label: categoryLabel,
            direction: row.direction,
            kindHint: categoryOverride ? "expense" : undefined,
            fallbackSlug: row.direction === "in" ? "income" : "other",
          });
          categoryId = created?.id ?? categoryId;
        }
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
          rawStructuredJson: JSON.stringify({
            source: {
              type: "csv_import",
              importBatchId: batch.id,
              sourceRowIndex: row.rowIndex,
              sourceHeaders: headers,
              sourceRow: rows[row.rowIndex],
              chunkStartRowIndex: row.chunkStartRowIndex,
              chunkEndRowIndex: row.chunkEndRowIndex,
              sourceCategoryOverride: categoryOverride,
            },
            model: {
              provider: row.modelProvider,
              providerOrder: row.modelProviderOrder,
              geminiModel: modelName,
              nineRouterMiniModel: chooseStructuredTextRouterModel({ miniModel: adminSettings.routing.nineRouterMiniModel }),
              nineRouterModel: adminSettings.routing.nineRouterModel,
            },
            mapped: {
              rowIndex: row.rowIndex,
              amount: row.amount,
              currency: row.currency ?? null,
              direction: row.direction,
              merchant: row.merchant ?? null,
              memo: row.memo ?? null,
              categoryName: row.categoryName ?? null,
              finalCategoryName: categoryLabel ?? null,
              walletLabel: row.walletLabel ?? null,
              occurredAt: row.occurredAt ?? null,
              recurrence: row.recurrence ?? null,
              needsUserConfirm: row.needsUserConfirm ?? null,
              confirmReason: row.confirmReason ?? null,
            },
          }),
        },
      });
      imported += 1;
    }

    return {
      ok: true,
      imported,
      pending,
      summary:
        chunkSummaries.length > 0
          ? `Imported ${imported} of ${rows.length} source row(s), ${pending} awaiting confirmation. ${chunkSummaries.join(" ")}`
          : `Imported ${imported} of ${rows.length} source row(s), ${pending} awaiting confirmation.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "CSV import failed.";
    return { ok: false, error: msg };
  }
}
