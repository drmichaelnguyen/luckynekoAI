"use server";

import { auth } from "@/auth";
import { saveReplyFeedback } from "@/lib/ai/reply-feedback";

export async function recordChatReplyFeedbackAction(input: {
  assistantMessageId: string;
  rating: 1 | -1;
  assistantMessage?: string | null;
  userPrompt?: string | null;
  conversationJson?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized." };
  }

  const assistantMessageId = input.assistantMessageId.trim();
  if (!assistantMessageId) {
    return { ok: false, error: "Missing assistant message id." };
  }
  if (input.rating !== 1 && input.rating !== -1) {
    return { ok: false, error: "Invalid feedback rating." };
  }

  try {
    await saveReplyFeedback({
      userId: session.user.id,
      assistantMessageId,
      rating: input.rating,
      assistantMessage: input.assistantMessage,
      userPrompt: input.userPrompt,
      conversationJson: input.conversationJson,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save reply feedback.",
    };
  }
}
