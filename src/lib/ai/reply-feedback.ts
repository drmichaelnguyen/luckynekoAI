import { prisma } from "@/lib/prisma";

export type ReplyFeedbackStats = {
  totalVotes: number;
  thumbsUp: number;
  thumbsDown: number;
  thumbsUpRate: number | null;
  thumbsDownRate: number | null;
  satisfactionScore: number | null;
  latestRatedAt: string | null;
};

function emptyReplyFeedbackStats(): ReplyFeedbackStats {
  return {
    totalVotes: 0,
    thumbsUp: 0,
    thumbsDown: 0,
    thumbsUpRate: null,
    thumbsDownRate: null,
    satisfactionScore: null,
    latestRatedAt: null,
  };
}

export async function loadReplyFeedbackStats(): Promise<ReplyFeedbackStats> {
  try {
    const [totalVotes, thumbsUp, thumbsDown, latest] = await Promise.all([
      prisma.assistantReplyFeedback.count(),
      prisma.assistantReplyFeedback.count({ where: { rating: { gt: 0 } } }),
      prisma.assistantReplyFeedback.count({ where: { rating: { lt: 0 } } }),
      prisma.assistantReplyFeedback.findFirst({
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    if (totalVotes === 0) {
      return emptyReplyFeedbackStats();
    }

    const thumbsUpRate = thumbsUp / totalVotes;
    const thumbsDownRate = thumbsDown / totalVotes;
    return {
      totalVotes,
      thumbsUp,
      thumbsDown,
      thumbsUpRate,
      thumbsDownRate,
      satisfactionScore: Math.round((1 + thumbsUpRate * 4) * 10) / 10,
      latestRatedAt: latest?.createdAt.toISOString() ?? null,
    };
  } catch (error) {
    console.error("[reply-feedback] loadReplyFeedbackStats failed", error);
    return emptyReplyFeedbackStats();
  }
}

export async function saveReplyFeedback(input: {
  userId: string;
  assistantMessageId: string;
  rating: 1 | -1;
  assistantMessage?: string | null;
  userPrompt?: string | null;
  conversationJson?: string | null;
}): Promise<void> {
  const assistantMessage = input.assistantMessage?.trim().slice(0, 4000) || null;
  const userPrompt = input.userPrompt?.trim().slice(0, 4000) || null;
  const conversationJson = input.conversationJson?.trim().slice(0, 10_000) || null;

  await prisma.assistantReplyFeedback.deleteMany({
    where: {
      userId: input.userId,
      assistantMessageId: input.assistantMessageId,
    },
  });

  await prisma.assistantReplyFeedback.create({
    data: {
      userId: input.userId,
      assistantMessageId: input.assistantMessageId,
      rating: input.rating,
      assistantMessage,
      userPrompt,
      conversationJson,
    },
  });
}
