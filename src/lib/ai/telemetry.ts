import type { GenerateContentResult, UsageMetadata } from "@google/generative-ai";

import { prisma } from "@/lib/prisma";

export type AiUsageMetrics = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export type AiTextResult = {
  text: string;
  usage: AiUsageMetrics;
};

export function usageFromGeminiResult(result: GenerateContentResult): AiUsageMetrics {
  return usageFromGeminiMetadata(result.response.usageMetadata);
}

export function usageFromGeminiMetadata(metadata: UsageMetadata | undefined): AiUsageMetrics {
  return {
    promptTokens: typeof metadata?.promptTokenCount === "number" ? metadata.promptTokenCount : null,
    completionTokens:
      typeof metadata?.candidatesTokenCount === "number" ? metadata.candidatesTokenCount : null,
    totalTokens: typeof metadata?.totalTokenCount === "number" ? metadata.totalTokenCount : null,
  };
}

export async function recordAiRequestLog(input: {
  userId?: string | null;
  feature: string;
  provider: string;
  model: string;
  success: boolean;
  usage?: Partial<AiUsageMetrics> | null;
  latencyMs?: number | null;
  errorMessage?: string | null;
}): Promise<void> {
  try {
    await prisma.aiRequestLog.create({
      data: {
        userId: input.userId ?? null,
        feature: input.feature,
        provider: input.provider,
        model: input.model,
        success: input.success,
        promptTokens:
          typeof input.usage?.promptTokens === "number" ? Math.max(0, Math.round(input.usage.promptTokens)) : null,
        completionTokens:
          typeof input.usage?.completionTokens === "number"
            ? Math.max(0, Math.round(input.usage.completionTokens))
            : null,
        totalTokens:
          typeof input.usage?.totalTokens === "number" ? Math.max(0, Math.round(input.usage.totalTokens)) : null,
        latencyMs: typeof input.latencyMs === "number" ? Math.max(0, Math.round(input.latencyMs)) : null,
        errorMessage: input.errorMessage?.trim().slice(0, 4000) || null,
      },
    });
  } catch (error) {
    console.error("[ai-telemetry] failed to record AI request log", error);
  }
}
