import type { PrismaClient } from "@prisma/client";

export type CorrectionExampleRow = {
  documentKind: string;
  merchantBefore: string | null;
  merchantAfter: string | null;
  categoryBefore: string | null;
  categoryAfter: string | null;
  correctionInstruction: string;
};

export async function loadCorrectionExamples(db: PrismaClient, userId: string, limit = 3): Promise<CorrectionExampleRow[]> {
  try {
    const mediaRows = await db.storedMedia.findMany({
      where: {
        userId,
        markedForTraining: true,
        trainingExampleJson: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { trainingExampleJson: true },
    });

    const examples: CorrectionExampleRow[] = [];

    for (const row of mediaRows) {
      if (!row.trainingExampleJson) continue;

      try {
        const bundle = JSON.parse(row.trainingExampleJson) as {
          version?: number;
          documentKind?: string;
          originalProposed?: Record<string, unknown>;
          userCorrectionInstructions?: string;
          mergedFinal?: Record<string, unknown>;
          _edits?: Array<{ before: Record<string, unknown>; after: Record<string, unknown> }>;
        };

        const documentKind = bundle.documentKind ?? "receipt";
        const merchBefore = bundle.originalProposed?.merchant ?? null;
        const merchAfter = bundle.mergedFinal?.merchant ?? null;
        const catBefore = bundle.originalProposed?.category ?? null;
        const catAfter = bundle.mergedFinal?.category ?? null;
        const instruction = bundle.userCorrectionInstructions ?? "user corrected extraction";

        examples.push({
          documentKind,
          merchantBefore: typeof merchBefore === "string" ? merchBefore : null,
          merchantAfter: typeof merchAfter === "string" ? merchAfter : null,
          categoryBefore: typeof catBefore === "string" ? catBefore : null,
          categoryAfter: typeof catAfter === "string" ? catAfter : null,
          correctionInstruction: instruction.slice(0, 200),
        });
      } catch (e) {
        console.error("[learning] failed to parse trainingExampleJson", e);
      }
    }

    return examples;
  } catch (e) {
    console.error("[learning] loadCorrectionExamples failed", e);
    return [];
  }
}

export function buildCorrectionExamplesLines(examples: CorrectionExampleRow[]): string[] {
  if (examples.length === 0) {
    return [];
  }

  const lines: string[] = ["PAST CORRECTION EXAMPLES (apply same user preferences to new documents):"];

  for (const ex of examples) {
    let diff = "";

    if (ex.merchantBefore !== ex.merchantAfter) {
      diff += `merchant="${ex.merchantAfter}"`;
    }
    if (ex.categoryBefore !== ex.categoryAfter) {
      if (diff) diff += ", ";
      diff += `category="${ex.categoryAfter}"`;
    }

    const summary = `[${ex.documentKind}] User said: "${ex.correctionInstruction}" → ${diff}`;
    lines.push(`- ${summary.slice(0, 180)}`);
  }

  return lines;
}
