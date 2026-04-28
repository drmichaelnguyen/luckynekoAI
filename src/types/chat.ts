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

export type TransactionImportItem = {
  amount: number | null;
  currency: string | null;
  merchant: string | null;
  category: string | null;
  transactionDate: string | null;
  notes: string | null;
  walletLabel: string | null;
  direction: "in" | "out" | null;
  recurrence: "one_time" | "recurrent" | "unknown" | null;
  needsUserConfirm: boolean;
  userConfirmReason: string | null;
  payeeKind: "purchase" | "bill" | "loan" | "subscription" | "utility" | "income" | "transfer" | null;
};

export type PendingDocumentImport = {
  chatTurnId: string;
  documentKind: "receipt" | "canadian_paystub" | "payroll_document" | "transaction_list_capture";
  extractedTextSummary: string;
  /** Suggested per-category split items from a mixed-category receipt */
  splitItems?: ReceiptSplitItem[];
  /** Suggested transactions parsed from a wallet / Apple Pay activity screenshot. */
  transactionItems?: TransactionImportItem[];
};

export type PendingLedgerEdit = {
  merchantHint: string | null;
  dateHint: string | null;
  walletHint?: string | null;
  categoryHint?: string | null;
  memoHint?: string | null;
  newAmount: number | null;
  newMemo: string | null;
  newCategory: string | null;
  newMerchant?: string | null;
  matchedCount: number;
  scopeLabel: string;
};

export type ChatActionSuccess = {
  ok: true;
  assistantMessage: string;
  structured: unknown;
  followUpQuestion?: string | null;
  /** Present when a receipt/paystub was read from an upload and needs explicit ADD vs EDIT before ledger write. */
  pendingDocumentImport?: PendingDocumentImport;
  /** Present when the assistant staged a bulk ledger edit for explicit confirmation. */
  pendingLedgerEdit?: PendingLedgerEdit;
};

export type ChatActionFailure = {
  ok: false;
  error: string;
};

export type ChatActionResult = ChatActionSuccess | ChatActionFailure;
