"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ImagePlus, Loader2, Paperclip, SendHorizontal, User } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  acknowledgeShareImportAction,
  getShareImportAction,
  handleChatInput,
} from "@/actions/chat";
import { LuckyNekoAvatar, LuckyNekoMascot } from "@/components/mascot/lucky-neko";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type { ChatAttachmentMeta, ChatMessage } from "@/types/chat";
import { cn } from "@/lib/utils";

function randomId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function base64ToFile(part: {
  base64: string;
  mimeType: string;
  name: string;
}): File {
  const binary = atob(part.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], part.name, { type: part.mimeType });
}

export function ChatInterface() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const importId = searchParams.get("importId");

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi — I’m NekoZeni, your little lucky-cat treasurer. Tell me what you bought, or upload a receipt or Canadian paystub. I’ll extract structured fields and ask a quick follow-up if anything important is missing.",
    },
  ]);

  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [shareContext, setShareContext] = useState<
    { title?: string; text?: string; url?: string } | undefined
  >(undefined);

  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const attachmentSummary = useMemo(() => {
    return files.map((file) => ({
      name: file.name,
      mimeType: file.type || "application/octet-stream",
    }));
  }, [files]);

  const clearImportParam = useCallback(() => {
    router.replace("/", { scroll: false });
  }, [router]);

  useEffect(() => {
    if (!importId) return;

    let cancelled = false;

    startTransition(() => {
      void (async () => {
        const result = await getShareImportAction(importId);
        if (cancelled) return;

        if (!result.ok) {
          setMessages((prev) => [
            ...prev,
            {
              id: randomId(),
              role: "assistant",
              content: result.error,
            },
          ]);
          clearImportParam();
          return;
        }

        const restored = result.payload.parts.map((part) => base64ToFile(part));
        setFiles((prev) => [...restored, ...prev]);

        setShareContext({
          title: result.payload.title,
          text: result.payload.text,
          url: result.payload.url,
        });

        setMessages((prev) => [
          ...prev,
          {
            id: randomId(),
            role: "assistant",
            content:
              restored.length > 0
                ? "Got it — I pulled in what you shared. Add any context you want, then send when you’re ready."
                : "I received a share, but no file was attached. You can still type details below.",
          },
        ]);

        if (cancelled) return;
        await acknowledgeShareImportAction(importId);
        if (cancelled) return;
        clearImportParam();
      })();
    });

    return () => {
      cancelled = true;
    };
  }, [importId, clearImportParam]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isPending]);

  const onPickFiles = (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    setFiles((prev) => [...prev, ...Array.from(picked)]);
  };

  const removeFileAt = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed && files.length === 0) return;

    const userMessage: ChatMessage = {
      id: randomId(),
      role: "user",
      content: trimmed || "(attachment only)",
      attachments: attachmentSummary.length ? attachmentSummary : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setDraft("");

    const outgoingFiles = files;
    const outgoingShare = shareContext;
    setFiles([]);
    setShareContext(undefined);

    startTransition(() => {
      void (async () => {
        const formData = new FormData();
        formData.set("message", trimmed);
        for (const file of outgoingFiles) {
          formData.append("files", file);
        }
        if (outgoingShare && (outgoingShare.title || outgoingShare.text || outgoingShare.url)) {
          formData.set("shareContext", JSON.stringify(outgoingShare));
        }

        const result = await handleChatInput(formData);

        if (!result.ok) {
          setMessages((prev) => [
            ...prev,
            {
              id: randomId(),
              role: "assistant",
              content: result.error,
            },
          ]);
          return;
        }

        const structuredJson = JSON.stringify(result.structured, null, 2);
        const parts = [result.assistantMessage];
        if (result.followUpQuestion) {
          parts.push("");
          parts.push(result.followUpQuestion);
        }

        setMessages((prev) => [
          ...prev,
          {
            id: randomId(),
            role: "assistant",
            content: parts.join("\n"),
            structuredJson,
          },
        ]);
      })();
    });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 ring-1 ring-amber-200/80 dark:bg-amber-950/40 dark:ring-amber-800/60">
            <LuckyNekoMascot variant="hero" celebrateOnMount className="drop-shadow-sm" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">
              NekoZeni
            </div>
            <div className="truncate text-xs text-muted-foreground">
              Lucky-cat treasurer • Chat • PWA
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-[calc(5.75rem+env(safe-area-inset-bottom))] pt-4">
        <ScrollArea className="min-h-[calc(100dvh-8.25rem)] pr-2">
          <div className="space-y-3 pb-4">
            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  layout
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.99 }}
                  transition={{ type: "spring", stiffness: 520, damping: 36, mass: 0.35 }}
                  className={cn(
                    "flex w-full gap-2",
                    m.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "flex max-w-[min(92%,34rem)] gap-2",
                      m.role === "user" ? "flex-row-reverse" : "flex-row",
                    )}
                  >
                    <div
                      className={cn(
                        "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
                        m.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground",
                      )}
                    >
                      {m.role === "user" ? (
                        <User className="h-4 w-4" />
                      ) : (
                        <LuckyNekoAvatar className="scale-90" />
                      )}
                    </div>

                    <div className="min-w-0 space-y-2">
                      <div
                        className={cn(
                          "rounded-2xl border px-3 py-2 text-sm leading-relaxed shadow-sm",
                          m.role === "user"
                            ? "rounded-br-md bg-primary text-primary-foreground"
                            : "rounded-bl-md bg-card text-card-foreground",
                        )}
                      >
                        <div className="whitespace-pre-wrap">{m.content}</div>

                        {m.attachments && m.attachments.length > 0 ? (
                          <div
                            className={cn(
                              "mt-2 space-y-1 border-t pt-2 text-xs",
                              m.role === "user"
                                ? "border-primary-foreground/20 text-primary-foreground/90"
                                : "border-border text-muted-foreground",
                            )}
                          >
                            {m.attachments.map((a) => (
                              <div key={`${m.id}-${a.name}-${a.mimeType}`} className="truncate">
                                Attachment: {a.name}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      {m.structuredJson ? (
                        <details className="rounded-xl border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                          <summary className="cursor-pointer select-none text-foreground">
                            Structured JSON (for DB insert)
                          </summary>
                          <motion.pre
                            className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px] leading-snug text-foreground"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            {m.structuredJson}
                          </motion.pre>
                        </details>
                      ) : null}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {isPending ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 pl-12 text-xs text-muted-foreground"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking…
              </motion.div>
            ) : null}

            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto w-full max-w-3xl px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          {files.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {files.map((file, idx) => (
                <button
                  key={`${file.name}-${idx}`}
                  type="button"
                  onClick={() => removeFileAt(idx)}
                  className="max-w-full truncate rounded-full border bg-secondary px-3 py-1 text-xs text-secondary-foreground hover:bg-secondary/80"
                  title="Remove attachment"
                >
                  {file.name}
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept="image/*,application/pdf"
              onChange={(e) => {
                onPickFiles(e.target.files);
                e.target.value = "";
              }}
            />

            <Button
              type="button"
              variant="outline"
              className="shrink-0 gap-2 px-3"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Upload images or PDFs"
              title="Upload"
            >
              <ImagePlus className="h-5 w-5" />
              <span className="hidden text-sm sm:inline">Upload</span>
            </Button>

            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message NekoZeni…"
              className="min-h-[44px] flex-1"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />

            <Button
              type="button"
              size="icon"
              className="shrink-0"
              onClick={submit}
              disabled={isPending || (!draft.trim() && files.length === 0)}
              aria-label="Send message"
              title="Send"
            >
              {isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <SendHorizontal className="h-5 w-5" />
              )}
            </Button>
          </div>

          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" />
            <span className="leading-snug">
              Tip: on mobile, install the PWA, then share a photo/PDF directly into NekoZeni from your
              gallery or files app.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
