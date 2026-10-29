import type { Locale } from "@/lib/i18n/config";

/** Composer toggle: record a new ledger entry, or ask about data already saved. */
export type ChatMode = "record" | "ask";

export function parseChatMode(raw: unknown): ChatMode {
  return raw === "ask" ? "ask" : "record";
}

export function modelProposedLedgerWrite(data: {
  documentKind: string;
  transaction?: unknown;
  transactionList?: unknown;
  receipt?: unknown;
  paystub?: unknown;
  ledgerEdit?: unknown;
}): boolean {
  if (
    data.documentKind === "freeform_transaction" ||
    data.documentKind === "receipt" ||
    data.documentKind === "canadian_paystub" ||
    data.documentKind === "payroll_document" ||
    data.documentKind === "transaction_list_capture" ||
    data.documentKind === "ledger_edit"
  ) {
    return true;
  }
  const hasList = Array.isArray(data.transactionList) && data.transactionList.length > 0;
  return Boolean(data.transaction || data.receipt || data.paystub || data.ledgerEdit || hasList);
}

/**
 * Appended after the base system prompt so the active toggle wins when the two conflict.
 * The model must ask the user to switch instead of guessing across modes.
 */
export function chatModeSystemAddendum(mode: ChatMode): string {
  if (mode === "ask") {
    return `ACTIVE CHAT MODE: ask
The user selected Ask on the composer toggle (the control labeled "Ask" / "Hỏi"). This turn is ONLY for reading and analyzing data already saved, plus any file they attached so you can discuss it.

These rules override earlier extraction rules when they conflict:
- Set documentKind to "analytics" (with analyticsRequest) when they ask for a summary, breakdown, trend, or chart. Otherwise set documentKind to "unknown_document".
- Set transaction, transactionList, receipt, paystub, ledgerEdit, planSuggestion, and pendingRecurrenceUpdate to null. Never extract a ledger row, edit, or plan in this mode.
- Set awaitingLedgerDecision to false. Never say you saved, posted, or added a transaction.
- Answer only from USER LEDGER SNAPSHOT, USER LEDGER CONTEXT, FINANCIAL PLANS, the conversation, and an attached file if present. If a number is not in that snapshot, say you cannot see it. Do not invent transactions, totals, or merchants.
- extractedTextSummary: if they attached a file, you may put a plain-text readout there so they can discuss it. That readout is not a ledger save.
- intentMismatch defaults to false and suggestedMode to null when you can answer in Ask mode.
- If the message is clearly a NEW entry to record (a purchase, income, refund, receipt, or paystub they want saved — for example "I spent 12 at Starbucks", "add this", "log this receipt", "got paid 2000") OR you are unsure whether they want to save a new entry versus ask about existing data:
  - set intentMismatch to true
  - set suggestedMode to "record"
  - set transaction, transactionList, receipt, paystub, and ledgerEdit to null
  - assistantMessage: one or two sentences saying this looks like something to add, and you did not save it
  - followUpQuestion: ONE question asking them to switch the toggle above the message box from Ask to Add, then send again
- If you are unsure, ask them to switch. Do not guess a transaction.
- A question about past spending, budgets, categories, wallets, plans, or trends is NOT a mismatch. Answer it.`;
  }

  return `ACTIVE CHAT MODE: record
The user selected Add on the composer toggle (the control labeled "Add" / "Thêm"). This turn is ONLY for recording a new transaction, receipt, or paystub.

These rules override earlier extraction rules when they conflict:
- If the message is a question or analysis request about existing data (how much was spent, totals, trends, budgets, plans, "am I on track", comparisons, what they bought last week) and does NOT also give a new amount to save, OR you are unsure whether they want to log a new entry versus ask about saved data:
  - set documentKind to "unknown_document"
  - set transaction, transactionList, receipt, paystub, ledgerEdit, planSuggestion, pendingRecurrenceUpdate, and analyticsRequest to null
  - set awaitingLedgerDecision to false
  - set intentMismatch to true
  - set suggestedMode to "ask"
  - assistantMessage: one or two sentences saying this looks like a question about data already saved, and you did not add a transaction
  - followUpQuestion: ONE question asking them to switch the toggle above the message box from Add to Ask, then send again
- If the message mixes a new purchase AND a question about existing totals, treat that as confusion: use the same mismatch response. Do not save a partial entry. Ask them to switch modes and send one intent at a time.
- Only populate transaction, transactionList, receipt, or paystub when you are confident they are adding or confirming a new ledger entry. Then set intentMismatch to false and suggestedMode to null.
- Editing or annotating an existing transaction (ledger_edit), a purchase intent (planSuggestion), and a cadence reply for a pending item (pendingRecurrenceUpdate) are allowed in this mode and are NOT a mismatch.
- Do not answer spending-analysis questions in this mode. Set analyticsRequest to null and ask them to switch to Ask.`;
}

export function mismatchAssistantMessage(mode: ChatMode, locale: Locale): string {
  if (locale === "vi") {
    return mode === "ask"
      ? "Mình chưa lưu gì cả — chế độ Hỏi chỉ đọc và phân tích dữ liệu đã có."
      : "Mình chưa thêm giao dịch — chế độ Thêm chỉ dùng để ghi khoản mới.";
  }
  return mode === "ask"
    ? "I didn’t save anything — Ask mode only reads and analyzes what’s already saved."
    : "I didn’t add a transaction — Add mode is only for recording something new.";
}

export function mismatchFollowUp(mode: ChatMode, locale: Locale): string {
  if (locale === "vi") {
    return mode === "ask"
      ? "Tin này giống một giao dịch mới cần lưu. Hãy chuyển nút phía trên ô nhắn từ Hỏi sang Thêm, rồi gửi lại."
      : "Tin này giống câu hỏi về dữ liệu đã lưu. Hãy chuyển nút phía trên ô nhắn từ Thêm sang Hỏi, rồi gửi lại.";
  }
  return mode === "ask"
    ? "That looks like a new transaction to save. Switch the toggle above the message box from Ask to Add, then send it again."
    : "That looks like a question about data you already saved. Switch the toggle above the message box from Add to Ask, then send it again.";
}
