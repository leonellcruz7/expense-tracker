# AI Statement Reconciliation — Design

## Goal

From an expanded account card in the Balances screen, let the user upload a
statement image. The app uses AI to match the statement's line items against the
tracked expenses for that account/month, shows a comparison of the differences,
and lets the user approve selected changes to update the tracked expenses.

## Scope decisions (approved)

- **Image type:** a credit-card / bank statement listing many transactions.
- **Comparison scope:** only the transactions shown in the expanded card for the
  currently selected month/cycle (that account only).
- **Change kinds:** full reconciliation — add missing items, fix mismatched
  amounts/dates/descriptions, and remove tracked items not on the statement.
- **Granularity:** per-row accept/reject checkboxes plus one "Approve selected"
  button.
- **Cash cards** are supported too (scoped to that month's cash transactions).

### v1 limitation

Installment and recurring tracked items are shown in the comparison as
"matched (locked)" and are **never** auto-updated or deleted by Approve. Added
items are always created as plain (non-installment, non-recurring) charges on the
account. This keeps a clean 1 statement line ↔ 1 expense row mapping.

## Architecture

### New API route: `app/api/reconcile-statement/route.ts`

Input (POST JSON):

- `image`: base64 data URL of the statement image
- `expenses`: scoped tracked expenses (id, description, amount, expense_date,
  payment_type, card_id, is_installment, is_recurring)
- `accountName`, `currencyCode`, `selectedMonthKey`

Behavior:

1. Require `OPENROUTER_API_KEY` (500 if missing).
2. Call OpenRouter `openai/gpt-4o-mini` with a vision message (text prompt +
   `image_url`) and `response_format: { type: "json_object" }`.
3. The model returns statement line items:
   ```json
   {
     "lineItems": [
       { "description": "string", "amount": 0, "date": "YYYY-MM-DD|null",
         "matchedExpenseId": "string|null" }
     ]
   }
   ```
4. The route **deterministically** computes the diff (ignores AI-invented ids by
   validating against the provided expense ids):
   - matched + identical (amount within 0.01, same description/date) → `unchanged`
   - matched + different → `update` (carries old vs new)
   - `matchedExpenseId == null` → `add`
   - tracked id never referenced → `remove`
   - Installment/recurring matched rows are marked `locked` (no update/remove).
5. Response: `{ changes: DiffRow[], source }` with graceful fallback error
   messages (bad key, non-JSON model output, quota).

### Client (`app/page.tsx`)

- New state: `reconcileState` (accountName, paymentType, cardId, status:
  idle/loading/ready/error, changes, per-row selection, error).
- Hidden `<input type="file" accept="image/*">` triggered by a
  "Reconcile with statement" button (Sparkles icon) on each expanded card.
- On file select: read as data URL, open a full-screen overlay, POST to the API.
- Overlay renders grouped rows (Update / Add / Remove / Unchanged / Locked) with
  checkboxes (actionable rows default checked).
- "Approve selected" applies changes with existing Supabase calls:
  - add → `supabase.from("expenses").insert(...)`
  - update → update amount/description/expense_date
  - remove → delete by id
  Then invalidate `["expenses", profileUserId]` and close.

## Error handling

- Missing key / model error / non-JSON → overlay shows an error state with retry.
- Only plain expenses are ever mutated; installment/recurring are guarded both
  client- and server-side.
- Approve is disabled while applying; failures surface inline.

## Out of scope (v1)

- PDF statements (image only).
- Editing installment/recurring via reconciliation.
- Multi-image / multi-page statements.
