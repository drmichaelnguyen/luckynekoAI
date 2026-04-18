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

export type ReceiptSplitItem = {
  description: string;
  category: string;
  amount: number;
  currency: string;
  direction: "in" | "out";
};

export type PendingDocumentImport = {
  chatTurnId: string;
  documentKind: "receipt" | "canadian_paystub" | "payroll_document";
  extractedTextSummary: string;
  /** Suggested per-category split items from a mixed-category receipt */
  splitItems?: ReceiptSplitItem[];
};

export type ChatActionSuccess = {
  ok: true;
  assistantMessage: string;
  structured: unknown;
  followUpQuestion?: string | null;
  /** Present when a receipt/paystub was read from an upload and needs explicit ADD vs EDIT before ledger write. */
  pendingDocumentImport?: PendingDocumentImport;
};

export type ChatActionFailure = {
  ok: false;
  error: string;
};

export type ChatActionResult = ChatActionSuccess | ChatActionFailure;
