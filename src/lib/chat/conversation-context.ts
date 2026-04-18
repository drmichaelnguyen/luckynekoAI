import type { ChatMessage } from "@/types/chat";

/**
 * Max user + assistant bubbles in model context including the current user message.
 * We send: financial pack (optional) + up to 39 prior turns + current user message (+ attachments).
 */
export const CHAT_CONTEXT_MAX_MESSAGES = 40;

const WELCOME_ID = "welcome";

export type ConversationTurnForApi = {
  role: "user" | "assistant";
  content: string;
  /** Truncated model extraction JSON for assistant turns — helps packing and follow-ups. */
  extractionNote?: string;
};

const EXTRACTION_NOTE_MAX = 2000;

export function historyWithoutWelcome(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.id !== WELCOME_ID);
}

/**
 * First index (into `full` including current user at the end) that should be represented
 * only via the packed financial summary — everything before this index falls outside the
 * last {@link CHAT_CONTEXT_MAX_MESSAGES} bubbles.
 */
export function computePackTailStart(fullLength: number): number {
  if (fullLength <= CHAT_CONTEXT_MAX_MESSAGES) return 0;
  return fullLength - CHAT_CONTEXT_MAX_MESSAGES;
}

export function messageToTurnForApi(m: ChatMessage): ConversationTurnForApi {
  const role = m.role;
  const content = m.content?.trim() || (m.attachments?.length ? "(attachment only)" : "");
  if (role !== "assistant") {
    return { role: "user", content };
  }
  const extractionNote =
    m.structuredJson && m.structuredJson.length > 0
      ? m.structuredJson.slice(0, EXTRACTION_NOTE_MAX)
      : undefined;
  return { role: "assistant", content, extractionNote };
}

/**
 * Prior turns inside the sliding window (excludes the last message = current user turn).
 */
export function recentPriorTurnsForApi(fullIncludingCurrentUser: ChatMessage[]): ConversationTurnForApi[] {
  if (fullIncludingCurrentUser.length <= 1) return [];
  const withoutCurrent = fullIncludingCurrentUser.slice(0, -1);
  if (fullIncludingCurrentUser.length <= CHAT_CONTEXT_MAX_MESSAGES) {
    return withoutCurrent.map(messageToTurnForApi);
  }
  const windowStart = fullIncludingCurrentUser.length - CHAT_CONTEXT_MAX_MESSAGES;
  return fullIncludingCurrentUser.slice(windowStart, -1).map(messageToTurnForApi);
}
