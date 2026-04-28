import { z } from "zod";

import { DEFAULT_9ROUTER_MODEL, LARGE_9ROUTER_MODEL, normalize9RouterModel } from "@/lib/ai/9router";
import { prisma } from "@/lib/prisma";

export type AdminProviderChoice = "auto" | "gemini" | "9router";

export type AdminRuntimeSettings = {
  routing: {
    chatPrimaryProvider: AdminProviderChoice;
    structuredPrimaryProvider: AdminProviderChoice;
    geminiModel: string;
    nineRouterMiniModel: string;
    nineRouterModel: string;
    nineRouterUrl: string;
  };
  learning: {
    enableChatPreferenceLearning: boolean;
    enableMerchantLearning: boolean;
    enableCorrectionLearning: boolean;
    merchantLearningMinFrequency: number;
  };
};

const SETTINGS_KEY = "admin_runtime";

const StoredSettingsSchema = z.object({
  version: z.literal(1),
  settings: z.object({
    routing: z.object({
      chatPrimaryProvider: z.enum(["auto", "gemini", "9router"]),
      structuredPrimaryProvider: z.enum(["auto", "gemini", "9router"]),
      geminiModel: z.string(),
      nineRouterMiniModel: z.string(),
      nineRouterModel: z.string(),
      nineRouterUrl: z.string(),
    }),
    learning: z.object({
      enableChatPreferenceLearning: z.boolean(),
      enableMerchantLearning: z.boolean(),
      enableCorrectionLearning: z.boolean(),
      merchantLearningMinFrequency: z.number().int().min(1).max(20),
    }),
  }),
});

function trimmedOr(value: string | null | undefined, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

export function defaultAdminRuntimeSettings(): AdminRuntimeSettings {
  return {
    routing: {
      chatPrimaryProvider: "auto",
      structuredPrimaryProvider: "auto",
      geminiModel: trimmedOr(process.env.GEMINI_MODEL, "gemini-2.5-flash"),
      nineRouterMiniModel: normalize9RouterModel(process.env.NINE_ROUTER_MINI_MODEL, DEFAULT_9ROUTER_MODEL),
      nineRouterModel: normalize9RouterModel(process.env.NINE_ROUTER_MODEL, LARGE_9ROUTER_MODEL),
      nineRouterUrl: trimmedOr(
        process.env.NINE_ROUTER_URL,
        "https://9router.k-aithelittlelion.com/v1/chat/completions",
      ),
    },
    learning: {
      enableChatPreferenceLearning: true,
      enableMerchantLearning: true,
      enableCorrectionLearning: true,
      merchantLearningMinFrequency: 3,
    },
  };
}

function normalizeSettings(input: Partial<AdminRuntimeSettings> | null | undefined): AdminRuntimeSettings {
  const defaults = defaultAdminRuntimeSettings();
  return {
    routing: {
      chatPrimaryProvider:
        input?.routing?.chatPrimaryProvider === "gemini" ||
        input?.routing?.chatPrimaryProvider === "9router"
          ? input.routing.chatPrimaryProvider
          : "auto",
      structuredPrimaryProvider:
        input?.routing?.structuredPrimaryProvider === "gemini" ||
        input?.routing?.structuredPrimaryProvider === "9router"
          ? input.routing.structuredPrimaryProvider
          : "auto",
      geminiModel: trimmedOr(input?.routing?.geminiModel, defaults.routing.geminiModel),
      nineRouterMiniModel: normalize9RouterModel(input?.routing?.nineRouterMiniModel, defaults.routing.nineRouterMiniModel),
      nineRouterModel: normalize9RouterModel(input?.routing?.nineRouterModel, defaults.routing.nineRouterModel),
      nineRouterUrl: trimmedOr(input?.routing?.nineRouterUrl, defaults.routing.nineRouterUrl),
    },
    learning: {
      enableChatPreferenceLearning: input?.learning?.enableChatPreferenceLearning ?? defaults.learning.enableChatPreferenceLearning,
      enableMerchantLearning: input?.learning?.enableMerchantLearning ?? defaults.learning.enableMerchantLearning,
      enableCorrectionLearning: input?.learning?.enableCorrectionLearning ?? defaults.learning.enableCorrectionLearning,
      merchantLearningMinFrequency:
        Number.isFinite(input?.learning?.merchantLearningMinFrequency)
          ? Math.max(1, Math.min(20, Math.round(input!.learning!.merchantLearningMinFrequency)))
          : defaults.learning.merchantLearningMinFrequency,
    },
  };
}

export function normalizeAdminRuntimeSettings(input: Partial<AdminRuntimeSettings>): AdminRuntimeSettings {
  return normalizeSettings(input);
}

export async function loadAdminRuntimeSettings(): Promise<AdminRuntimeSettings> {
  try {
    const delegate = (prisma as unknown as {
      adminSetting?: { findUnique: (args: { where: { key: string } }) => Promise<{ value: string } | null> };
    }).adminSetting;
    if (!delegate?.findUnique) return defaultAdminRuntimeSettings();
    const row = await delegate.findUnique({ where: { key: SETTINGS_KEY } });
    if (!row?.value) return defaultAdminRuntimeSettings();
    const parsed = StoredSettingsSchema.safeParse(JSON.parse(row.value));
    if (!parsed.success) return defaultAdminRuntimeSettings();
    return normalizeSettings(parsed.data.settings);
  } catch (error) {
    console.error("[admin-settings] loadAdminRuntimeSettings failed", error);
    return defaultAdminRuntimeSettings();
  }
}

export async function saveAdminRuntimeSettings(
  nextSettings: Partial<AdminRuntimeSettings>,
): Promise<AdminRuntimeSettings> {
  const settings = normalizeSettings(nextSettings);
  try {
    const delegate = (prisma as unknown as {
      adminSetting?: {
        upsert: (args: {
          where: { key: string };
          create: { key: string; value: string };
          update: { value: string };
        }) => Promise<unknown>;
      };
    }).adminSetting;
    if (!delegate?.upsert) {
      throw new Error("Admin settings table is unavailable. Run prisma generate and apply the schema.");
    }
    await delegate.upsert({
      where: { key: SETTINGS_KEY },
      create: {
        key: SETTINGS_KEY,
        value: JSON.stringify({ version: 1, settings }),
      },
      update: {
        value: JSON.stringify({ version: 1, settings }),
      },
    });
  } catch (error) {
    console.error("[admin-settings] saveAdminRuntimeSettings failed", error);
    throw error;
  }
  return settings;
}

export function resolveProviderChoice(choice: AdminProviderChoice, fallback: "gemini" | "9router") {
  return choice === "auto" ? fallback : choice;
}
