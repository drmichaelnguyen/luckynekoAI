# Chat Assistant Fix Notes

## Ledger bulk edits

- Ledger edit matching now carries wallet, category, and memo hints through preview and confirmation.
- Bulk confirmation no longer loses the scope that was used to find candidate transactions.
- Merchant/payee edits can target rows such as `Insurance` in the `Car Rental` wallet without relying only on merchant text.

## Analytics assistant

- Analytics chat history is retained in browser local storage instead of disappearing on reload.
- Concrete spend and income questions are answered by direct ledger queries before falling back to AI.
- Query matching now understands wallet scope, category scope, merchant/memo terms, income vs expense direction, and common Vietnamese finance terms.
- AI fallback receives bounded recent transaction context and stricter instructions to avoid guessing beyond the current dashboard data.
