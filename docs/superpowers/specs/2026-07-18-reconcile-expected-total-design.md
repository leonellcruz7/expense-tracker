# Reconcile expected total (two-pass AI)

**Date:** 2026-07-18  
**Status:** Approved for planning  
**Scope:** Statement reconcile flow only (`app/page.tsx`, `app/api/reconcile-statement/route.ts`)

## Problem

Reconcile extracts statement charges and diffs them against tracked expenses, but the user has no way to tell the model what the **post-reconcile tracked total** should be. Extraction can miss or misread lines, and the UI error path does not surface a target total to aim for.

## Goals

- Require an **expected total** before running reconcile.
- That total means: what **tracked expenses should sum to after reconcile**, including locked installment/recurring charges (same idea as the reconcile footer “new total”).
- Use a **two-pass AI** when the first pass misses the target.
- Always show results even on mismatch; do **not** block Apply.

## Non-goals

- Blocking Apply until totals match
- Changing installment/recurring “locked” behavior
- Auto-retry beyond one second pass
- Analyze-spending or other AI features

## User flow

1. User clicks **Reconcile with statement**.
2. App opens a small step: required **expected total** amount (currency-aware label using current `currencyCode`).
3. On valid amount → Continue → existing multi-image file picker (max 5).
4. Loading state while API runs (pass 1, and pass 2 if needed).
5. Results modal shows changes plus an **expected vs projected/new total** banner.
6. Checkbox toggles update the live reconciled total and match/mismatch state.
7. Apply remains available on mismatch.

Cancel on the amount step closes without opening the file picker.

## API

### Request

Extend `POST /api/reconcile-statement` body with:

| Field | Type | Rules |
| --- | --- | --- |
| `expectedTotal` | `number` | Required. Finite, `> 0`. Same currency as `currencyCode`. |

Missing/invalid → `400` with a clear error.

### Pass 1 — extract

Same per-image extraction as today, plus prompt guidance:

- Target: after reconcile, tracked total (including locked installment/recurring) should equal `expectedTotal`.
- Prefer correct OCR amounts; do not invent charges solely to hit the number.
- Keep existing amount/matching rules (billed currency, no payments/credits, etc.).

### Projected total

After `buildDiff`, compute `projectedTotal` using the **same default selection rules** as the UI footer “new total”:

- `add`: include statement amount (selected by default)
- `update`: include statement amount (selected by default)
- `unchanged`: include tracked amount
- `kept` / `locked`: include tracked amount (selected by default)

Tolerance for “match”: absolute difference `≤ 0.01`.

### Pass 2 — revise (conditional)

Run **only if** `|projectedTotal - expectedTotal| > 0.01` after pass 1.

Single follow-up model call (one request for the whole statement, not per page) with:

- all statement images (same set as pass 1)
- previous line items (deduped across pages)
- locked/tracked expense summary needed for projected-total math
- `expectedTotal`, pass-1 `projectedTotal`, and delta (`expectedTotal - projectedTotal`)
- instruction to revise line items so a re-diff would land on expected (fix amounts, add missing **visible** charges, drop false positives; do not invent charges that are not on the images)

Then re-run `buildDiff` + projected total on the revised line items.

If pass 2 fails (API/parse error), keep pass-1 results and still return mismatch metadata.

No third pass.

### Response

Existing fields plus:

| Field | Type | Meaning |
| --- | --- | --- |
| `expectedTotal` | `number` | Echo of request |
| `projectedTotal` | `number` | New-total under default selections |
| `totalMatches` | `boolean` | `abs(projectedTotal - expectedTotal) ≤ 0.01` |
| `usedSecondPass` | `boolean` | Whether pass 2 ran |

## UI details

### Expected-total step

- Amount input (required)
- Continue disabled until valid positive number
- Cancel closes the step
- Then triggers the existing hidden file input

Store `expectedTotal` on reconcile state and send it with the API payload.

### Results banner

- **Match:** “Total matches expected: {formatted amount}”
- **Mismatch:** “Expected {X} · reconciled total {Y} · off by {Z}”
- Recompute Y/Z from current checkbox selection (same math as footer new total), not only the server’s initial `projectedTotal`

### Loading copy

Mention analyzing statement pages; no need to expose “pass 2” unless useful for debugging later.

## Error handling

| Case | Behavior |
| --- | --- |
| Invalid/missing expected total (client) | Block Continue |
| Invalid/missing expected total (API) | `400` |
| Pass 1 failure | Existing error modal |
| Pass 2 failure | Keep pass-1 changes; return mismatch fields; no hard fail |
| Credit/quota errors | Existing quota messaging (may be likelier with 2× calls) |

## Cost note

When totals miss on pass 1, usage can approach **~2×** current reconcile cost. OpenRouter key monthly caps still apply.

## Testing focus

- Client requires expected total before file pick / API call
- API rejects bad `expectedTotal`
- `projectedTotal` matches UI default new-total math
- Pass 2 runs only when off by > 0.01
- Pass 2 failure falls back to pass 1
- Banner updates when toggling checkboxes
- Apply still works on mismatch

## Files likely touched

- `app/page.tsx` — amount step, state, banner, request body
- `app/api/reconcile-statement/route.ts` — validation, prompt, projected total helper, pass 2, response fields
