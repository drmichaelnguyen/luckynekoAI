"use server";

import sharp from "sharp";

import { call9RouterImageGeneration, resolve9RouterImageGenerationUrl } from "@/lib/ai/9router";

type GeminiImageResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType?: string;
          data?: string;
        };
      }>;
    };
    finishReason?: string;
  }>;
  error?: { message?: string };
};

function getGeminiApiKey(): string | null {
  return process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || null;
}

function geminiImageModel(): string {
  return process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3.1-flash-image-preview";
}

function geminiImageEndpoint(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function imageResultToDataUrl(response: GeminiImageResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inlineData = part.inlineData;
    if (inlineData?.data) {
      const mimeType = inlineData.mimeType?.trim() || "image/png";
      return `data:${mimeType};base64,${inlineData.data}`;
    }
  }
  throw new Error("Gemini image generation returned no image data.");
}

function parseDataUrl(value: string): { mimeType: string; buffer: Buffer } | null {
  const match = value.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

export async function loadGeneratedImageBuffer(source: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const parsed = parseDataUrl(source);
  if (parsed) return parsed;

  const response = await fetch(source);
  if (!response.ok) {
    throw new Error("Failed to download generated image.");
  }

  const mimeType = response.headers.get("content-type")?.trim() || "image/png";
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType,
  };
}

export async function normalizeIconImageBuffer(input: {
  buffer: Buffer;
  mimeType: string;
}): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    const image = sharp(input.buffer, { failOn: "truncated" }).rotate();
    const normalized = await image
      .resize(256, 256, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      })
      .png()
      .toBuffer();

    return { buffer: normalized, mimeType: "image/png" };
  } catch {
    return input;
  }
}

export async function callGeminiImageGeneration(input: {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
}): Promise<{ imageUrl: string; model: string; requestUrl: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Server is missing GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY.");
  }

  const model = input.model?.trim() || geminiImageModel();
  const requestUrl = geminiImageEndpoint(model);
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: input.prompt }],
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: input.aspectRatio ?? "1:1",
          imageSize: input.imageSize ?? "1K",
        },
      },
    }),
  });

  const body = (await response.json().catch(() => null)) as GeminiImageResponse | null;
  if (!response.ok) {
    throw new Error(body?.error?.message || `Gemini image request failed with HTTP ${response.status}.`);
  }

  return {
    imageUrl: imageResultToDataUrl(body ?? {}),
    model,
    requestUrl,
  };
}

export async function callIconImageGeneration(input: {
  prompt: string;
  nineRouterModel?: string;
  nineRouterUrl?: string;
  mode?: "auto" | "9router" | "gemini";
}): Promise<{
  provider: "9router" | "gemini";
  model: string;
  requestUrl: string;
  imageUrl: string;
  imageBuffer?: Buffer;
  imageMimeType?: string;
}> {
  const model = input.nineRouterModel?.trim() || "image-creation";
  const mode = input.mode ?? "auto";

  if (mode === "9router") {
    const imageUrl = await call9RouterImageGeneration({
      prompt: input.prompt,
      model,
      url: input.nineRouterUrl,
    });
    return {
      provider: "9router",
      model,
      requestUrl: resolve9RouterImageGenerationUrl(input.nineRouterUrl),
      imageUrl,
    };
  }

  if (mode === "gemini") {
    const gemini = await callGeminiImageGeneration({
      prompt: input.prompt,
      aspectRatio: "1:1",
      imageSize: "1K",
    });
    return {
      provider: "gemini",
      model: gemini.model,
      requestUrl: gemini.requestUrl,
      imageUrl: gemini.imageUrl,
    };
  }

  try {
    const imageUrl = await call9RouterImageGeneration({
      prompt: input.prompt,
      model,
      url: input.nineRouterUrl,
    });
    return {
      provider: "9router",
      model,
      requestUrl: resolve9RouterImageGenerationUrl(input.nineRouterUrl),
      imageUrl,
    };
  } catch {
    const gemini = await callGeminiImageGeneration({
      prompt: input.prompt,
      aspectRatio: "1:1",
      imageSize: "1K",
    });
    return {
      provider: "gemini",
      model: gemini.model,
      requestUrl: gemini.requestUrl,
      imageUrl: gemini.imageUrl,
    };
  }
}
