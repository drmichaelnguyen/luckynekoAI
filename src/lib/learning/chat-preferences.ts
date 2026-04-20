import type { PrismaClient } from "@prisma/client";

export type ChatPreferences = {
  version: 1;
  language: "vi" | "en" | "mixed" | null;
  verbosity: "concise" | "detailed" | null;
  explicitInstructions: string[];
  lastUpdatedAt: string;
  detectedAt: string;
};

const VI_KEYWORDS = ["của", "và", "là", "tôi", "bạn", "tiền", "chi", "mua", "ăn", "ngày", "tháng", "năm", "cho", "em", "anh"];

const VI_DIACRITICS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/gi;

export function detectLanguageFromMessage(message: string): "vi" | "en" | null {
  const diacriticMatches = (message.match(VI_DIACRITICS) || []).length;
  if (diacriticMatches >= 3) return "vi";

  const messageLower = message.toLowerCase();
  let keywordCount = 0;
  for (const keyword of VI_KEYWORDS) {
    if (messageLower.includes(keyword)) keywordCount++;
  }
  if (keywordCount >= 3) return "vi";

  const asciiOnly = /^[a-zA-Z0-9\s.,!?;:()\-'"\n]+$/.test(message.replace(/\s+/g, " "));
  if (asciiOnly && message.length > 20) return "en";

  return null;
}

export function detectVerbositySignal(userMsg: string, assistantMsg: string): "concise" | "detailed" | null {
  const msgLower = userMsg.toLowerCase();
  const concisePatterns = [
    "ngắn gọn", "just briefly", "short", "tldr", "tl;dr",
    "briefly", "concise", "nhanh thôi", "tóm lại", "vắn tắt",
  ];
  for (const pattern of concisePatterns) {
    if (msgLower.includes(pattern)) return "concise";
  }

  const detailedPatterns = [
    "chi tiết", "explain more", "in detail", "tell me more",
    "elaborat", "thoroughly", "giải thích", "nói rõ hơn", "chi tiết hơn",
  ];
  for (const pattern of detailedPatterns) {
    if (msgLower.includes(pattern)) return "detailed";
  }

  return null;
}

export function detectExplicitPreference(message: string): string | null {
  const patterns = [
    /always\s+(.{5,150})/i,
    /từ giờ\s+(.{5,150})/i,
    /remember that I\s+(.{5,150})/i,
    /nhớ là\s+(.{5,150})/i,
    /remember:\s+(.{5,150})/i,
    /note to self:\s+(.{5,150})/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      return match[1].trim().slice(0, 200);
    }
  }
  return null;
}

export function mergePreferences(
  current: ChatPreferences | null,
  detected: {
    language: "vi" | "en" | null;
    verbosity: "concise" | "detailed" | null;
    explicitInstruction: string | null;
  },
): ChatPreferences | null {
  if (!detected.language && !detected.verbosity && !detected.explicitInstruction) return null;

  const next: ChatPreferences = {
    version: 1,
    language: current?.language ?? null,
    verbosity: current?.verbosity ?? null,
    explicitInstructions: [...(current?.explicitInstructions ?? [])],
    lastUpdatedAt: new Date().toISOString(),
    detectedAt: current?.detectedAt ?? new Date().toISOString(),
  };

  // Language: sticky, requires 2+ signals to flip
  if (detected.language) {
    if (!next.language) {
      next.language = detected.language;
    } else if (next.language !== detected.language) {
      // Don't flip on single signal
    }
  }

  // Verbosity: can be overridden by explicit signal
  if (detected.verbosity) {
    next.verbosity = detected.verbosity;
  }

  // Explicit instructions: FIFO, cap at 5
  if (detected.explicitInstruction && !next.explicitInstructions.includes(detected.explicitInstruction)) {
    next.explicitInstructions.push(detected.explicitInstruction);
    if (next.explicitInstructions.length > 5) {
      next.explicitInstructions = next.explicitInstructions.slice(-5);
    }
  }

  // Return null if nothing actually changed
  const unchanged =
    next.language === current?.language &&
    next.verbosity === current?.verbosity &&
    next.explicitInstructions.length === current?.explicitInstructions.length &&
    (current?.explicitInstructions ?? []).every((v, i) => v === next.explicitInstructions[i]);

  return unchanged ? null : next;
}

export async function loadChatPreferences(db: PrismaClient, userId: string): Promise<ChatPreferences | null> {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { chatPreferencesJson: true },
    });
    if (!user?.chatPreferencesJson) return null;
    return JSON.parse(user.chatPreferencesJson) as ChatPreferences;
  } catch (e) {
    console.error("[learning] loadChatPreferences failed", e);
    return null;
  }
}

export async function saveChatPreferences(db: PrismaClient, userId: string, prefs: ChatPreferences): Promise<void> {
  try {
    await db.user.update({
      where: { id: userId },
      data: { chatPreferencesJson: JSON.stringify(prefs) },
    });
  } catch (e) {
    console.error("[learning] saveChatPreferences failed", e);
  }
}
