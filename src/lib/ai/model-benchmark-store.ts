import { z } from "zod";

import { prisma } from "@/lib/prisma";
import type { BenchmarkRun, BenchmarkRunSummary } from "@/lib/ai/model-benchmark";

const HISTORY_KEY = "model_benchmark_history";
const MAX_HISTORY = 12;

const StoredHistorySchema = z.object({
  version: z.literal(1),
  runs: z.array(z.any()),
});

async function getAdminSettingDelegate() {
  return (prisma as unknown as {
    adminSetting?: {
      findUnique: (args: { where: { key: string } }) => Promise<{ value: string } | null>;
      upsert: (args: {
        where: { key: string };
        create: { key: string; value: string };
        update: { value: string };
      }) => Promise<unknown>;
    };
  }).adminSetting;
}

export async function loadBenchmarkHistory(): Promise<BenchmarkRunSummary[]> {
  try {
    const delegate = await getAdminSettingDelegate();
    if (!delegate?.findUnique) return [];
    const row = await delegate.findUnique({ where: { key: HISTORY_KEY } });
    if (!row?.value) return [];
    const parsed = StoredHistorySchema.safeParse(JSON.parse(row.value));
    if (!parsed.success) return [];
    return parsed.data.runs as BenchmarkRunSummary[];
  } catch (error) {
    console.error("[model-benchmark-store] loadBenchmarkHistory failed", error);
    return [];
  }
}

export async function saveBenchmarkRun(run: BenchmarkRun): Promise<void> {
  try {
    const delegate = await getAdminSettingDelegate();
    if (!delegate?.upsert) {
      throw new Error("Admin settings table is unavailable.");
    }
    const history = await loadBenchmarkHistory();
    const { results: _results, ...summary } = run;
    const nextHistory = [summary, ...history].slice(0, MAX_HISTORY);
    await delegate.upsert({
      where: { key: HISTORY_KEY },
      create: {
        key: HISTORY_KEY,
        value: JSON.stringify({ version: 1, runs: nextHistory }),
      },
      update: {
        value: JSON.stringify({ version: 1, runs: nextHistory }),
      },
    });
  } catch (error) {
    console.error("[model-benchmark-store] saveBenchmarkRun failed", error);
  }
}
