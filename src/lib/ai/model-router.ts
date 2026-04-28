import { DEFAULT_9ROUTER_MODEL, LARGE_9ROUTER_MODEL } from "@/lib/ai/9router";

export type AiProvider = "gemini" | "9router";
export type AiRouterModel = string;

export function orderedProviders(input: {
  preferred: AiProvider;
  geminiAvailable: boolean;
  nineRouterAvailable: boolean;
}): AiProvider[] {
  const providers: AiProvider[] = [];
  const add = (provider: AiProvider) => {
    if (provider === "gemini" && !input.geminiAvailable) return;
    if (provider === "9router" && !input.nineRouterAvailable) return;
    if (!providers.includes(provider)) providers.push(provider);
  };

  add(input.preferred);
  add(input.preferred === "gemini" ? "9router" : "gemini");
  return providers;
}

export function chooseChatPrimary(input: {
  hasAttachments: boolean;
  message: string;
  hasConversationContext: boolean;
  nineRouterAvailable: boolean;
}): AiProvider {
  if (!input.nineRouterAvailable) return "gemini";
  return "9router";
}

export function chooseStructuredTextPrimary(input: { nineRouterAvailable: boolean }): AiProvider {
  return input.nineRouterAvailable ? "9router" : "gemini";
}

export function chooseChatRouterModels(input: {
  hasAttachments: boolean;
  message: string;
  hasConversationContext: boolean;
  nineRouterAvailable: boolean;
  miniModel?: string;
  largeModel?: string;
}): AiRouterModel[] {
  const miniModel = input.miniModel?.trim() || DEFAULT_9ROUTER_MODEL;
  const largeModel = input.largeModel?.trim() || LARGE_9ROUTER_MODEL;

  if (!input.nineRouterAvailable) return [miniModel];

  // We always want to try the mini model first. If it fails or is confused,
  // we will fallback to the large model.
  if (miniModel === largeModel) {
    return [miniModel];
  }
  return [miniModel, largeModel];
}

export function chooseStructuredTextRouterModel(input?: { miniModel?: string }): AiRouterModel {
  return input?.miniModel?.trim() || DEFAULT_9ROUTER_MODEL;
}

export function parseModelJson(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  return JSON.parse(candidate) as unknown;
}
