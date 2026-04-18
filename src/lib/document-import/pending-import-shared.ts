export const PENDING_IMPORT_VERSION = 1 as const;

export type PendingImportPayloadV1 = {
  version: typeof PENDING_IMPORT_VERSION;
  chatTurnId: string;
  documentKind: "receipt" | "canadian_paystub" | "payroll_document";
  extractedTextSummary: string;
  proposed: Record<string, unknown>;
};
