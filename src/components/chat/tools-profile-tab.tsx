"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActionState, useCallback, useEffect, useState, useTransition } from "react";

import {
  changePasswordAction,
  getProfileAction,
  removeAvatarAction,
  updateProfileAction,
  uploadAvatarAction,
  type ProfileState,
} from "@/actions/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

const initialState: ProfileState = { ok: true, error: null, message: null };

export function ToolsProfileTab({ active }: { active: boolean }) {
  const router = useRouter();
  const { update } = useSession();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [hasAvatar, setHasAvatar] = useState(false);
  const [avatarNonce, setAvatarNonce] = useState(0);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const [profileState, profileFormAction] = useActionState(updateProfileAction, initialState);
  const [passwordState, passwordFormAction] = useActionState(changePasswordAction, initialState);

  useEffect(() => {
    if (!active) return;
    void (async () => {
      const r = await getProfileAction();
      if (r.ok) {
        setName(r.name);
        setNickname(r.nickname);
        setEmail(r.email);
        setHasAvatar(r.hasAvatar);
      }
    })();
  }, [active, avatarNonce]);

  const syncSessionFromForm = useCallback(async () => {
    await update({
      name: name.trim() || null,
      nickname: nickname.trim() || null,
      image: hasAvatar ? "/api/user/avatar" : null,
    });
    router.refresh();
  }, [name, nickname, hasAvatar, update, router]);

  useEffect(() => {
    if (profileState.message === "Profile saved.") {
      void syncSessionFromForm();
    }
  }, [profileState.message, syncSessionFromForm]);

  return (
    <div className="space-y-6 text-sm">
      <div>
        <h3 className="text-xs font-medium text-foreground">Profile</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Name is your display label. Nickname is how the assistant usually addresses you in chat.
        </p>
        <div className="mt-3 flex items-center gap-4">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border bg-muted">
            {hasAvatar ? (
              <img
                src={`/api/user/avatar?n=${avatarNonce}`}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] text-muted-foreground">
                No photo
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="max-w-full text-[11px]"
              disabled={isPending}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploadErr(null);
                startTransition(() => {
                  void (async () => {
                    const fd = new FormData();
                    fd.set("avatar", f);
                    const r = await uploadAvatarAction(fd);
                    if (r.ok) {
                      setHasAvatar(true);
                      setAvatarNonce((n) => n + 1);
                      await update({ image: "/api/user/avatar" });
                      router.refresh();
                    } else {
                      setUploadErr(r.error ?? "Upload failed");
                    }
                    e.target.value = "";
                  })();
                });
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit text-xs"
              disabled={isPending || !hasAvatar}
              onClick={() => {
                setUploadErr(null);
                startTransition(() => {
                  void (async () => {
                    const r = await removeAvatarAction();
                    if (r.ok) {
                      setHasAvatar(false);
                      await update({ image: null });
                      router.refresh();
                    } else setUploadErr(r.error ?? "Failed");
                  })();
                });
              }}
            >
              Remove photo
            </Button>
            {uploadErr ? <p className="text-[11px] text-destructive">{uploadErr}</p> : null}
          </div>
        </div>

        <form action={profileFormAction} className="mt-4 space-y-3">
          <input type="hidden" name="name" value={name} />
          <input type="hidden" name="nickname" value={nickname} />
          <p className="text-[11px] text-muted-foreground">Signed in as {email}</p>
          <div className="space-y-1">
            <label htmlFor="pf-name" className="text-xs font-medium">
              Name
            </label>
            <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} className="text-sm" />
          </div>
          <div className="space-y-1">
            <label htmlFor="pf-nick" className="text-xs font-medium">
              Nickname (for chat)
            </label>
            <Input
              id="pf-nick"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. Mike"
              className="text-sm"
            />
          </div>
          {profileState.error ? <p className="text-xs text-destructive">{profileState.error}</p> : null}
          {profileState.message ? <p className="text-xs text-emerald-700 dark:text-emerald-400">{profileState.message}</p> : null}
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save profile"}
          </Button>
        </form>
      </div>

      <div className="border-t pt-4">
        <h3 className="text-xs font-medium text-foreground">Change password</h3>
        <form action={passwordFormAction} className="mt-3 space-y-3">
          <div className="space-y-1">
            <label htmlFor="pf-cur" className="text-xs font-medium">
              Current password
            </label>
            <Input id="pf-cur" name="currentPassword" type="password" autoComplete="current-password" className="text-sm" />
          </div>
          <div className="space-y-1">
            <label htmlFor="pf-new" className="text-xs font-medium">
              New password
            </label>
            <Input id="pf-new" name="newPassword" type="password" autoComplete="new-password" minLength={8} className="text-sm" />
          </div>
          <div className="space-y-1">
            <label htmlFor="pf-confirm" className="text-xs font-medium">
              Confirm new password
            </label>
            <Input id="pf-confirm" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} className="text-sm" />
          </div>
          {passwordState.error ? <p className="text-xs text-destructive">{passwordState.error}</p> : null}
          {passwordState.message ? <p className="text-xs text-emerald-700 dark:text-emerald-400">{passwordState.message}</p> : null}
          <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
            Update password
          </Button>
        </form>
      </div>
    </div>
  );
}
