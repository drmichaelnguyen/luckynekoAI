import type { ConversationTurnForApi } from "@/lib/chat/conversation-context";

export type TransactionOriginMessage = {
  role: "user" | "assistant";
  content: string;
  isTransactionInput?: boolean;
  attachments?: string[];
};

export type TransactionOriginChat = {
  version: 1;
  capturedAt: string;
  messages: TransactionOriginMessage[];
};

/** Build the durable chat snapshot attached to a transaction created by chat. */
export function buildTransactionOriginChatJson(input: {
  currentMessage: string;
  priorTurns: ConversationTurnForApi[];
  attachmentNames?: string[];
}): string {
  const messages: TransactionOriginMessage[] = input.priorTurns.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  messages.push({
    role: "user",
    content: input.currentMessage || "(attachment only)",
    isTransactionInput: true,
    ...(input.attachmentNames?.length ? { attachments: input.attachmentNames } : {}),
  });

  return JSON.stringify({
    version: 1,
    capturedAt: new Date().toISOString(),
    messages,
  } satisfies TransactionOriginChat);
}

export function parseTransactionOriginChat(value: string | null | undefined): TransactionOriginChat | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<TransactionOriginChat>;
    if (parsed.version !== 1 || !Array.isArray(parsed.messages) || typeof parsed.capturedAt !== "string") {
      return null;
    }
    const messages: TransactionOriginMessage[] = [];
    for (const candidate of parsed.messages) {
      const message = candidate as Partial<TransactionOriginMessage> | null;
      if (
        !message ||
        (message.role !== "user" && message.role !== "assistant") ||
        typeof message.content !== "string"
      ) {
        continue;
      }
      const attachments = Array.isArray(message.attachments)
        ? message.attachments.filter((name): name is string => typeof name === "string")
        : undefined;
      messages.push({
        role: message.role,
        content: message.content,
        ...(message.isTransactionInput === true ? { isTransactionInput: true } : {}),
        ...(attachments?.length ? { attachments } : {}),
      });
    }
    return messages.length > 0 ? { version: 1, capturedAt: parsed.capturedAt, messages } : null;
  } catch {
    return null;
  }
}
