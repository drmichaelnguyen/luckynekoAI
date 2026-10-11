import type { PendingDocumentImport, PendingLedgerEdit } from "@/types/chat";

export type ChatApiSuccess = {
  ok: true;
  assistantMessage: string;
  structured: unknown;
  followUpQuestion?: string | null;
  pendingDocumentImport?: PendingDocumentImport;
  pendingLedgerEdit?: PendingLedgerEdit;
};

export type ChatApiFailure = { ok: false; error: string };

export type ChatApiResult = ChatApiSuccess | ChatApiFailure;

const UPLOAD_RETRY_USER_MESSAGE =
  "Upload failed. Your file is still attached and ready to be read again.";

const PROCESS_RETRY_USER_MESSAGE =
  "Couldn't process this file. Your file is still attached and ready to be read again.";

export function isTransientChatTransportError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("unexpected response") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("network connection was lost") ||
    lower.includes("the internet connection appears to be offline") ||
    lower.includes("timeout") ||
    lower.includes("524") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504")
  );
}

export function friendlyChatTransportError(message: string, hadFiles: boolean): string {
  if (hadFiles && isTransientChatTransportError(message)) {
    return UPLOAD_RETRY_USER_MESSAGE;
  }
  if (message.includes("Body") || message.includes("413") || message.toLowerCase().includes("mb")) {
    return `${message}\n\nTip: camera photos are often several MB — try exporting a smaller JPEG.`;
  }
  return message;
}

async function parseChatApiResponse(res: Response): Promise<ChatApiResult> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    if (res.status === 413) {
      return {
        ok: false,
        error: "Upload too large for the server. Try a smaller JPEG export.",
      };
    }
    throw new Error("An unexpected response was received from the server.");
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("An unexpected response was received from the server.");
  }

  if (!body || typeof body !== "object") {
    throw new Error("An unexpected response was received from the server.");
  }

  const parsed = body as Partial<ChatApiResult>;
  if (parsed.ok === true && typeof parsed.assistantMessage === "string") {
    return parsed as ChatApiSuccess;
  }
  if (parsed.ok === false && typeof parsed.error === "string") {
    return { ok: false, error: parsed.error };
  }

  throw new Error("An unexpected response was received from the server.");
}

/**
 * Post chat FormData to the JSON API route (not a Server Action).
 * Retries once on transient transport failures when attachments are present.
 */
export async function postChatFormData(
  formData: FormData,
  options?: { hadFiles?: boolean; retries?: number },
): Promise<ChatApiResult> {
  const hadFiles = Boolean(options?.hadFiles);
  const retries = options?.retries ?? (hadFiles ? 1 : 0);
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      });
      return await parseChatApiResponse(res);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= retries || !isTransientChatTransportError(message)) {
        throw error;
      }
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("An unexpected response was received from the server.");
}

export { PROCESS_RETRY_USER_MESSAGE, UPLOAD_RETRY_USER_MESSAGE };
