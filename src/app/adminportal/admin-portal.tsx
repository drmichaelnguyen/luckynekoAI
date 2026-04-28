"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import {
  commitAndPushAdminPortalAction,
  getAdminPortalSnapshotAction,
  pullAndRestartAdminPortalAction,
  listUsersAction,
  resetUserPasswordAction,
  pushAdminPortalAction,
  updateAdminRuntimeSettingsAction,
  setUserRoleAction,
  type AdminPortalSnapshot,
  type AdminUserRow,
  type AdminRuntimeSettings,
} from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
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
  const [gitMessage, setGitMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [isPending, startTransition] = useTransition();

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
        </div>
        <Button type="button" variant="outline" onClick={refresh} disabled={loading || isPending}>
          Refresh
        </Button>
      </div>

      {loading || !snapshot ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading admin data…</p>
      ) : (
        <div className="mt-8 space-y-8">
          <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
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
          </section>

          <section className="rounded-lg border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Release</h2>
                <p className="text-xs text-muted-foreground">
                  Shows the app package version and the current git checkout state.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={handlePullAndRestart} disabled={isPending}>
                Pull latest and restart
              </Button>
            </div>
            <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-4">
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
              <div className={cn("border-t px-4 py-3 text-sm", releaseMsg.ok ? "text-green-600" : "text-destructive")}>
                {releaseMsg.text}
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Git Commands</h2>
                <p className="text-xs text-muted-foreground">
                  Common admin actions for publishing local changes without opening a shell.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={handlePush} disabled={isPending}>
                  Push branch
                </Button>
                <Button type="button" onClick={handleCommitAndPush} disabled={isPending || !commitMessage.trim()}>
                  Commit and push
                </Button>
              </div>
            </div>
            <div className="space-y-4 p-4">
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
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-lg border bg-card">
              <div className="border-b bg-muted/30 px-4 py-3">
                <h2 className="text-sm font-semibold">Model Routing</h2>
                <p className="text-xs text-muted-foreground">
                  Controls which provider and model names the AI actions use.
                </p>
              </div>
              <div className="space-y-4 p-4">
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
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">9router model</span>
                    <Input
                      type="text"
                      value={settings?.routing.nineRouterModel ?? ""}
                      onChange={(e) => updateRouting("nineRouterModel", e.target.value)}
                      disabled={!settings || isPending}
                    />
                  </label>
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
                <div className="flex justify-end">
                  <Button type="button" onClick={handleSaveSettings} disabled={!settings || isPending}>
                    Save routing
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-lg border bg-card">
              <div className="border-b bg-muted/30 px-4 py-3">
                <h2 className="text-sm font-semibold">Machine Learning</h2>
                <p className="text-xs text-muted-foreground">
                  Toggles the app-wide learning signals used in chat and import flows.
                </p>
              </div>
              <div className="space-y-4 p-4">
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
                <div className={cn("border-t px-4 py-3 text-sm", settingsMsg.ok ? "text-green-600" : "text-destructive")}>
                  {settingsMsg.text}
                </div>
              ) : null}
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
            <div className="overflow-hidden rounded-lg border">
              <div className="border-b bg-muted/30 px-4 py-3">
                <h2 className="text-sm font-semibold">Users</h2>
              </div>
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
            </div>

            <div className="space-y-6">
              <div className="overflow-hidden rounded-lg border">
                <div className="border-b bg-muted/30 px-4 py-3">
                  <h2 className="text-sm font-semibold">Model usage</h2>
                </div>
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
              </div>

              <div className="overflow-hidden rounded-lg border">
                <div className="border-b bg-muted/30 px-4 py-3">
                  <h2 className="text-sm font-semibold">Workflows</h2>
                </div>
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
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border">
            <div className="border-b bg-muted/30 px-4 py-3">
              <h2 className="text-sm font-semibold">Recent API errors</h2>
            </div>
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
          </section>
        </div>
      )}
    </div>
  );
}
