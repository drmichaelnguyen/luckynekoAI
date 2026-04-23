"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  Loader2,
  Mic,
  Paperclip,
  RotateCcw,
  SendHorizontal,
  Square,
  User,
  Volume2,
} from "lucide-react";
import { useSession } from "next-auth/react";

import { useRouter, useSearchParams } from "next/navigation";
import {
  type ClipboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { packFinancialConversationAction } from "@/actions/chat-pack-context";
import {
  acknowledgeShareImportAction,
  getShareImportAction,
  handleChatInput,
} from "@/actions/chat";
import { getPendingConfirmCountAction } from "@/actions/finance";
import {
  AdvancedToolsPanel,
  type AdvancedToolsTabId,
} from "@/components/chat/advanced-tools-panel";
import { BottomNav } from "@/components/chat/bottom-nav";
import { DailySpendCheckinBanner } from "@/components/chat/daily-spend-checkin-banner";
import { DocumentImportBar } from "@/components/chat/document-import-bar";
import { LuckyNekoAvatar, LuckyNekoMascot } from "@/components/mascot/lucky-neko";
import { useLocale } from "@/contexts/locale-context";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type { ChatAttachmentMeta, ChatMessage, PendingDocumentImport } from "@/types/chat";
import {
  computePackTailStart,
  historyWithoutWelcome,
  messageToTurnForApi,
  recentPriorTurnsForApi,
} from "@/lib/chat/conversation-context";
import { localCalendarYmd } from "@/lib/date/local-ymd";
import { useDailySpendCheckin } from "@/hooks/use-daily-spend-checkin";
import { useVoiceChat } from "@/hooks/use-voice-chat";
import { cn } from "@/lib/utils";

function randomId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultWelcomeMessages(): ChatMessage[] {
  return [
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi — I’m NekoZeni, your little lucky-cat treasurer. Tell me what you bought, or upload a receipt, bill, or payroll slip from Canada or Vietnam. I’ll extract the key fields and ask a quick follow-up if anything important is missing.",
    },
  ];
}

const CHAT_DAY_STORAGE_KEY = "nekozen:chatDayCtx:v1";

type ChatDayStoredV1 = {
  v: 1;
  ymd: string;
  userId: string;
  packedFinancialSummary: string;
  packedThroughIndex: number;
  messages: ChatMessage[];
};

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

function pastedImageName(mimeType: string, index: number): string {
  const ext = mimeType.split("/")[1]?.replace(/[^a-z0-9]+/gi, "").toLowerCase() || "png";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `clipboard-image-${stamp}-${index + 1}.${ext}`;
}

type ChatSendResult =
  | { ok: true; speakText: string }
  | { ok: false; error: string; restoreComposer: boolean };

export function ChatInterface() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const importId = searchParams.get("importId");
  const { data: session, status } = useSession();

  const [messages, setMessages] = useState<ChatMessage[]>(() => defaultWelcomeMessages());
  const messagesRef = useRef(messages);

  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [shareContext, setShareContext] = useState<
    { title?: string; text?: string; url?: string } | undefined
  >(undefined);

  const [isPending, startTransition] = useTransition();
  const [chatBusy, setChatBusy] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsInitialTab, setToolsInitialTab] = useState<AdvancedToolsTabId>("dashboard");
  const [pendingConfirmCount, setPendingConfirmCount] = useState(0);
  const [pendingDocumentImport, setPendingDocumentImport] = useState<PendingDocumentImport | null>(null);
  const [packedFinancialSummary, setPackedFinancialSummary] = useState("");
  const [packedThroughIndex, setPackedThroughIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const packedSummaryRef = useRef("");
  const packedThroughRef = useRef(0);
  const chatHydratedKeyRef = useRef<string>("");
  const lastSessionUserIdRef = useRef<string | null>(null);

  const { visible: spendCheckinVisible, acknowledge: acknowledgeSpendCheckin } = useDailySpendCheckin(
    status === "authenticated",
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    packedSummaryRef.current = packedFinancialSummary;
    packedThroughRef.current = packedThroughIndex;
  }, [packedFinancialSummary, packedThroughIndex]);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user?.id) {
      if (status === "unauthenticated") {
        lastSessionUserIdRef.current = null;
      }
      return;
    }
    const uid = session.user.id;
    if (lastSessionUserIdRef.current && lastSessionUserIdRef.current !== uid) {
      setMessages(defaultWelcomeMessages());
      setPackedFinancialSummary("");
      setPackedThroughIndex(0);
      chatHydratedKeyRef.current = "";
    }
    lastSessionUserIdRef.current = uid;
  }, [status, session?.user?.id]);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user?.id || typeof window === "undefined") return;
    const ymd = localCalendarYmd(new Date());
    const key = `${session.user.id}:${ymd}`;
    if (chatHydratedKeyRef.current === key) return;
    try {
      const raw = localStorage.getItem(CHAT_DAY_STORAGE_KEY);
      if (!raw) {
        chatHydratedKeyRef.current = key;
        return;
      }
      const data = JSON.parse(raw) as ChatDayStoredV1;
      if (data.v !== 1 || data.userId !== session.user.id) {
        chatHydratedKeyRef.current = key;
        return;
      }
      if (data.ymd !== ymd) {
        try {
          localStorage.removeItem(CHAT_DAY_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        setMessages(defaultWelcomeMessages());
        setPackedFinancialSummary("");
        setPackedThroughIndex(0);
        chatHydratedKeyRef.current = key;
        return;
      }
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        setMessages(data.messages);
        setPackedFinancialSummary(typeof data.packedFinancialSummary === "string" ? data.packedFinancialSummary : "");
        setPackedThroughIndex(
          typeof data.packedThroughIndex === "number" && data.packedThroughIndex >= 0
            ? data.packedThroughIndex
            : 0,
        );
      }
    } catch {
      /* ignore corrupt storage */
    }
    chatHydratedKeyRef.current = key;
  }, [status, session?.user?.id]);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user?.id || typeof window === "undefined") return;
    const ymd = localCalendarYmd(new Date());
    const handle = window.setTimeout(() => {
      try {
        const payload: ChatDayStoredV1 = {
          v: 1,
          ymd,
          userId: session.user.id,
          packedFinancialSummary,
          packedThroughIndex,
          messages,
        };
        localStorage.setItem(CHAT_DAY_STORAGE_KEY, JSON.stringify(payload));
      } catch {
        /* quota / private mode */
      }
    }, 500);
    return () => window.clearTimeout(handle);
  }, [messages, packedFinancialSummary, packedThroughIndex, status, session?.user?.id]);

  const refreshPendingCount = useCallback(() => {
    void getPendingConfirmCountAction().then((r) => {
      if (r.ok) setPendingConfirmCount(r.count);
    });
  }, []);

  useEffect(() => {
    refreshPendingCount();
  }, [refreshPendingCount, toolsOpen]);

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

  const onPasteComposer = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData.items);
    const imageFiles = items
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item, index) => {
        const blob = item.getAsFile();
        if (!blob) return null;
        return new File([blob], blob.name || pastedImageName(blob.type || item.type, index), {
          type: blob.type || item.type || "image/png",
          lastModified: Date.now(),
        });
      })
      .filter((file): file is File => file !== null);

    if (imageFiles.length === 0) return;

    const pastedText = event.clipboardData.getData("text/plain");
    if (!pastedText.trim()) {
      event.preventDefault();
    }
    setFiles((prev) => [...prev, ...imageFiles]);
  };

  const removeFileAt = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDailySpendLog = useCallback(() => {
    const prefix = `${t("daily_spend_draft_prefix")} `;
    setDraft((prev) => (prev.trim() ? prev : prefix));
    acknowledgeSpendCheckin();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [acknowledgeSpendCheckin, t]);

  const executeChatSend = useCallback(
    async (args: {
      trimmed: string;
      snapshotMessages: ChatMessage[];
      outgoingFiles: File[];
      outgoingShare: { title?: string; text?: string; url?: string } | undefined;
      attachmentMeta: ChatAttachmentMeta[];
    }): Promise<ChatSendResult> => {
      const { trimmed, snapshotMessages, outgoingFiles, outgoingShare, attachmentMeta } = args;
      if (!trimmed && outgoingFiles.length === 0) {
        return { ok: false, error: "Add a message or attach a file.", restoreComposer: false };
      }

      setChatBusy(true);
      try {
        const hist = historyWithoutWelcome(snapshotMessages);
        const userMessage: ChatMessage = {
          id: randomId(),
          role: "user",
          content: trimmed || "(attachment only)",
          attachments: attachmentMeta.length ? attachmentMeta : undefined,
        };
        const fullIncludingUser = [...hist, userMessage];

        setMessages((prev) => [...prev, userMessage]);

        const tailStart = computePackTailStart(fullIncludingUser.length);
        let summary = packedSummaryRef.current;
        let through = packedThroughRef.current;
        let packedThisRound = false;

        if (tailStart > through) {
          const segment = fullIncludingUser.slice(through, tailStart).map(messageToTurnForApi);
          const packResult = await packFinancialConversationAction({
            priorSummary: summary.length > 0 ? summary : null,
            segment,
          });
          if (!packResult.ok) {
            setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
            setMessages((prev) => [
              ...prev,
              {
                id: randomId(),
                role: "assistant",
                content: packResult.error,
              },
            ]);
            return { ok: false, error: packResult.error, restoreComposer: true };
          }
          summary = packResult.financialSummary;
          through = tailStart;
          packedThisRound = true;
        }

        const formData = new FormData();
        formData.set("message", trimmed);
        if (summary.length > 0) {
          formData.set("conversationPackedSummary", summary);
        }
        formData.set("conversationHistoryJson", JSON.stringify(recentPriorTurnsForApi(fullIncludingUser)));
        for (const file of outgoingFiles) {
          formData.append("files", file);
        }
        if (outgoingShare && (outgoingShare.title || outgoingShare.text || outgoingShare.url)) {
          formData.set("shareContext", JSON.stringify(outgoingShare));
        }

        const result = await handleChatInput(formData);

        if (packedThisRound) {
          setPackedFinancialSummary(summary);
          setPackedThroughIndex(through);
        }

        if (!result.ok) {
          setMessages((prev) => [
            ...prev,
            {
              id: randomId(),
              role: "assistant",
              content: result.error,
            },
          ]);
          return { ok: false, error: result.error, restoreComposer: false };
        }

        const structuredJson = JSON.stringify(result.structured, null, 2);
        const parts = [result.assistantMessage];
        if (result.followUpQuestion) {
          parts.push("");
          parts.push(result.followUpQuestion);
        }
        const spoken = parts.join("\n");

        setMessages((prev) => [
          ...prev,
          {
            id: randomId(),
            role: "assistant",
            content: spoken,
            structuredJson,
          },
        ]);
        if (result.pendingDocumentImport) {
          setPendingDocumentImport(result.pendingDocumentImport);
        } else {
          setPendingDocumentImport(null);
        }
        refreshPendingCount();
        return { ok: true, speakText: spoken };
      } catch (e) {
        const base =
          e instanceof Error
            ? e.message
            : "Something went wrong sending your message. If you attached a large photo, try a smaller image or JPEG export.";
        const hint =
          base.includes("Body") || base.includes("413") || base.toLowerCase().includes("mb")
            ? `${base}\n\nTip: camera photos are often several MB — this app needs the full image under the configured upload limit. Try exporting a smaller JPEG.`
            : base;
        setMessages((prev) => [
          ...prev,
          {
            id: randomId(),
            role: "assistant",
            content: hint,
          },
        ]);
        return { ok: false, error: hint, restoreComposer: true };
      } finally {
        setChatBusy(false);
      }
    },
    [refreshPendingCount],
  );

  const sendSpokenText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return { ok: false as const, error: "Didn't catch that — try again or speak a bit longer." };
      }
      const r = await executeChatSend({
        trimmed,
        snapshotMessages: messagesRef.current,
        outgoingFiles: [],
        outgoingShare: undefined,
        attachmentMeta: [],
      });
      if (r.ok) return { ok: true as const, speakText: r.speakText };
      return { ok: false as const, error: r.error };
    },
    [executeChatSend],
  );

  const voice = useVoiceChat({
    locale,
    enabled: status === "authenticated",
    sendSpokenText,
  });

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed && files.length === 0) return;

    if (voice.mode !== "off") {
      voice.stopConversation();
    }

    const snapshot = messages;
    const outgoingFiles = files;
    const outgoingShare = shareContext;
    const att = attachmentSummary;

    setDraft("");
    setFiles([]);
    setShareContext(undefined);

    startTransition(() => {
      void (async () => {
        const r = await executeChatSend({
          trimmed,
          snapshotMessages: snapshot,
          outgoingFiles,
          outgoingShare,
          attachmentMeta: att,
        });
        if (!r.ok && r.restoreComposer) {
          setDraft(trimmed);
          setFiles(outgoingFiles);
          setShareContext(outgoingShare);
        }
      })();
    });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* ── Google-style top bar ── */}
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-2">
          {/* Brand / logo */}
          <div className="flex flex-1 items-center gap-2.5">
            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-amber-50 ring-1 ring-amber-200/80 dark:bg-amber-950/40 dark:ring-amber-800/60">
              <LuckyNekoMascot variant="hero" celebrateOnMount className="drop-shadow-sm" />
            </div>
            <span className="text-base font-semibold tracking-tight">NekoZeni</span>
          </div>

          {/* Top-right: new chat + user avatar */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              title="New chat"
              aria-label="Start new chat"
              onClick={() => {
                setMessages(defaultWelcomeMessages());
                setPackedFinancialSummary("");
                setPackedThroughIndex(0);
                chatHydratedKeyRef.current = "";
                try { localStorage.removeItem(CHAT_DAY_STORAGE_KEY); } catch { /* ignore */ }
              }}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>

            {/* User avatar — tapping opens profile panel */}
            <button
              type="button"
              id="header-user-avatar"
              aria-label={t("chat_account_aria")}
              title={t("chat_account_title")}
              onClick={() => {
                setToolsInitialTab("profile");
                setToolsOpen(true);
              }}
              className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 ring-2 ring-primary/30 transition hover:ring-primary/60 focus-visible:outline-none focus-visible:ring-primary"
            >
              {status === "authenticated" && session?.user?.image ? (
                <img
                  src={session.user.image}
                  alt={session.user.name ?? "User avatar"}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <User className="h-4 w-4 text-primary" />
              )}
            </button>
          </div>
        </div>
      </header>

      <AdvancedToolsPanel
        open={toolsOpen}
        initialTab={toolsInitialTab}
        onClose={() => setToolsOpen(false)}
        onBooksChanged={refreshPendingCount}
      />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-4">
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
                        <div className="whitespace-pre-wrap break-words">{m.content}</div>

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

            {isPending || chatBusy ? (
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

      {/* ── Fixed composer + bottom nav ── */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex flex-col">
        {/* Composer bar */}
        <div className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto w-full max-w-3xl px-3 pt-2 pb-1">
            <AnimatePresence>
              {spendCheckinVisible ? (
                <DailySpendCheckinBanner
                  key="daily-spend-checkin"
                  onLogSpending={handleDailySpendLog}
                  onDismiss={acknowledgeSpendCheckin}
                />
              ) : null}
            </AnimatePresence>
            {pendingDocumentImport ? (
              <div className="mb-2">
                <DocumentImportBar
                  pending={pendingDocumentImport}
                  onResolved={(msg) => {
                    setMessages((prev) => [...prev, { id: randomId(), role: "assistant", content: msg }]);
                    refreshPendingCount();
                  }}
                  onDismiss={() => setPendingDocumentImport(null)}
                />
              </div>
            ) : null}
            {files.length > 0 ? (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
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

            {/* Hidden file input */}
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

            {/* ── Google-style pill input ── */}
            <div className="flex items-end gap-2 rounded-2xl border bg-muted/40 px-2 py-1.5 shadow-sm ring-1 ring-transparent transition-all focus-within:bg-background focus-within:ring-primary/40">
              {/* Attach button — left inside pill */}
              <button
                type="button"
                id="composer-attach"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach image or PDF"
                title="Attach"
                className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <Paperclip className="h-5 w-5" />
              </button>

              {/* Text input — grows */}
              <Textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPaste={onPasteComposer}
                placeholder="Message NekoZeni…"
                className="min-h-[40px] flex-1 resize-none border-0 bg-transparent px-0 py-1 text-sm shadow-none outline-none focus-visible:ring-0"
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />

              {/* Right side: camera + mic/stop + send */}
              <div className="mb-0.5 flex shrink-0 items-center gap-1">
                {/* Camera — triggers file picker (images only) */}
                <button
                  type="button"
                  id="composer-camera"
                  onClick={() => {
                    if (!fileInputRef.current) return;
                    fileInputRef.current.accept = "image/*";
                    fileInputRef.current.click();
                    // restore after a tick
                    setTimeout(() => {
                      if (fileInputRef.current) fileInputRef.current.accept = "image/*,application/pdf";
                    }, 500);
                  }}
                  aria-label="Attach photo"
                  title="Attach photo"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <Camera className="h-5 w-5" />
                </button>

                {/* Mic / Stop voice */}
                {status === "authenticated" ? (
                  voice.mode === "off" ? (
                    <button
                      type="button"
                      id="composer-mic"
                      onClick={() => voice.startVoice()}
                      disabled={!voice.supported || chatBusy || files.length > 0}
                      aria-label={t("voice_start_aria")}
                      title={
                        !voice.supported
                          ? t("voice_unsupported_hint")
                          : files.length > 0
                            ? t("voice_blocked_attachments")
                            : t("voice_start_title")
                      }
                      className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      <Mic className="h-5 w-5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      id="composer-stop-voice"
                      onClick={() => voice.stopConversation()}
                      aria-label={t("voice_stop_aria")}
                      title={t("voice_stop_title")}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-destructive transition hover:bg-destructive/10"
                    >
                      <Square className="h-4 w-4 fill-current" />
                    </button>
                  )
                ) : null}

                {/* Send button — visible when there's content */}
                <AnimatePresence>
                  {(draft.trim() || files.length > 0) && voice.mode === "off" ? (
                    <motion.button
                      key="send-btn"
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.6, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 28 }}
                      type="button"
                      id="composer-send"
                      onClick={submit}
                      disabled={isPending || chatBusy}
                      aria-label="Send message"
                      title="Send"
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-60"
                    >
                      {isPending || chatBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <SendHorizontal className="h-4 w-4" />
                      )}
                    </motion.button>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>

            {/* Voice status indicator */}
            {voice.mode !== "off" ? (
              <div className="mt-1.5 space-y-0.5 text-[11px]">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  {voice.mode === "listening" ? (
                    <Mic className="h-3.5 w-3.5 animate-pulse text-amber-600 dark:text-amber-400" />
                  ) : voice.mode === "processing" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : (
                    <Volume2 className="h-3.5 w-3.5 animate-pulse text-amber-600 dark:text-amber-400" />
                  )}
                  <span className="leading-snug">
                    {voice.mode === "listening"
                      ? t("voice_listening")
                      : voice.mode === "processing"
                        ? t("voice_processing")
                        : t("voice_speaking")}
                  </span>
                </div>
                {voice.transcript ? (
                  <div className="pl-5 text-foreground/80">&ldquo;{voice.transcript}&rdquo;</div>
                ) : null}
                {voice.errorMessage ? (
                  <div className="pl-5 text-destructive">{voice.errorMessage}</div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Bottom navigation bar ── */}
        <BottomNav
          pendingCount={pendingConfirmCount}
          onNotificationsClick={() => {
            setToolsInitialTab("confirm");
            setToolsOpen(true);
          }}
        />
      </div>
    </div>
  );
}
