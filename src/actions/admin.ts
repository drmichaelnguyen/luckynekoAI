"use server";

import { hash } from "bcryptjs";

import { auth } from "@/auth";
import {
  call9RouterChatCompletion,
  DEFAULT_9ROUTER_MODEL,
  has9RouterConfig,
  normalize9RouterModel,
} from "@/lib/ai/9router";
import { recordAiRequestLog } from "@/lib/ai/telemetry";
import {
  loadAdminRuntimeSettings,
  saveAdminRuntimeSettings,
  type AdminRuntimeSettings as AdminRuntimeSettingsValue,
} from "@/lib/admin-runtime-settings";
import { hasAdminAccess, isAdminEmail, resolveUserRole } from "@/lib/admin-access";
import { APP_VERSION } from "@/lib/app-version";
import {
  commitAndPushCurrentBranch,
  readGitStatusInfo,
  pushCurrentBranch,
  updateFromGitAndRestart,
  type GitStatusInfo,
} from "@/lib/git";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await auth();
  if (!hasAdminAccess(session)) {
    throw new Error("Unauthorized");
  }
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session.user.id;
}

export type AdminUserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  roleLocked: boolean;
  createdAt: string;
};

export type AdminRuntimeSettings = AdminRuntimeSettingsValue;

export async function listUsersAction(): Promise<AdminUserRow[]> {
  await requireAdmin();
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return users.map((user) => ({
    ...user,
    role: resolveUserRole({ email: user.email, role: user.role }),
    roleLocked: isAdminEmail(user.email),
    createdAt: user.createdAt.toISOString(),
  }));
}

export async function resetUserPasswordAction(
  targetUserId: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  if (!newPassword || newPassword.length < 4) {
    return { ok: false, error: "Password must be at least 4 characters" };
  }
  const passwordHash = await hash(newPassword, 12);
  await prisma.user.update({ where: { id: targetUserId }, data: { passwordHash } });
  return { ok: true };
}

export async function setUserRoleAction(
  targetUserId: string,
  role: "user" | "admin",
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  await prisma.user.update({ where: { id: targetUserId }, data: { role } });
  return { ok: true };
}

export type AdminPortalSnapshot = {
  generatedAt: string;
  release: {
    appVersion: string;
    git: GitStatusInfo;
  };
  settings: AdminRuntimeSettings;
  overview: {
    totalUsers: number;
    activeUsers30d: number;
    totalApiCalls: number;
    failedApiCalls: number;
    totalTokens: number;
    tokens30d: number;
  };
  users: Array<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    roleLocked: boolean;
    createdAt: string;
    apiCalls: number;
    failedApiCalls: number;
    totalTokens: number;
    lastSeenAt: string | null;
  }>;
  models: Array<{
    provider: string;
    model: string;
    apiCalls: number;
    failedApiCalls: number;
    totalTokens: number;
    avgLatencyMs: number | null;
    lastUsedAt: string | null;
  }>;
  features: Array<{
    feature: string;
    apiCalls: number;
    failedApiCalls: number;
    totalTokens: number;
    lastUsedAt: string | null;
  }>;
  recentErrors: Array<{
    id: string;
    createdAt: string;
    feature: string;
    provider: string;
    model: string;
    email: string | null;
    errorMessage: string | null;
  }>;
};

export async function getAdminPortalSnapshotAction(): Promise<AdminPortalSnapshot> {
  await requireAdmin();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    settings,
    git,
    users,
    overall,
    errorsCount,
    activeUsers,
    logs30d,
    userGroups,
    modelGroups,
    featureGroups,
    recentErrors,
  ] = await Promise.all([
    loadAdminRuntimeSettings(),
    readGitStatusInfo(),
    prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }],
    }),
    prisma.aiRequestLog.aggregate({
      _count: { _all: true },
      _sum: { totalTokens: true },
    }),
    prisma.aiRequestLog.count({ where: { success: false } }),
    prisma.aiRequestLog.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: thirtyDaysAgo }, userId: { not: null } },
    }),
    prisma.aiRequestLog.aggregate({
      where: { createdAt: { gte: thirtyDaysAgo } },
      _sum: { totalTokens: true },
    }),
    prisma.aiRequestLog.groupBy({
      by: ["userId"],
      where: { userId: { not: null } },
      _count: { _all: true },
      _sum: { totalTokens: true },
      _max: { createdAt: true },
    }),
    prisma.aiRequestLog.groupBy({
      by: ["provider", "model"],
      _count: { _all: true },
      _sum: { totalTokens: true, latencyMs: true },
      _max: { createdAt: true },
    }),
    prisma.aiRequestLog.groupBy({
      by: ["feature"],
      _count: { _all: true },
      _sum: { totalTokens: true },
      _max: { createdAt: true },
    }),
    prisma.aiRequestLog.findMany({
      where: { success: false },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        createdAt: true,
        feature: true,
        provider: true,
        model: true,
        errorMessage: true,
        user: { select: { email: true } },
      },
    }),
  ]);

  const failedByUser = await prisma.aiRequestLog.groupBy({
    by: ["userId"],
    where: { success: false, userId: { not: null } },
    _count: { _all: true },
  });
  const failedByModel = await prisma.aiRequestLog.groupBy({
    by: ["provider", "model"],
    where: { success: false },
    _count: { _all: true },
  });
  const failedByFeature = await prisma.aiRequestLog.groupBy({
    by: ["feature"],
    where: { success: false },
    _count: { _all: true },
  });

  const userUsageMap = new Map(
    userGroups.map((group) => [
      group.userId ?? "",
      {
        apiCalls: group._count._all,
        totalTokens: group._sum.totalTokens ?? 0,
        lastSeenAt: group._max.createdAt?.toISOString() ?? null,
      },
    ]),
  );
  const userErrorMap = new Map(failedByUser.map((group) => [group.userId ?? "", group._count._all]));
  const modelErrorMap = new Map(
    failedByModel.map((group) => [`${group.provider}::${group.model}`, group._count._all]),
  );
  const featureErrorMap = new Map(failedByFeature.map((group) => [group.feature, group._count._all]));

  return {
    generatedAt: new Date().toISOString(),
    release: {
      appVersion: APP_VERSION,
      git,
    },
    settings,
    overview: {
      totalUsers: users.length,
      activeUsers30d: activeUsers.filter((group) => group.userId).length,
      totalApiCalls: overall._count._all,
      failedApiCalls: errorsCount,
      totalTokens: overall._sum.totalTokens ?? 0,
      tokens30d: logs30d._sum.totalTokens ?? 0,
    },
    users: users.map((user) => {
      const usage = userUsageMap.get(user.id);
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: resolveUserRole({ email: user.email, role: user.role }),
        roleLocked: isAdminEmail(user.email),
        createdAt: user.createdAt.toISOString(),
        apiCalls: usage?.apiCalls ?? 0,
        failedApiCalls: userErrorMap.get(user.id) ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
        lastSeenAt: usage?.lastSeenAt ?? null,
      };
    }),
    models: modelGroups
      .map((group) => ({
        provider: group.provider,
        model: group.model,
        apiCalls: group._count._all,
        failedApiCalls: modelErrorMap.get(`${group.provider}::${group.model}`) ?? 0,
        totalTokens: group._sum.totalTokens ?? 0,
        avgLatencyMs:
          group._sum.latencyMs != null && group._count._all > 0
            ? Math.round(group._sum.latencyMs / group._count._all)
            : null,
        lastUsedAt: group._max.createdAt?.toISOString() ?? null,
      }))
      .sort((a, b) => b.apiCalls - a.apiCalls),
    features: featureGroups
      .map((group) => ({
        feature: group.feature,
        apiCalls: group._count._all,
        failedApiCalls: featureErrorMap.get(group.feature) ?? 0,
        totalTokens: group._sum.totalTokens ?? 0,
        lastUsedAt: group._max.createdAt?.toISOString() ?? null,
      }))
      .sort((a, b) => b.apiCalls - a.apiCalls),
    recentErrors: recentErrors.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      feature: row.feature,
      provider: row.provider,
      model: row.model,
      email: row.user?.email ?? null,
      errorMessage: row.errorMessage,
    })),
  };
}

export async function updateAdminRuntimeSettingsAction(
  nextSettings: AdminRuntimeSettings,
): Promise<{ ok: true; settings: AdminRuntimeSettings } | { ok: false; error: string }> {
  await requireAdmin();
  try {
    const settings = await saveAdminRuntimeSettings(nextSettings);
    return { ok: true, settings };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to save admin settings",
    };
  }
}

export type AdminModelTestResult =
  | {
      ok: true;
      provider: "9router";
      model: string;
      response: string;
      usage: {
        promptTokens: number | null;
        completionTokens: number | null;
        totalTokens: number | null;
      };
      latencyMs: number;
    }
  | { ok: false; provider: "9router"; model: string; error: string };

export async function testAdminModelAction(input: {
  model: string;
  url?: string;
}): Promise<AdminModelTestResult> {
  await requireAdmin();

  const model = normalize9RouterModel(input.model, DEFAULT_9ROUTER_MODEL);
  if (!has9RouterConfig()) {
    return { ok: false, provider: "9router", model, error: "Server is missing NINE_ROUTER_API_KEY." };
  }

  const startedAt = Date.now();
  try {
    const result = await call9RouterChatCompletion({
      systemInstruction: "You are a model connectivity test. Reply with exactly OK.",
      userPrompt: "Say OK.",
      temperature: 0,
      model,
      url: input.url,
    });

    await recordAiRequestLog({
      feature: "admin_model_test",
      provider: "9router",
      model,
      success: true,
      usage: result.usage,
      latencyMs: Date.now() - startedAt,
    });

    return {
      ok: true,
      provider: "9router",
      model,
      response: result.text.trim(),
      usage: result.usage,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model test failed";
    await recordAiRequestLog({
      feature: "admin_model_test",
      provider: "9router",
      model,
      success: false,
      latencyMs: Date.now() - startedAt,
      errorMessage: message,
    });
    return { ok: false, provider: "9router", model, error: message };
  }
}

export async function pullAndRestartAdminPortalAction(): Promise<
  | { ok: true; message: string; branch: string; restartQueued: boolean }
  | { ok: false; error: string }
> {
  await requireAdmin();

  try {
    const result = await updateFromGitAndRestart();
    return {
      ok: true,
      message: `Pulled latest code for ${result.branch}. Build completed and restart queued.`,
      branch: result.branch,
      restartQueued: result.restartQueued,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to update from git",
    };
  }
}

export async function commitAndPushAdminPortalAction(
  commitMessage: string,
): Promise<{ ok: true; message: string; branch: string } | { ok: false; error: string }> {
  await requireAdmin();

  try {
    const result = await commitAndPushCurrentBranch(commitMessage);
    return {
      ok: true,
      message: result.output || `Committed changes and pushed ${result.branch}.`,
      branch: result.branch,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to commit and push changes",
    };
  }
}

export async function pushAdminPortalAction(): Promise<
  { ok: true; message: string; branch: string } | { ok: false; error: string }
> {
  await requireAdmin();

  try {
    const result = await pushCurrentBranch();
    return {
      ok: true,
      message: result.output || `Pushed ${result.branch}.`,
      branch: result.branch,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to push changes",
    };
  }
}
