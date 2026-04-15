export type ChatRole = "user" | "assistant";

export type ChatAttachmentMeta = {
  name: string;
  mimeType: string;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  attachments?: ChatAttachmentMeta[];
  structuredJson?: string;
};

export type ChatActionSuccess = {
  ok: true;
  assistantMessage: string;
  structured: unknown;
  followUpQuestion?: string | null;
};

export type ChatActionFailure = {
  ok: false;
  error: string;
};

export type ChatActionResult = ChatActionSuccess | ChatActionFailure;
