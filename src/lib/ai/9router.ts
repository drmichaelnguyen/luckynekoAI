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
};

function get9RouterConfig() {
  const apiKey = process.env.NINE_ROUTER_API_KEY?.trim();
  if (!apiKey) return null;

  return {
    apiKey,
    url:
      process.env.NINE_ROUTER_URL?.trim() ||
      "https://9router.k-aithelittlelion.com/v1/chat/completions",
    model: process.env.NINE_ROUTER_MODEL?.trim() || "codex-gemini",
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
}): Promise<string> {
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

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
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
  return text;
}
