type ChatAttachment = {
  buffer: Buffer;
  mimeType: string;
};

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image_url"; image_url: { url: string } };
type MessageContent = string | Array<TextContent | ImageContent>;

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: { message?: string };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

// Default to the supported 9router GPT-5 target. Do not assume a separate mini alias exists.
export const DEFAULT_9ROUTER_MODEL = "gpt-5";
export const LARGE_9ROUTER_MODEL = "gpt-5";

export function normalize9RouterModel(value: string | null | undefined, fallback: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  // These legacy placeholders and unsupported mini aliases get rejected by the upstream API.
  if (!trimmed || trimmed === "mini_models" || trimmed === "gpt-5-mini") return fallback;
  return trimmed;
}

function get9RouterConfig() {
  const apiKey = process.env.NINE_ROUTER_API_KEY?.trim();
  if (!apiKey) return null;

  return {
    apiKey,
    url:
      process.env.NINE_ROUTER_URL?.trim() ||
      "https://9router.k-aithelittlelion.com/v1/chat/completions",
    model: normalize9RouterModel(process.env.NINE_ROUTER_MODEL, LARGE_9ROUTER_MODEL),
  };
}

function contentToText(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
}

export function has9RouterConfig(): boolean {
  return Boolean(get9RouterConfig());
}

export async function call9RouterChatCompletion(input: {
  systemInstruction: string;
  userPrompt: string;
  temperature?: number;
  attachments?: ChatAttachment[];
  model?: string;
  url?: string;
}): Promise<{
  text: string;
  usage: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null };
}> {
  const config = get9RouterConfig();
  if (!config) {
    throw new Error("Server is missing NINE_ROUTER_API_KEY.");
  }

  const userContent: MessageContent = input.attachments?.length
    ? [
        { type: "text", text: input.userPrompt },
        ...input.attachments.flatMap((attachment): Array<TextContent | ImageContent> => {
          if (attachment.mimeType.startsWith("image/")) {
            return [
              {
                type: "image_url",
                image_url: {
                  url: `data:${attachment.mimeType};base64,${attachment.buffer.toString("base64")}`,
                },
              },
            ];
          }
          return [
            {
              type: "text",
              text: `\n\n[Attached ${attachment.mimeType} file omitted from 9router fallback because this GPT-style request only sends images inline.]`,
            },
          ];
        }),
      ]
    : input.userPrompt;

  const requestUrl = input.url?.trim() || config.url;
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: normalize9RouterModel(input.model, config.model),
      messages: [
        { role: "system", content: input.systemInstruction },
        { role: "user", content: userContent },
      ],
      temperature: input.temperature ?? 0.1,
    }),
  });

  const body = (await response.json().catch(() => null)) as ChatCompletionResponse | null;
  if (!response.ok) {
    throw new Error(body?.error?.message || `9router request failed with HTTP ${response.status}.`);
  }

  const text = contentToText(body?.choices?.[0]?.message?.content);
  if (!text) throw new Error("9router returned an empty response.");
  return {
    text,
    usage: {
      promptTokens: typeof body?.usage?.prompt_tokens === "number" ? body.usage.prompt_tokens : null,
      completionTokens: typeof body?.usage?.completion_tokens === "number" ? body.usage.completion_tokens : null,
      totalTokens: typeof body?.usage?.total_tokens === "number" ? body.usage.total_tokens : null,
    },
  };
}

export async function call9RouterImageGeneration(input: {
  prompt: string;
  model?: string;
  url?: string;
}): Promise<string> {
  const config = get9RouterConfig();
  if (!config) {
    throw new Error("Server is missing NINE_ROUTER_API_KEY.");
  }
  
  const baseUrl = config.url.split("/v1/")[0];
  const requestUrl = input.url?.trim() || `${baseUrl}/v1/images/generations`;
  
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model?.trim() || "image-creation",
      prompt: input.prompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json"
    }),
  });

  const body = await response.json().catch(() => null) as { data?: Array<{ b64_json?: string; url?: string }>; error?: { message?: string } } | null;
  if (!response.ok) {
    throw new Error(body?.error?.message || `9router image request failed with HTTP ${response.status}.`);
  }
  
  const b64 = body?.data?.[0]?.b64_json;
  const url = body?.data?.[0]?.url;
  
  if (b64) return `data:image/png;base64,${b64}`;
  if (url) return url;
  
  throw new Error("9router image generation returned an empty response.");
}
