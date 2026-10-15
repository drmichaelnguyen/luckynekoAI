export type ChatRole = "user" | "assistant";

export type ChatAttachmentMeta = {
  name: string;
  mimeType: string;
};

export type PlanChatAction = {
  planId: string;
  title: string;
  amountCents: number | null;
  currency: string;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  attachments?: ChatAttachmentMeta[];
  structuredJson?: string;
  /** Set when this reply created a financial plan instead of a transaction. */
  planNotice?: PlanChatAction | null;
  /** Planned purchases found while answering a ledger lookup. */
  planMatches?: PlanChatAction[];
};

export type PendingDocumentImport = {
  chatTurnId: string;
  documentKind: "receipt" | "canadian_paystub";
  extractedTextSummary: string;
};

export type ChatActionSuccess = {
  ok: true;
  assistantMessage: string;
  structured: unknown;
  followUpQuestion?: string | null;
  planCreated?: boolean;
  planId?: string;
  planNotice?: PlanChatAction;
  planMatches?: PlanChatAction[];
  /** Present when a receipt/paystub was read from an upload and needs explicit ADD vs EDIT before ledger write. */
  pendingDocumentImport?: PendingDocumentImport;
};

export type ChatActionFailure = {
  ok: false;
  error: string;
};

export type ChatActionResult = ChatActionSuccess | ChatActionFailure;
