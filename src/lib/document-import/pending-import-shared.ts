export const PENDING_IMPORT_VERSION = 2 as const;

export type PendingImportPayloadV1 = {
  version: 1;
  chatTurnId: string;
  documentKind: "receipt" | "canadian_paystub" | "payroll_document";
  extractedTextSummary: string;
  proposed: Record<string, unknown>;
};

export type PendingImportPayloadV2 = {
  version: typeof PENDING_IMPORT_VERSION;
  chatTurnId: string;
  documentKind: "receipt" | "canadian_paystub" | "payroll_document" | "transaction_list_capture";
  extractedTextSummary: string;
  proposed: Record<string, unknown> | null;
  proposedItems?: Record<string, unknown>[];
};
