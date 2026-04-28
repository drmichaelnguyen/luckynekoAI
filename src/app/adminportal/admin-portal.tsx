"use client";

import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import {
  commitAndPushAdminPortalAction,
  getAdminPortalSnapshotAction,
  pullAndRestartAdminPortalAction,
  listUsersAction,
  resetUserPasswordAction,
  pushAdminPortalAction,
  runAdminBenchmarkAction,
  testAdminImageAction,
  testAdminModelAction,
  updateAdminRuntimeSettingsAction,
  setUserRoleAction,
  type AdminPortalSnapshot,
  type AdminUserRow,
  type AdminRuntimeSettings,
} from "@/actions/admin";
import type { BenchmarkRun, BenchmarkTaskResult } from "@/lib/ai/model-benchmark";
import { DEFAULT_9ROUTER_MODEL } from "@/lib/ai/9router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
  }).format(value);
}

function formatDateTime(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function formatGitVersion(snapshot: AdminPortalSnapshot["release"]) {
  const bits = snapshot.git.describe === snapshot.git.shortCommit
    ? [snapshot.git.describe]
    : [snapshot.git.describe, snapshot.git.shortCommit];
  return bits.join(" · ");
}

function createSettingsDraft(settings: AdminRuntimeSettings): AdminRuntimeSettings {
  return {
    routing: { ...settings.routing },
    learning: { ...settings.learning },
  };
}

function MetricCard(props: { label: string; value: string; tone?: "default" | "danger" }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{props.label}</div>
      <div className={cn("mt-2 text-2xl font-semibold", props.tone === "danger" && "text-destructive")}>
        {props.value}
      </div>
    </div>
  );
}

function CollapsibleSection(props: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  bodyClassName?: string;
}) {
  const [open, setOpen] = useState(Boolean(props.defaultOpen));

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-stretch justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
        >
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{props.title}</h2>
            {props.description ? <p className="text-xs text-muted-foreground">{props.description}</p> : null}
          </div>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        <div className="flex shrink-0 items-center gap-2">{props.actions}</div>
      </div>
      {open ? <div className={cn("p-4", props.bodyClassName)}>{props.children}</div> : null}
    </section>
  );
}

function BenchmarkTaskCard(props: { result: BenchmarkTaskResult }) {
  const { result } = props;
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">{result.title}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Score {result.overallScore}/100 · {result.turnsToResolution} turn{result.turnsToResolution === 1 ? "" : "s"} · {result.judge.userSatisfaction}/5 satisfaction
          </div>
        </div>
        <div className="rounded-full border px-2 py-1 text-xs">
          {result.judge.taskSuccess ? "Passed" : "Needs work"}
        </div>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
        <div>Clarifications: {result.clarificationCount}</div>
        <div>Understood first prompt: {result.judge.understoodFirstPrompt ? "Yes" : "No"}</div>
        <div>Answer quality: {result.judge.answerQuality}/5</div>
        <div>Clarification quality: {result.judge.clarificationQuality}/5</div>
      </div>
      <div className="mt-3 rounded-md border bg-muted/20 p-3 text-sm">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Judge notes</div>
        <div className="mt-1">{result.judge.notes}</div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">First reply</div>
          <div className="mt-1 whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm">{result.firstReply}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Final reply</div>
          <div className="mt-1 whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm">{result.finalReply}</div>
        </div>
      </div>
    </div>
  );
}

type BenchmarkModelOption = {
  value: string;
  label: string;
};

function buildBenchmarkModelOptions(
  snapshot: AdminPortalSnapshot | null,
  settings: AdminRuntimeSettings | null,
): BenchmarkModelOption[] {
  const options = new Map<string, BenchmarkModelOption>();
  const add = (value: string | null | undefined, label: string) => {
    const trimmed = value?.trim() ?? "";
    if (!trimmed || options.has(trimmed)) return;
    options.set(trimmed, { value: trimmed, label });
  };

  const workingModels = (snapshot?.models ?? [])
    .filter((row) => row.provider === "9router" && row.model.trim() && row.model !== "image-creation" && row.apiCalls > row.failedApiCalls)
    .sort((a, b) => b.apiCalls - a.apiCalls || a.model.localeCompare(b.model));

  for (const row of workingModels) {
    const workingCount = row.apiCalls - row.failedApiCalls;
    add(row.model, `${row.model} (${workingCount} working)`);
  }

  const routingMini = settings?.routing.nineRouterMiniModel?.trim();
  const routingLarge = settings?.routing.nineRouterModel?.trim();
  add(routingMini, `${routingMini} (routing first-pass)`);
  add(routingLarge, `${routingLarge} (routing large)`);
  add(DEFAULT_9ROUTER_MODEL, `${DEFAULT_9ROUTER_MODEL} (default)`);

  return Array.from(options.values());
}

export function AdminPortal() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [snapshot, setSnapshot] = useState<AdminPortalSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [releaseMsg, setReleaseMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [settings, setSettings] = useState<AdminRuntimeSettings | null>(null);
  const [settingsMsg, setSettingsMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [modelTestMsg, setModelTestMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [imageTestMsg, setImageTestMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [imageTestMode, setImageTestMode] = useState<"auto" | "9router" | "gemini">("auto");
  const [imageTestPrompt, setImageTestPrompt] = useState(
    "Create a square finance app icon for a money management app called NekoZeni. Show a friendly wallet with a coin, flat vector style, clean centered composition, teal and gold palette, transparent background, no text.",
  );
  const [imageTestResult, setImageTestResult] = useState<{ prompt: string; imageUrl: string; model: string; provider: string; latencyMs: number; requestUrl: string } | null>(null);
  const [benchmarkCandidateModel, setBenchmarkCandidateModel] = useState("");
  const [benchmarkJudgeModel, setBenchmarkJudgeModel] = useState("");
  const [benchmarkResult, setBenchmarkResult] = useState<BenchmarkRun | null>(null);
  const [benchmarkMsg, setBenchmarkMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [gitMessage, setGitMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const benchmarkModelOptions = useMemo(() => buildBenchmarkModelOptions(snapshot, settings), [snapshot, settings]);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([listUsersAction(), getAdminPortalSnapshotAction()])
      .then(([userRows, portalSnapshot]) => {
        setUsers(userRows);
        setSnapshot(portalSnapshot);
        setSettings(createSettingsDraft(portalSnapshot.settings));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (benchmarkModelOptions.length === 0) return;

    const candidateFallback = settings?.routing.nineRouterMiniModel ?? benchmarkModelOptions[0].value;
    const judgeFallback = settings?.routing.nineRouterModel ?? candidateFallback;

    setBenchmarkCandidateModel((current) => {
      if (current && benchmarkModelOptions.some((option) => option.value === current)) return current;
      return candidateFallback;
    });

    setBenchmarkJudgeModel((current) => {
      if (current && benchmarkModelOptions.some((option) => option.value === current)) return current;
      if (judgeFallback !== candidateFallback) return judgeFallback;
      return benchmarkModelOptions.find((option) => option.value !== candidateFallback)?.value ?? candidateFallback;
    });
  }, [benchmarkModelOptions, settings]);

  function flash(id: string, text: string, ok: boolean) {
    setMsg({ id, text, ok });
    window.setTimeout(() => setMsg(null), 3000);
  }

  function flashRelease(text: string, ok: boolean) {
    setReleaseMsg({ text, ok });
    window.setTimeout(() => setReleaseMsg(null), 5000);
  }

  function flashSettings(text: string, ok: boolean) {
    setSettingsMsg({ text, ok });
    window.setTimeout(() => setSettingsMsg(null), 5000);
  }

  function flashModelTest(text: string, ok: boolean) {
    setModelTestMsg({ text, ok });
    window.setTimeout(() => setModelTestMsg(null), 7000);
  }

  function flashImageTest(text: string, ok: boolean) {
    setImageTestMsg({ text, ok });
    window.setTimeout(() => setImageTestMsg(null), 7000);
  }

  function flashBenchmark(text: string, ok: boolean) {
    setBenchmarkMsg({ text, ok });
    window.setTimeout(() => setBenchmarkMsg(null), 7000);
  }

  function flashGit(text: string, ok: boolean) {
    setGitMessage({ text, ok });
    window.setTimeout(() => setGitMessage(null), 7000);
  }

  function updateRouting<K extends keyof AdminRuntimeSettings["routing"]>(
    key: K,
    value: AdminRuntimeSettings["routing"][K],
  ) {
    setSettings((current) => {
      if (!current) return current;
      return {
        ...current,
        routing: {
          ...current.routing,
          [key]: value,
        },
      };
    });
  }

  function updateLearning<K extends keyof AdminRuntimeSettings["learning"]>(
    key: K,
    value: AdminRuntimeSettings["learning"][K],
  ) {
    setSettings((current) => {
      if (!current) return current;
      return {
        ...current,
        learning: {
          ...current.learning,
          [key]: value,
        },
      };
    });
  }

  function handleResetPassword(userId: string) {
    if (!newPassword.trim()) return;
    startTransition(async () => {
      const res = await resetUserPasswordAction(userId, newPassword.trim());
      if (res.ok) {
        flash(userId, "Password updated", true);
        setNewPassword("");
        setActiveUserId(null);
      } else {
        flash(userId, res.error ?? "Failed", false);
      }
    });
  }

  function handleToggleRole(user: AdminUserRow) {
    const next = user.role === "admin" ? "user" : "admin";
    startTransition(async () => {
      const res = await setUserRoleAction(user.id, next);
      if (res.ok) {
        flash(user.id, `Role set to ${next}`, true);
        refresh();
      } else {
        flash(user.id, res.error ?? "Failed", false);
      }
    });
  }

  function handlePullAndRestart() {
    startTransition(async () => {
      const res = await pullAndRestartAdminPortalAction();
      if (res.ok) {
        flashRelease(res.message, true);
        refresh();
      } else {
        flashRelease(res.error ?? "Update failed", false);
      }
    });
  }

  function handleCommitAndPush() {
    if (!commitMessage.trim()) return;
    startTransition(async () => {
      const res = await commitAndPushAdminPortalAction(commitMessage.trim());
      if (res.ok) {
        flashGit(res.message, true);
        setCommitMessage("");
        refresh();
      } else {
        flashGit(res.error ?? "Commit/push failed", false);
      }
    });
  }

  function handlePush() {
    startTransition(async () => {
      const res = await pushAdminPortalAction();
      if (res.ok) {
        flashGit(res.message, true);
        refresh();
      } else {
        flashGit(res.error ?? "Push failed", false);
      }
    });
  }

  function handleSaveSettings() {
    if (!settings) return;
    startTransition(async () => {
      const res = await updateAdminRuntimeSettingsAction(settings);
      if (res.ok) {
        flashSettings("AI settings saved", true);
        setSettings(createSettingsDraft(res.settings));
        refresh();
      } else {
        flashSettings(res.error ?? "Failed to save settings", false);
      }
    });
  }

  function handleTestModel(model: string, label: string) {
    startTransition(async () => {
      const res = await testAdminModelAction({ model, url: settings?.routing.nineRouterUrl });
      if (res.ok) {
        const usageText =
          res.usage.totalTokens != null
            ? ` Tokens: ${formatNumber(res.usage.totalTokens)}.`
            : "";
        flashModelTest(`${label} worked: ${res.model} replied "${res.response}" in ${res.latencyMs} ms.${usageText}`, true);
      } else {
        flashModelTest(`${label} failed: ${res.error}`, false);
      }
    });
  }

  function handleTestImage(model: string) {
    const prompt = imageTestPrompt.trim();
    startTransition(async () => {
      const res = await testAdminImageAction({
        model,
        prompt,
        url: settings?.routing.nineRouterUrl,
        mode: imageTestMode,
      });
      if (res.ok) {
        setImageTestResult({
          prompt: res.prompt,
          imageUrl: res.imageUrl,
          model: res.model,
          provider: res.provider,
          latencyMs: res.latencyMs,
          requestUrl: res.requestUrl,
        });
        flashImageTest(`Image test worked: ${res.model} returned an image in ${res.latencyMs} ms.`, true);
      } else {
        setImageTestResult(null);
        flashImageTest(`Image test failed: ${res.error}`, false);
      }
    });
  }

  function handleRunBenchmark() {
    const candidateModel = benchmarkCandidateModel.trim();
    const judgeModel = benchmarkJudgeModel.trim();
    if (!candidateModel || !judgeModel) return;

    startTransition(async () => {
      const res = await runAdminBenchmarkAction({
        candidateModel,
        judgeModel,
        url: settings?.routing.nineRouterUrl,
      });

      if (res.ok) {
        setBenchmarkResult(res.run);
        flashBenchmark(
          `Benchmark finished: ${res.run.candidateModel} scored ${res.run.averageScore}/100 against ${res.run.judgeModel}.`,
          true,
        );
        refresh();
      } else {
        setBenchmarkResult(null);
        flashBenchmark(`Benchmark failed: ${res.error}`, false);
      }
    });
  }

  const mergedUsers = useMemo(() => {
    const usageMap = new Map(snapshot?.users.map((row) => [row.id, row]) ?? []);
    return users.map((user) => ({
      ...user,
      usage: usageMap.get(user.id),
    }));
  }, [snapshot?.users, users]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Admin portal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Separate admin interface for user access, model usage, token volume, and API failures.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Sections are collapsed by default. Open only what you need.</p>
        </div>
        <Button type="button" variant="outline" onClick={refresh} disabled={loading || isPending}>
          Refresh
        </Button>
      </div>

      {loading || !snapshot ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading admin data…</p>
      ) : (
        <div className="mt-8 space-y-8">
          <CollapsibleSection title="Overview" description="High-level traffic and token totals.">
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <MetricCard label="Users" value={formatNumber(snapshot.overview.totalUsers)} />
              <MetricCard label="Active 30d" value={formatNumber(snapshot.overview.activeUsers30d)} />
              <MetricCard label="API calls" value={formatNumber(snapshot.overview.totalApiCalls)} />
              <MetricCard
                label="API errors"
                value={formatNumber(snapshot.overview.failedApiCalls)}
                tone={snapshot.overview.failedApiCalls > 0 ? "danger" : "default"}
              />
              <MetricCard label="Tokens total" value={formatNumber(snapshot.overview.totalTokens)} />
              <MetricCard label="Tokens 30d" value={formatNumber(snapshot.overview.tokens30d)} />
            </div>
          </CollapsibleSection>

          <div className="grid gap-6 xl:grid-cols-2">
            <CollapsibleSection
              title="Release"
              description="App package version and current git checkout state."
              actions={
                <Button type="button" variant="outline" onClick={handlePullAndRestart} disabled={isPending}>
                  Pull latest and restart
                </Button>
              }
            >
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">App version</div>
                  <div className="mt-2 text-lg font-semibold">{snapshot.release.appVersion}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Git version</div>
                  <div className="mt-2 text-lg font-semibold">{formatGitVersion(snapshot.release)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Branch</div>
                  <div className="mt-2 text-lg font-semibold">{snapshot.release.git.branch}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {snapshot.release.git.commitDate ? new Date(snapshot.release.git.commitDate).toLocaleDateString() : "Unknown date"}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Checkout state</div>
                  <div className="mt-2 text-lg font-semibold">
                    {snapshot.release.git.dirty ? "Dirty" : "Clean"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {snapshot.release.git.ahead != null && snapshot.release.git.behind != null
                      ? `${snapshot.release.git.ahead} ahead / ${snapshot.release.git.behind} behind`
                      : snapshot.release.git.subject ?? "No commit subject available"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {snapshot.release.git.dirty
                      ? "Local changes are present; pull may fail until the checkout is clean."
                      : "Checkout is clean and ready for a pull."}
                  </div>
                </div>
              </div>
              {releaseMsg ? (
                <div className={cn("mt-4 rounded-md border px-3 py-2 text-sm", releaseMsg.ok ? "text-green-600" : "text-destructive")}>
                  {releaseMsg.text}
                </div>
              ) : null}
            </CollapsibleSection>

            <CollapsibleSection
              title="Git commands"
              description="Common admin actions for publishing local changes without opening a shell."
              actions={
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={handlePush} disabled={isPending}>
                    Push branch
                  </Button>
                  <Button type="button" onClick={handleCommitAndPush} disabled={isPending || !commitMessage.trim()}>
                    Commit and push
                  </Button>
                </div>
              }
            >
              <div className="space-y-4">
                <label className="block space-y-1 text-sm">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Commit message</span>
                  <Input
                    type="text"
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder='e.g. "Update admin portal"'
                    disabled={isPending}
                  />
                </label>
                <div className="text-xs text-muted-foreground">
                  Commit and push stages all local changes, then publishes them to the current branch.
                </div>
                {gitMessage ? (
                  <div className={cn("rounded-md border px-3 py-2 text-sm", gitMessage.ok ? "text-green-600" : "text-destructive")}>
                    {gitMessage.text}
                  </div>
                ) : null}
              </div>
            </CollapsibleSection>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <CollapsibleSection title="AI routing" description="Controls which provider and model names the AI actions use.">
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Chat provider</span>
                    <select
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={settings?.routing.chatPrimaryProvider ?? "auto"}
                      onChange={(e) => updateRouting("chatPrimaryProvider", e.target.value as AdminRuntimeSettings["routing"]["chatPrimaryProvider"])}
                      disabled={!settings || isPending}
                    >
                      <option value="auto">Auto</option>
                      <option value="gemini">Gemini</option>
                      <option value="9router">9router</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Structured provider</span>
                    <select
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={settings?.routing.structuredPrimaryProvider ?? "auto"}
                      onChange={(e) => updateRouting("structuredPrimaryProvider", e.target.value as AdminRuntimeSettings["routing"]["structuredPrimaryProvider"])}
                      disabled={!settings || isPending}
                    >
                      <option value="auto">Auto</option>
                      <option value="gemini">Gemini</option>
                      <option value="9router">9router</option>
                    </select>
                  </label>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Gemini model</span>
                    <Input
                      type="text"
                      value={settings?.routing.geminiModel ?? ""}
                      onChange={(e) => updateRouting("geminiModel", e.target.value)}
                      disabled={!settings || isPending}
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">9router first-pass model</span>
                    <Input
                      type="text"
                      value={settings?.routing.nineRouterMiniModel ?? ""}
                      onChange={(e) => updateRouting("nineRouterMiniModel", e.target.value)}
                      disabled={!settings || isPending}
                    />
                  </label>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">9router large model</span>
                    <Input
                      type="text"
                      value={settings?.routing.nineRouterModel ?? ""}
                      onChange={(e) => updateRouting("nineRouterModel", e.target.value)}
                      disabled={!settings || isPending}
                    />
                  </label>
                  <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    If set, this model is tried before the fallback model. Leave it on a supported 9router model name.
                  </div>
                </div>
                <label className="block space-y-1 text-sm">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">9router URL</span>
                  <Input
                    type="text"
                    value={settings?.routing.nineRouterUrl ?? ""}
                    onChange={(e) => updateRouting("nineRouterUrl", e.target.value)}
                    disabled={!settings || isPending}
                  />
                </label>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleTestModel(settings?.routing.nineRouterMiniModel ?? "", "First-pass model")}
                    disabled={!settings || isPending}
                  >
                    Test first-pass model
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleTestModel(settings?.routing.nineRouterModel ?? "", "Large model")}
                    disabled={!settings || isPending}
                  >
                    Test large model
                  </Button>
                  <Button type="button" onClick={handleSaveSettings} disabled={!settings || isPending}>
                    Save routing
                  </Button>
                </div>
                {modelTestMsg ? (
                  <div className={cn("rounded-md border px-3 py-2 text-sm", modelTestMsg.ok ? "text-green-600" : "text-destructive")}>
                    {modelTestMsg.text}
                  </div>
                ) : null}
                <div className="mt-2 rounded-md border bg-muted/20 p-3">
                  <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Image creation test</div>
                  <label className="block space-y-1 text-sm">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Prompt</span>
                    <textarea
                      className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-0 placeholder:text-muted-foreground focus:border-primary"
                      value={imageTestPrompt}
                      onChange={(e) => setImageTestPrompt(e.target.value)}
                      disabled={!settings || isPending}
                      placeholder="Describe the icon or image to generate"
                    />
                  </label>
                  <label className="block space-y-1 text-sm mt-3">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Mode</span>
                    <select
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={imageTestMode}
                      onChange={(e) => setImageTestMode(e.target.value as "auto" | "9router" | "gemini")}
                      disabled={!settings || isPending}
                    >
                      <option value="auto">Auto fallback</option>
                      <option value="9router">9router only</option>
                      <option value="gemini">Gemini only</option>
                    </select>
                  </label>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleTestImage("image-creation")}
                      disabled={!settings || isPending}
                    >
                      Test image-creation
                    </Button>
                  </div>
                  {imageTestMsg ? (
                    <div className={cn("mt-3 rounded-md border px-3 py-2 text-sm", imageTestMsg.ok ? "text-green-600" : "text-destructive")}>
                      {imageTestMsg.text}
                    </div>
                  ) : null}
                  {imageTestResult ? (
                    <div className="mt-3 space-y-3">
                      <div className="rounded-md border bg-background p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imageTestResult.imageUrl}
                          alt="9router image test result"
                          className="max-h-80 w-full rounded-md object-contain"
                        />
                      </div>
                      <div className="space-y-1 rounded-md border bg-background px-3 py-2 text-xs">
                        <div><span className="font-medium">Model:</span> {imageTestResult.model}</div>
                        <div><span className="font-medium">Provider:</span> {imageTestResult.provider}</div>
                        <div><span className="font-medium">Mode:</span> {imageTestMode}</div>
                        <div><span className="font-medium">Latency:</span> {imageTestResult.latencyMs} ms</div>
                        <div className="break-words"><span className="font-medium">Endpoint:</span> {imageTestResult.requestUrl}</div>
                        <div className="break-words"><span className="font-medium">Prompt:</span> {imageTestResult.prompt}</div>
                        <div className="break-words"><span className="font-medium">Source:</span> {imageTestResult.imageUrl}</div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Machine learning"
              description="Toggles the app-wide learning signals used in chat and import flows."
            >
              <div className="space-y-4">
                <label className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">Learn chat preferences</div>
                    <div className="text-xs text-muted-foreground">Store language, verbosity, and explicit instructions from chat.</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings?.learning.enableChatPreferenceLearning ?? true}
                    onChange={(e) => updateLearning("enableChatPreferenceLearning", e.target.checked)}
                    disabled={!settings || isPending}
                  />
                </label>
                <label className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">Learn merchant categories</div>
                    <div className="text-xs text-muted-foreground">Apply historic merchant-to-category hints to imports and prompts.</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings?.learning.enableMerchantLearning ?? true}
                    onChange={(e) => updateLearning("enableMerchantLearning", e.target.checked)}
                    disabled={!settings || isPending}
                  />
                </label>
                <label className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">Use correction examples</div>
                    <div className="text-xs text-muted-foreground">Feed past user edit examples into the finance context.</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings?.learning.enableCorrectionLearning ?? true}
                    onChange={(e) => updateLearning("enableCorrectionLearning", e.target.checked)}
                    disabled={!settings || isPending}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Merchant hint threshold</span>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={settings?.learning.merchantLearningMinFrequency ?? 3}
                    onChange={(e) => updateLearning("merchantLearningMinFrequency", Number(e.target.value || 1))}
                    disabled={!settings || isPending}
                  />
                </label>
                <div className="flex justify-end">
                  <Button type="button" onClick={handleSaveSettings} disabled={!settings || isPending}>
                    Save learning
                  </Button>
                </div>
              </div>
              {settingsMsg ? (
                <div className={cn("mt-4 rounded-md border px-3 py-2 text-sm", settingsMsg.ok ? "text-green-600" : "text-destructive")}>
                  {settingsMsg.text}
                </div>
              ) : null}
            </CollapsibleSection>
          </div>

          <CollapsibleSection
            title="Model benchmark"
            description="Runs a fixed task set against the candidate model, then blends the judge score with live thumbs-up/thumbs-down feedback from real chat replies."
          >
            <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Candidate model</span>
                    <select
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={benchmarkCandidateModel}
                      onChange={(e) => setBenchmarkCandidateModel(e.target.value)}
                      disabled={!settings || isPending || benchmarkModelOptions.length === 0}
                    >
                      {benchmarkModelOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Judge model</span>
                    <select
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={benchmarkJudgeModel}
                      onChange={(e) => setBenchmarkJudgeModel(e.target.value)}
                      disabled={!settings || isPending || benchmarkModelOptions.length === 0}
                    >
                      {benchmarkModelOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                  The dropdown is populated from working 9router models observed in the app, plus the current routing defaults.
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={handleRunBenchmark}
                    disabled={!settings || isPending || !benchmarkCandidateModel.trim() || !benchmarkJudgeModel.trim()}
                  >
                    Run benchmark
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setBenchmarkCandidateModel(settings?.routing.nineRouterMiniModel ?? "");
                      setBenchmarkJudgeModel(settings?.routing.nineRouterModel ?? "");
                    }}
                    disabled={!settings || isPending}
                  >
                    Reset to routing defaults
                  </Button>
                </div>
                {benchmarkMsg ? (
                  <div className={cn("rounded-md border px-3 py-2 text-sm", benchmarkMsg.ok ? "text-green-600" : "text-destructive")}>
                    {benchmarkMsg.text}
                  </div>
                ) : null}
                {benchmarkResult ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <MetricCard label="Overall score" value={`${formatDecimal(benchmarkResult.averageScore)}/100`} />
                    <MetricCard label="Success rate" value={`${formatDecimal(benchmarkResult.successRate)}%`} />
                    <MetricCard label="Satisfaction" value={`${formatDecimal(benchmarkResult.averageSatisfaction)}/5`} />
                    <MetricCard
                      label="Real user satisfaction"
                      value={
                        benchmarkResult.realUserSatisfaction == null
                          ? "No votes yet"
                          : `${formatDecimal(benchmarkResult.realUserSatisfaction)}/5`
                      }
                    />
                    <MetricCard label="Clarification count" value={formatDecimal(benchmarkResult.averageClarificationCount)} />
                    <MetricCard label="Turns to resolve" value={formatDecimal(benchmarkResult.averageTurnsToResolution)} />
                    <MetricCard label="First-pass understanding" value={`${formatDecimal(benchmarkResult.firstPassUnderstandingRate)}%`} />
                    <MetricCard label="Feedback votes" value={formatNumber(benchmarkResult.feedbackVotes)} />
                  </div>
                ) : null}
              </div>
              <div className="space-y-4">
                <div className="rounded-lg border bg-background p-4">
                  <div className="font-medium">Latest run</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {benchmarkResult
                      ? `${benchmarkResult.candidateModel} vs ${benchmarkResult.judgeModel} · ${new Date(benchmarkResult.createdAt).toLocaleString()}`
                      : "No run in the current session yet."}
                  </div>
                  {benchmarkResult ? (
                    <div className="mt-4 space-y-3">
                      {benchmarkResult.results.map((result) => (
                        <BenchmarkTaskCard key={result.taskId} result={result} />
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-lg border bg-background p-4">
                  <div className="font-medium">Recent runs</div>
                  <div className="mt-3 space-y-3">
                    {snapshot.benchmarkHistory.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No saved benchmark runs yet.</div>
                    ) : (
                      snapshot.benchmarkHistory.map((run) => (
                        <div key={run.id} className="rounded-md border px-3 py-2 text-sm">
                          <div className="font-medium">
                            {run.candidateModel} vs {run.judgeModel}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {new Date(run.createdAt).toLocaleString()} · score {run.averageScore}/100 · success {formatDecimal(run.successRate)}%
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-lg border bg-background p-4">
                  <div className="font-medium">Live reply feedback</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {snapshot.replyFeedback.totalVotes > 0
                      ? `${formatNumber(snapshot.replyFeedback.totalVotes)} votes · ${formatDecimal(snapshot.replyFeedback.thumbsUpRate ?? 0)}% thumbs up · ${formatDecimal(snapshot.replyFeedback.satisfactionScore ?? 0)}/5 satisfaction`
                      : "No assistant reply votes have been recorded yet."}
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <MetricCard label="Thumbs up" value={formatNumber(snapshot.replyFeedback.thumbsUp)} />
                    <MetricCard label="Thumbs down" value={formatNumber(snapshot.replyFeedback.thumbsDown)} />
                  </div>
                </div>
              </div>
            </div>
          </CollapsibleSection>

          <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
            <CollapsibleSection title="Users" description="User access, roles, and password resets.">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/20 text-left text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">User</th>
                      <th className="px-4 py-3 font-medium">Role</th>
                      <th className="px-4 py-3 font-medium">Calls</th>
                      <th className="px-4 py-3 font-medium">Errors</th>
                      <th className="px-4 py-3 font-medium">Tokens</th>
                      <th className="px-4 py-3 font-medium">Last usage</th>
                      <th className="px-4 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mergedUsers.map((user) => (
                      <tr key={user.id} className="border-t align-top">
                        <td className="px-4 py-3">
                          <div className="font-medium">{user.email}</div>
                          <div className="text-xs text-muted-foreground">
                            {user.name ?? "No name"} · joined {new Date(user.createdAt).toLocaleDateString()}
                          </div>
                        </td>
                        <td className="px-4 py-3">{user.role}</td>
                        <td className="px-4 py-3">{formatNumber(user.usage?.apiCalls ?? 0)}</td>
                        <td className="px-4 py-3">{formatNumber(user.usage?.failedApiCalls ?? 0)}</td>
                        <td className="px-4 py-3">{formatNumber(user.usage?.totalTokens ?? 0)}</td>
                        <td className="px-4 py-3">{formatDateTime(user.usage?.lastSeenAt ?? null)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isPending || user.roleLocked}
                              onClick={() => handleToggleRole(user)}
                            >
                              {user.roleLocked
                                ? "Admin locked"
                                : user.role === "admin"
                                  ? "Revoke admin"
                                  : "Make admin"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setActiveUserId(activeUserId === user.id ? null : user.id);
                                setNewPassword("");
                              }}
                            >
                              Reset password
                            </Button>
                          </div>
                          {activeUserId === user.id ? (
                            <div className="mt-3 flex gap-2">
                              <Input
                                type="text"
                                placeholder="New password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleResetPassword(user.id);
                                }}
                                className="h-8 text-sm"
                                autoFocus
                              />
                              <Button
                                type="button"
                                size="sm"
                                disabled={isPending || !newPassword.trim()}
                                onClick={() => handleResetPassword(user.id)}
                              >
                                Save
                              </Button>
                            </div>
                          ) : null}
                          {msg?.id === user.id ? (
                            <p className={cn("mt-2 text-xs", msg.ok ? "text-green-600" : "text-destructive")}>
                              {msg.text}
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>

            <div className="space-y-6">
              <CollapsibleSection title="Model usage" description="Per-model API calls, errors, and token totals.">
                <div className="max-h-[420px] overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/20 text-left text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Model</th>
                        <th className="px-4 py-3 font-medium">Calls</th>
                        <th className="px-4 py-3 font-medium">Errors</th>
                        <th className="px-4 py-3 font-medium">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.models.map((row) => (
                        <tr key={`${row.provider}:${row.model}`} className="border-t">
                          <td className="px-4 py-3">
                            <div className="font-medium">{row.model}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.provider} · avg {row.avgLatencyMs ?? 0} ms
                            </div>
                          </td>
                          <td className="px-4 py-3">{formatNumber(row.apiCalls)}</td>
                          <td className="px-4 py-3">{formatNumber(row.failedApiCalls)}</td>
                          <td className="px-4 py-3">{formatNumber(row.totalTokens)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Workflows" description="Feature-level API calls, errors, and token totals.">
                <div className="max-h-[320px] overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/20 text-left text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Feature</th>
                        <th className="px-4 py-3 font-medium">Calls</th>
                        <th className="px-4 py-3 font-medium">Errors</th>
                        <th className="px-4 py-3 font-medium">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.features.map((row) => (
                        <tr key={row.feature} className="border-t">
                          <td className="px-4 py-3">{row.feature}</td>
                          <td className="px-4 py-3">{formatNumber(row.apiCalls)}</td>
                          <td className="px-4 py-3">{formatNumber(row.failedApiCalls)}</td>
                          <td className="px-4 py-3">{formatNumber(row.totalTokens)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CollapsibleSection>
            </div>
          </div>

          <CollapsibleSection title="Recent API errors" description="The latest API failures recorded by the app.">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/20 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium">Feature</th>
                    <th className="px-4 py-3 font-medium">Model</th>
                    <th className="px-4 py-3 font-medium">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.recentErrors.length === 0 ? (
                    <tr className="border-t">
                      <td className="px-4 py-4 text-muted-foreground" colSpan={5}>
                        No API errors recorded.
                      </td>
                    </tr>
                  ) : (
                    snapshot.recentErrors.map((row) => (
                      <tr key={row.id} className="border-t align-top">
                        <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
                        <td className="px-4 py-3">{row.email ?? "Unknown user"}</td>
                        <td className="px-4 py-3">{row.feature}</td>
                        <td className="px-4 py-3">
                          {row.provider} / {row.model}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{row.errorMessage ?? "Unknown error"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}
