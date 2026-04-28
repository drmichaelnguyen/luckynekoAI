import { randomUUID } from "node:crypto";
import { z } from "zod";

import { call9RouterChatCompletion, normalize9RouterModel } from "@/lib/ai/9router";
import { loadReplyFeedbackStats, type ReplyFeedbackStats } from "@/lib/ai/reply-feedback";
import { parseModelJson } from "@/lib/ai/model-router";
import { recordAiRequestLog, type AiUsageMetrics } from "@/lib/ai/telemetry";

export type BenchmarkTask = {
  id: string;
  title: string;
  userPrompt: string;
  clarificationReply?: string;
  expectedClarification: boolean;
  expectedAnswerChecklist: string[];
  description: string;
};

export type BenchmarkTurn = {
  role: "user" | "assistant";
  content: string;
};

export type BenchmarkTaskResult = {
  taskId: string;
  title: string;
  turns: BenchmarkTurn[];
  turnsToResolution: number;
  clarificationCount: number;
  firstReply: string;
  finalReply: string;
  judge: BenchmarkJudgeScore;
  candidateUsage: AiUsageMetrics;
  judgeUsage: AiUsageMetrics;
  overallScore: number;
};

export type BenchmarkRunSummary = {
  id: string;
  createdAt: string;
  candidateModel: string;
  judgeModel: string;
  totalTasks: number;
  averageScore: number;
  successRate: number;
  averageSatisfaction: number;
  realUserSatisfaction: number | null;
  thumbsUpRate: number | null;
  thumbsDownRate: number | null;
  feedbackVotes: number;
  averageClarificationCount: number;
  averageTurnsToResolution: number;
  firstPassUnderstandingRate: number;
};

export type BenchmarkRun = BenchmarkRunSummary & {
  results: BenchmarkTaskResult[];
};

export type BenchmarkJudgeScore = {
  taskSuccess: boolean;
  understoodFirstPrompt: boolean;
  clarificationCount: number;
  turnsToResolution: number;
  userSatisfaction: number;
  answerQuality: number;
  clarificationQuality: number;
  notes: string;
};

const JudgeScoreSchema = z.object({
  taskSuccess: z.boolean(),
  understoodFirstPrompt: z.boolean(),
  clarificationCount: z.number().int().min(0),
  turnsToResolution: z.number().int().min(1),
  userSatisfaction: z.number().min(1).max(5),
  answerQuality: z.number().min(1).max(5),
  clarificationQuality: z.number().min(1).max(5),
  notes: z.string(),
});

function sumUsage(values: Array<AiUsageMetrics | null | undefined>): AiUsageMetrics {
  const totals = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let promptTokens = false;
  let completionTokens = false;
  let totalTokens = false;

  for (const value of values) {
    if (typeof value?.promptTokens === "number") {
      totals.promptTokens += value.promptTokens;
      promptTokens = true;
    }
    if (typeof value?.completionTokens === "number") {
      totals.completionTokens += value.completionTokens;
      completionTokens = true;
    }
    if (typeof value?.totalTokens === "number") {
      totals.totalTokens += value.totalTokens;
      totalTokens = true;
    }
  }

  return {
    promptTokens: promptTokens ? totals.promptTokens : null,
    completionTokens: completionTokens ? totals.completionTokens : null,
    totalTokens: totalTokens ? totals.totalTokens : null,
  };
}

function emptyUsage(): AiUsageMetrics {
  return {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
  };
}

const BENCHMARK_TASKS: BenchmarkTask[] = [
  {
    id: "coffee-log",
    title: "Log a simple expense",
    userPrompt: "Log a $7.80 coffee at Tim Hortons in my main spending wallet for yesterday.",
    expectedClarification: false,
    expectedAnswerChecklist: [
      "understands it is an expense log",
      "keeps the amount at 7.80",
      "mentions Tim Hortons",
      "does not ask for missing obvious information",
    ],
    description: "A clear finance logging request should be handled directly and concisely.",
  },
  {
    id: "ambiguous-amount",
    title: "Clarify an ambiguous amount",
    userPrompt: "I spent 30 yesterday.",
    clarificationReply: "It was 30 CAD on groceries.",
    expectedClarification: true,
    expectedAnswerChecklist: [
      "asks at least one clarifying question before acting",
      "does not guess the category or currency",
      "keeps the tone concise and helpful",
    ],
    description: "The model should ask a useful follow-up because the prompt is underspecified.",
  },
  {
    id: "unclear-edit",
    title: "Clarify an edit with missing context",
    userPrompt: "Change it to 12 dollars and mark it as transport.",
    clarificationReply: "It was the Uber ride from Monday.",
    expectedClarification: true,
    expectedAnswerChecklist: [
      "asks which transaction is being changed",
      "does not pretend it knows the target row",
      "requests just enough context to continue",
    ],
    description: "Editing a past item without context should trigger a targeted clarification.",
  },
  {
    id: "budget-plan",
    title: "Clarify a vague planning request",
    userPrompt: "Help me make a monthly budget.",
    clarificationReply: "My monthly income is 4200 CAD and I want to save 500 CAD.",
    expectedClarification: true,
    expectedAnswerChecklist: [
      "asks for income, currency, or goals",
      "does not invent a full budget without input",
      "shows it can proceed after the clarification",
    ],
    description: "A budget request should not be answered with fabricated numbers.",
  },
  {
    id: "expense-explanation",
    title: "Answer a direct explanation question",
    userPrompt: "What's the difference between fixed and variable expenses?",
    expectedClarification: false,
    expectedAnswerChecklist: [
      "explains both fixed and variable expenses",
      "keeps the answer accurate and readable",
      "does not ask for unnecessary clarification",
    ],
    description: "A direct knowledge question should be answered immediately.",
  },
  {
    id: "reminder-message",
    title: "Generate a concise user-facing message",
    userPrompt: "Write a polite one-sentence message asking my landlord to confirm the rent amount.",
    expectedClarification: false,
    expectedAnswerChecklist: [
      "writes a concise message",
      "keeps the tone polite",
      "does not ask questions when the request is already clear",
    ],
    description: "This checks whether the model can complete a simple writing task on first pass.",
  },
];

function isLikelyClarificationQuestion(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("?")) return true;
  return [
    "could you",
    "can you",
    "which",
    "what",
    "when",
    "where",
    "who",
    "do you mean",
    "please clarify",
    "i need",
    "i should ask",
  ].some((phrase) => normalized.startsWith(phrase) || normalized.includes(` ${phrase}`));
}

function scoreOverall(input: {
  judge: BenchmarkJudgeScore;
  task: BenchmarkTask;
  feedback: ReplyFeedbackStats;
}): number {
  const success = input.judge.taskSuccess ? 1 : 0;
  const feedbackWeight = input.feedback.totalVotes > 0 ? Math.min(0.3, input.feedback.totalVotes / 100) : 0;
  const feedbackSatisfaction = input.feedback.satisfactionScore ?? input.judge.userSatisfaction;
  const blendedSatisfaction =
    input.judge.userSatisfaction * (1 - feedbackWeight) + feedbackSatisfaction * feedbackWeight;
  const satisfaction = blendedSatisfaction / 5;
  const answerQuality = input.judge.answerQuality / 5;
  const clarificationQuality = input.judge.clarificationQuality / 5;
  const clarificationBonus = input.task.expectedClarification
    ? Math.min(1, input.judge.clarificationCount)
    : input.judge.clarificationCount === 0
      ? 1
      : 0;

  const weighted =
    success * 0.45 +
    satisfaction * 0.2 +
    answerQuality * 0.15 +
    clarificationQuality * 0.1 +
    clarificationBonus * 0.1;

  return Math.round(Math.max(0, Math.min(1, weighted)) * 100);
}

async function judgeTaskOutcome(input: {
  task: BenchmarkTask;
  transcript: BenchmarkTurn[];
  candidateModel: string;
  judgeModel: string;
  url?: string;
}): Promise<{ judge: BenchmarkJudgeScore; usage: AiUsageMetrics }> {
  const startedAt = Date.now();
  const prompt = [
    "You are grading a model benchmark conversation.",
    "Return JSON only with this exact shape:",
    "{",
    '  "taskSuccess": boolean,',
    '  "understoodFirstPrompt": boolean,',
    '  "clarificationCount": number,',
    '  "turnsToResolution": number,',
    '  "userSatisfaction": number,',
    '  "answerQuality": number,',
    '  "clarificationQuality": number,',
    '  "notes": string',
    "}",
    "",
    `Task title: ${input.task.title}`,
    `Task description: ${input.task.description}`,
    `Expected clarification: ${input.task.expectedClarification ? "yes" : "no"}`,
    `Expected answer checklist: ${input.task.expectedAnswerChecklist.map((item, index) => `${index + 1}. ${item}`).join(" ")}`,
    `Candidate model: ${input.candidateModel}`,
    `Judge model: ${input.judgeModel}`,
    "",
    "Transcript:",
    ...input.transcript.map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`),
    "",
    "Scoring guidance:",
    "- taskSuccess should be true only if the model's behavior matches the task intent and the final response is useful.",
    "- understoodFirstPrompt should be true only if the first assistant reply showed it understood the user's request without needing a correction.",
    "- clarificationCount should count useful clarification questions asked by the assistant.",
    "- turnsToResolution should count assistant turns until the task was answered or correctly clarified.",
    "- userSatisfaction is 1-5 and should reflect how likely a user would feel helped.",
    "- answerQuality is 1-5 and should reflect correctness and completeness.",
    "- clarificationQuality is 1-5 and should reflect whether the follow-up question was necessary and specific.",
    "- notes should be one short sentence.",
  ].join("\n");

  try {
    const result = await call9RouterChatCompletion({
      systemInstruction: "You are a strict benchmark judge. Output JSON only.",
      userPrompt: prompt,
      temperature: 0,
      model: input.judgeModel,
      url: input.url,
    });

    const parsed = JudgeScoreSchema.safeParse(parseModelJson(result.text));
    if (!parsed.success) {
      throw new Error("Judge model returned an invalid benchmark score.");
    }

    await recordAiRequestLog({
      feature: "admin_model_benchmark_judge",
      provider: "9router",
      model: input.judgeModel,
      success: true,
      usage: result.usage,
      latencyMs: Date.now() - startedAt,
    });

    return { judge: parsed.data, usage: result.usage };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Judge model failed";
    await recordAiRequestLog({
      feature: "admin_model_benchmark_judge",
      provider: "9router",
      model: input.judgeModel,
      success: false,
      latencyMs: Date.now() - startedAt,
      errorMessage: message,
    });
    throw error;
  }
}

export async function runModelBenchmark(input: {
  candidateModel: string;
  judgeModel: string;
  url?: string;
}): Promise<BenchmarkRun> {
  const candidateModel = normalize9RouterModel(input.candidateModel, input.candidateModel);
  const judgeModel = normalize9RouterModel(input.judgeModel, input.judgeModel);
  const feedback = await loadReplyFeedbackStats();

  const results: BenchmarkTaskResult[] = [];

  for (const task of BENCHMARK_TASKS) {
    const transcript: BenchmarkTurn[] = [];
    const usageParts: AiUsageMetrics[] = [];

    try {
      const firstStartedAt = Date.now();
      const firstResult = await call9RouterChatCompletion({
        systemInstruction:
          "You are a helpful finance assistant in a benchmark. Answer normally, ask a concise clarification only when the request is underspecified, and never mention the benchmark.",
        userPrompt: task.userPrompt,
        temperature: 0.2,
        model: candidateModel,
        url: input.url,
      });
      usageParts.push(firstResult.usage);

      await recordAiRequestLog({
        feature: "admin_model_benchmark_candidate",
        provider: "9router",
        model: candidateModel,
        success: true,
        usage: firstResult.usage,
        latencyMs: Date.now() - firstStartedAt,
      });

      transcript.push({ role: "user", content: task.userPrompt });
      transcript.push({ role: "assistant", content: firstResult.text.trim() });

      let clarificationCount = isLikelyClarificationQuestion(firstResult.text) ? 1 : 0;
      let turnsToResolution = 1;
      let finalReply = firstResult.text.trim();

      if (task.clarificationReply && clarificationCount > 0) {
        turnsToResolution += 1;
        transcript.push({ role: "user", content: task.clarificationReply });

        const secondStartedAt = Date.now();
        const secondResult = await call9RouterChatCompletion({
          systemInstruction:
            "You are a helpful finance assistant in a benchmark. Continue from the conversation and answer normally.",
          userPrompt: [
            `Original user request: ${task.userPrompt}`,
            `Assistant's clarification question: ${firstResult.text.trim()}`,
            `User's clarification answer: ${task.clarificationReply}`,
            "Continue the conversation and provide the best final answer.",
          ].join("\n"),
          temperature: 0.2,
          model: candidateModel,
          url: input.url,
        });
        usageParts.push(secondResult.usage);

        await recordAiRequestLog({
          feature: "admin_model_benchmark_candidate",
          provider: "9router",
          model: candidateModel,
          success: true,
          usage: secondResult.usage,
          latencyMs: Date.now() - secondStartedAt,
        });

        transcript.push({ role: "assistant", content: secondResult.text.trim() });
        finalReply = secondResult.text.trim();
        clarificationCount += isLikelyClarificationQuestion(secondResult.text) ? 1 : 0;
      }

      const judge = await judgeTaskOutcome({
        task,
        transcript,
        candidateModel,
        judgeModel,
        url: input.url,
      });

      const overallScore = scoreOverall({ judge: judge.judge, task, feedback });

      results.push({
        taskId: task.id,
        title: task.title,
        turns: transcript,
        turnsToResolution,
        clarificationCount,
        firstReply: firstResult.text.trim(),
        finalReply,
        judge: judge.judge,
        candidateUsage: sumUsage(usageParts),
        judgeUsage: judge.usage,
        overallScore,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Benchmark task failed";
      await recordAiRequestLog({
        feature: "admin_model_benchmark_candidate",
        provider: "9router",
        model: candidateModel,
        success: false,
        usage: sumUsage(usageParts),
        latencyMs: null,
        errorMessage: message,
      });
      results.push({
        taskId: task.id,
        title: task.title,
        turns: [
          { role: "user", content: task.userPrompt },
          { role: "assistant", content: `Benchmark failed: ${message}` },
        ],
        turnsToResolution: 1,
        clarificationCount: 0,
        firstReply: `Benchmark failed: ${message}`,
        finalReply: `Benchmark failed: ${message}`,
        judge: {
          taskSuccess: false,
          understoodFirstPrompt: false,
          clarificationCount: 0,
          turnsToResolution: 1,
          userSatisfaction: 1,
          answerQuality: 1,
          clarificationQuality: 1,
          notes: message.slice(0, 160),
        },
        candidateUsage: sumUsage(usageParts),
        judgeUsage: emptyUsage(),
        overallScore: 0,
      });
    }
  }

  const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
  const successfulTasks = results.filter((item) => item.judge.taskSuccess).length;
  const understoodFirstPrompt = results.filter((item) => item.judge.understoodFirstPrompt).length;

  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    candidateModel,
    judgeModel,
    totalTasks: results.length,
    averageScore: Math.round(average(results.map((item) => item.overallScore)) * 10) / 10,
    successRate: results.length ? Math.round((successfulTasks / results.length) * 1000) / 10 : 0,
    averageSatisfaction: Math.round(average(results.map((item) => item.judge.userSatisfaction)) * 10) / 10,
    realUserSatisfaction: feedback.satisfactionScore,
    thumbsUpRate: feedback.thumbsUpRate != null ? Math.round(feedback.thumbsUpRate * 1000) / 10 : null,
    thumbsDownRate: feedback.thumbsDownRate != null ? Math.round(feedback.thumbsDownRate * 1000) / 10 : null,
    feedbackVotes: feedback.totalVotes,
    averageClarificationCount: Math.round(average(results.map((item) => item.judge.clarificationCount)) * 10) / 10,
    averageTurnsToResolution: Math.round(average(results.map((item) => item.turnsToResolution)) * 10) / 10,
    firstPassUnderstandingRate: results.length
      ? Math.round((understoodFirstPrompt / results.length) * 1000) / 10
      : 0,
    results,
  };
}

export function getBenchmarkTasks(): BenchmarkTask[] {
  return BENCHMARK_TASKS;
}
