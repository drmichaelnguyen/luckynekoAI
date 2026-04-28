import { DEFAULT_9ROUTER_MODEL, LARGE_9ROUTER_MODEL } from "@/lib/ai/9router";

export type AiProvider = "gemini" | "9router";
export type AiRouterModel = typeof DEFAULT_9ROUTER_MODEL | typeof LARGE_9ROUTER_MODEL;

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

export function chooseChatRouterModel(input: {
  hasAttachments: boolean;
  message: string;
  hasConversationContext: boolean;
  nineRouterAvailable: boolean;
}): AiRouterModel {
  if (!input.nineRouterAvailable) return DEFAULT_9ROUTER_MODEL;
  if (input.hasAttachments) return DEFAULT_9ROUTER_MODEL;

  const text = input.message.toLowerCase();
  const needsReasoning =
    input.hasConversationContext ||
    input.message.length > 700 ||
    /\b(afford|budget|plan|planning|should i|can i|risk|compare|analy[sz]e|advice|recommend|month end|cash flow|why)\b/.test(
      text,
    );

  return needsReasoning ? LARGE_9ROUTER_MODEL : DEFAULT_9ROUTER_MODEL;
}

export function chooseStructuredTextRouterModel(): AiRouterModel {
  return DEFAULT_9ROUTER_MODEL;
}

export function parseModelJson(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  return JSON.parse(candidate) as unknown;
}
