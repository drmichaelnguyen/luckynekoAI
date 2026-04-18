"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { listUsersAction, resetUserPasswordAction, setUserRoleAction } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
};

export function AdminPanel() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    setLoading(true);
    listUsersAction()
      .then(setUsers)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  function flash(id: string, text: string, ok: boolean) {
    setMsg({ id, text, ok });
    setTimeout(() => setMsg(null), 3000);
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

  function handleToggleRole(user: UserRow) {
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">Admin — Users</h1>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-3">
          {users.map((u) => (
            <div key={u.id} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{u.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {u.name ?? "—"} · {u.role} · joined {new Date(u.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => handleToggleRole(u)}
                  >
                    {u.role === "admin" ? "Revoke admin" : "Make admin"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setActiveUserId(activeUserId === u.id ? null : u.id);
                      setNewPassword("");
                    }}
                  >
                    Reset password
                  </Button>
                </div>
              </div>

              {activeUserId === u.id && (
                <div className="mt-3 flex gap-2">
                  <Input
                    type="text"
                    placeholder="New password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleResetPassword(u.id); }}
                    className="h-8 text-sm"
                    autoFocus
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending || !newPassword.trim()}
                    onClick={() => handleResetPassword(u.id)}
                  >
                    Save
                  </Button>
                </div>
              )}

              {msg?.id === u.id && (
                <p className={cn("mt-2 text-xs", msg.ok ? "text-green-600" : "text-destructive")}>
                  {msg.text}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
