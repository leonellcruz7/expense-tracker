# Reconcile Expected Total Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require an expected post-reconcile tracked total, steer extraction toward it with a second AI pass when off, and show a live match/mismatch banner.

**Architecture:** Extract shared total math into `lib/reconcile-totals.ts` (used by API + UI). API validates `expectedTotal`, runs pass-1 extraction with target in the prompt, computes projected total under default selections, and if off by > 0.01 runs one revision call with images + delta. UI adds a required amount step before the file picker and a results banner.

**Tech Stack:** Next.js App Router route handler, React state in `app/page.tsx`, OpenRouter chat completions (existing), Node `node:test` + `tsx` for pure helper tests.

## Global Constraints

- Expected total = post-reconcile tracked sum including locked installment/recurring (same as footer “new total”).
- Expected total is required (client + API).
- Two-pass AI: at most one revision pass; never a third.
- On mismatch or pass-2 failure: still return/show results; do not block Apply.
- Match tolerance: `abs(diff) <= 0.01`.
- Do not change locked installment/recurring semantics.
- Scope: `app/page.tsx` + `app/api/reconcile-statement/route.ts` + new `lib/reconcile-totals*`.
- Commits: only when the user explicitly asks (skip commit steps otherwise).

---

## File map

| File | Responsibility |
| --- | --- |
| `lib/reconcile-totals.ts` | Pure helpers: default selection, projected total, match check, expected-total validation |
| `lib/reconcile-totals.test.ts` | Unit tests for those helpers |
| `app/api/reconcile-statement/route.ts` | Validate `expectedTotal`, prompt target, pass 2 revise, response fields |
| `app/page.tsx` | Expected-total step, request body, results banner, live total vs expected |

---

### Task 1: Shared projected-total helpers

**Files:**
- Create: `lib/reconcile-totals.ts`
- Create: `lib/reconcile-totals.test.ts`
- Modify: `package.json` (add `test` script only; no new deps if `npx tsx` works)

**Interfaces:**
- Produces:
  - `export type ReconcileTotalChange = { id: string; kind: "update" \| "add" \| "kept" \| "unchanged" \| "locked"; statement: { amount: number } \| null; tracked: { amount: number } \| null }`
  - `export const RECONCILE_AMOUNT_TOLERANCE = 0.01`
  - `export function defaultReconcileSelection(changes: { id: string; kind: ReconcileTotalChange["kind"] }[]): Record<string, boolean>`
  - `export function computeProjectedTotal(changes: ReconcileTotalChange[], selected: Record<string, boolean>): number`
  - `export function totalsMatch(a: number, b: number): boolean`
  - `export function parseExpectedTotal(value: unknown): number` — throws `Error` with message if invalid

- [ ] **Step 1: Write the failing test file**

Create `lib/reconcile-totals.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeProjectedTotal,
  defaultReconcileSelection,
  parseExpectedTotal,
  totalsMatch,
  type ReconcileTotalChange,
} from "./reconcile-totals";

const row = (
  partial: Partial<ReconcileTotalChange> & Pick<ReconcileTotalChange, "id" | "kind">,
): ReconcileTotalChange => ({
  statement: null,
  tracked: null,
  ...partial,
});

describe("defaultReconcileSelection", () => {
  it("selects add/update/kept/locked and skips unchanged", () => {
    const selected = defaultReconcileSelection([
      { id: "a", kind: "add" },
      { id: "u", kind: "update" },
      { id: "k", kind: "kept" },
      { id: "l", kind: "locked" },
      { id: "x", kind: "unchanged" },
    ]);
    assert.deepEqual(selected, { a: true, u: true, k: true, l: true });
  });
});

describe("computeProjectedTotal", () => {
  it("matches default UI new-total math including locked", () => {
    const changes: ReconcileTotalChange[] = [
      row({ id: "1", kind: "add", statement: { amount: 100 } }),
      row({ id: "2", kind: "update", statement: { amount: 50 }, tracked: { amount: 40 } }),
      row({ id: "3", kind: "unchanged", tracked: { amount: 20 } }),
      row({ id: "4", kind: "kept", tracked: { amount: 10 } }),
      row({ id: "5", kind: "locked", tracked: { amount: 5 } }),
    ];
    const selected = defaultReconcileSelection(changes);
    assert.equal(computeProjectedTotal(changes, selected), 185);
  });

  it("respects unchecked kept/locked and unselected update falls back to tracked", () => {
    const changes: ReconcileTotalChange[] = [
      row({ id: "2", kind: "update", statement: { amount: 50 }, tracked: { amount: 40 } }),
      row({ id: "4", kind: "kept", tracked: { amount: 10 } }),
      row({ id: "5", kind: "locked", tracked: { amount: 5 } }),
    ];
    assert.equal(computeProjectedTotal(changes, { "2": false, "4": false, "5": true }), 45);
  });
});

describe("totalsMatch", () => {
  it("allows 0.01 tolerance", () => {
    assert.equal(totalsMatch(10, 10.01), true);
    assert.equal(totalsMatch(10, 10.02), false);
  });
});

describe("parseExpectedTotal", () => {
  it("accepts positive finite numbers", () => {
    assert.equal(parseExpectedTotal(12.34), 12.34);
  });

  it("rejects missing, zero, negative, non-finite", () => {
    for (const value of [undefined, null, 0, -1, Number.NaN, "10", {}]) {
      assert.throws(() => parseExpectedTotal(value));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx --yes tsx --test lib/reconcile-totals.test.ts
```

Expected: FAIL (module `./reconcile-totals` not found).

- [ ] **Step 3: Implement `lib/reconcile-totals.ts`**

```ts
export type ReconcileTotalChange = {
  id: string;
  kind: "update" | "add" | "kept" | "unchanged" | "locked";
  statement: { amount: number } | null;
  tracked: { amount: number } | null;
};

export const RECONCILE_AMOUNT_TOLERANCE = 0.01;

export function defaultReconcileSelection(
  changes: Array<{ id: string; kind: ReconcileTotalChange["kind"] }>,
): Record<string, boolean> {
  const selected: Record<string, boolean> = {};
  for (const change of changes) {
    if (change.kind === "add" || change.kind === "update" || change.kind === "kept" || change.kind === "locked") {
      selected[change.id] = true;
    }
  }
  return selected;
}

export function computeProjectedTotal(
  changes: ReconcileTotalChange[],
  selected: Record<string, boolean>,
): number {
  return changes.reduce((sum, change) => {
    const isSelected = !!selected[change.id];
    if (change.kind === "add") return isSelected ? sum + (change.statement?.amount ?? 0) : sum;
    if (change.kind === "update") {
      return sum + (isSelected ? (change.statement?.amount ?? 0) : (change.tracked?.amount ?? 0));
    }
    if (change.kind === "kept" || change.kind === "locked") {
      return isSelected ? sum + (change.tracked?.amount ?? 0) : sum;
    }
    return sum + (change.tracked?.amount ?? 0);
  }, 0);
}

export function totalsMatch(a: number, b: number): boolean {
  return Math.abs(Number(a) - Number(b)) <= RECONCILE_AMOUNT_TOLERANCE;
}

export function parseExpectedTotal(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("A positive expected total is required.");
  }
  return value;
}
```

- [ ] **Step 4: Add npm test script and re-run**

In `package.json` scripts add:

```json
"test": "tsx --test lib/**/*.test.ts"
```

Install tsx as a devDependency:

```bash
npm install -D tsx
```

Run:

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add lib/reconcile-totals.ts lib/reconcile-totals.test.ts package.json package-lock.json
git commit -m "$(cat <<'EOF'
Add shared reconcile projected-total helpers.

EOF
)"
```

---

### Task 2: API — validate expectedTotal + pass-1 prompt target + response fields

**Files:**
- Modify: `app/api/reconcile-statement/route.ts`

**Interfaces:**
- Consumes: `parseExpectedTotal`, `defaultReconcileSelection`, `computeProjectedTotal`, `totalsMatch` from `@/lib/reconcile-totals`
- Produces (response JSON additions): `expectedTotal: number`, `projectedTotal: number`, `totalMatches: boolean`, `usedSecondPass: boolean` (pass 2 still always `false` in this task)

- [ ] **Step 1: Extend request type and validate early in `POST`**

Update `ReconcileRequestBody`:

```ts
type ReconcileRequestBody = {
  image?: string;
  images?: string[];
  expenses?: ExpenseInput[];
  accountName?: string;
  currencyCode?: "USD" | "PHP";
  selectedMonthKey?: string;
  expectedTotal?: number;
};
```

After parsing body, before image checks:

```ts
let expectedTotal: number;
try {
  expectedTotal = parseExpectedTotal(body.expectedTotal);
} catch (error) {
  const message = error instanceof Error ? error.message : "A positive expected total is required.";
  return NextResponse.json({ error: message }, { status: 400 });
}
```

- [ ] **Step 2: Add target lines to the pass-1 prompt in `extractLineItemsFromImage`**

Add params `expectedTotal: number` and include in the prompt (near the return-shape instructions):

```ts
`TARGET TOTAL: After reconcile, the user's tracked expenses for this account/month should sum to ${expectedTotal} (including installment/recurring charges that stay locked).`,
"Extract charges so that the resulting tracked total is as close as possible to that target.",
"Prefer correct billed amounts from the image. Do NOT invent charges that are not visible just to hit the total.",
```

Pass `expectedTotal` from `POST` into each `extractLineItemsFromImage` call.

- [ ] **Step 3: After `buildDiff`, compute projected total and return new fields**

```ts
import {
  computeProjectedTotal,
  defaultReconcileSelection,
  parseExpectedTotal,
  totalsMatch,
} from "@/lib/reconcile-totals";

// after: const changes = buildDiff(lineItems, expenses);
const selected = defaultReconcileSelection(changes);
const projectedTotal = computeProjectedTotal(changes, selected);
const totalMatches = totalsMatch(projectedTotal, expectedTotal);

return NextResponse.json({
  changes,
  lineItemCount: lineItems.length,
  imageCount: images.length,
  source: "openrouter",
  expectedTotal,
  projectedTotal,
  totalMatches,
  usedSecondPass: false,
});
```

- [ ] **Step 4: Manual smoke (no live AI required for validation path)**

Temporarily call the route logic mentally / via a quick unit-less check: missing `expectedTotal` must 400. If the app is running:

```bash
curl -s -X POST http://localhost:3000/api/reconcile-statement \
  -H 'Content-Type: application/json' \
  -d '{"images":["data:image/png;base64,xx"],"expectedTotal":0}'
```

Expected: JSON error about positive expected total, status 400.

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add app/api/reconcile-statement/route.ts
git commit -m "$(cat <<'EOF'
Require expectedTotal on reconcile and return projected total.

EOF
)"
```

---

### Task 3: API — second-pass revision when totals miss

**Files:**
- Modify: `app/api/reconcile-statement/route.ts`

**Interfaces:**
- Consumes: pass-1 `lineItems`, `changes`, `projectedTotal`, `expectedTotal`, images, expenses
- Produces: `usedSecondPass: true` when revision runs; updated `changes` / `projectedTotal` / `totalMatches` from revised items; on revision failure keep pass-1 payload with `usedSecondPass: false`

- [ ] **Step 1: Add `reviseLineItemsForExpectedTotal` helper**

Place near `extractLineItemsFromImage`. Signature:

```ts
const reviseLineItemsForExpectedTotal = async (params: {
  apiKey: string;
  images: string[];
  expenses: ExpenseInput[];
  previousLineItems: StatementLineItem[];
  expectedTotal: number;
  projectedTotal: number;
  currencyCode: "USD" | "PHP";
  accountName: string;
  selectedMonthKey?: string;
}): Promise<StatementLineItem[]>
```

Implementation notes (must follow existing OpenRouter call style in this file):

- `model`: same as extract (`anthropic/claude-sonnet-5` unless already changed)
- `max_tokens`: `8192`
- `response_format`: `{ type: "json_object" }`
- Use `parseModelJson` on the content
- User content: text prompt **first**, then each image as `{ type: "image_url", image_url: { url, detail: "high" } }`
- Prompt must include:
  - expectedTotal, projectedTotal, delta (`expectedTotal - projectedTotal`)
  - JSON of `previousLineItems`
  - JSON of tracked expenses (id/description/amount/date) so matching still works
  - instruction: return ONLY `{ "lineItems": [ ... same shape ... ] }` revising items so re-diff projected total hits expected; only use charges visible on images; fix amounts / add missing / drop false positives; no invented charges
- On empty/invalid content: throw (caller catches)

- [ ] **Step 2: Wire conditional pass 2 in `POST`**

After pass-1 `changes` / `projectedTotal` / `totalMatches`:

```ts
let lineItemsFinal = lineItems;
let changesFinal = changes;
let projectedFinal = projectedTotal;
let matchesFinal = totalMatches;
let usedSecondPass = false;

if (!matchesFinal) {
  try {
    const revised = await reviseLineItemsForExpectedTotal({
      apiKey,
      images,
      expenses,
      previousLineItems: lineItems,
      expectedTotal,
      projectedTotal: projectedFinal,
      currencyCode,
      accountName,
      selectedMonthKey: body.selectedMonthKey,
    });
    const revisedDeduped = dedupeLineItems(revised);
    const revisedChanges = buildDiff(revisedDeduped, expenses);
    const revisedSelected = defaultReconcileSelection(revisedChanges);
    const revisedProjected = computeProjectedTotal(revisedChanges, revisedSelected);
    lineItemsFinal = revisedDeduped;
    changesFinal = revisedChanges;
    projectedFinal = revisedProjected;
    matchesFinal = totalsMatch(revisedProjected, expectedTotal);
    usedSecondPass = true;
  } catch {
    // keep pass-1 results; usedSecondPass stays false
  }
}

return NextResponse.json({
  changes: changesFinal,
  lineItemCount: lineItemsFinal.length,
  imageCount: images.length,
  source: "openrouter",
  expectedTotal,
  projectedTotal: projectedFinal,
  totalMatches: matchesFinal,
  usedSecondPass,
});
```

- [ ] **Step 3: Sanity-check control flow**

- If pass 1 already matches → no second OpenRouter call (`usedSecondPass: false`).
- If pass 2 throws → response still 200 with pass-1 changes (when wrapped only around revise).
- Do not add a third pass.

- [ ] **Step 4: Commit (only if user asked)**

```bash
git add app/api/reconcile-statement/route.ts
git commit -m "$(cat <<'EOF'
Add reconcile second-pass AI when projected total misses expected.

EOF
)"
```

---

### Task 4: UI — required expected-total step before file picker

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `parseAmountDisplay`, `formatAmountDisplay`, `formatCurrencySymbol`, `getCurrencySymbol` (existing in file)
- Produces: `reconcileExpectedTotal` sent in API body; prompt modal before `reconcileFileInputRef.click()`

- [ ] **Step 1: Extend reconcile types/state**

Update `ReconcileState`:

```ts
type ReconcileState = {
  status: "loading" | "ready" | "error";
  accountName: string;
  paymentType: PaymentType;
  cardId: string | null;
  changes: ReconcileChange[];
  selected: Record<string, boolean>;
  lineItemCount: number;
  imageCount: number;
  error: string;
  applying: boolean;
  expectedTotal: number;
};
```

Add prompt state near other reconcile state:

```ts
type ReconcilePromptState = {
  accountName: string;
  paymentType: PaymentType;
  cardId: string | null;
  expectedTotalDisplay: string;
};

const [reconcilePrompt, setReconcilePrompt] = useState<ReconcilePromptState | null>(null);
const reconcileExpectedTotalRef = useRef<number | null>(null);
```

- [ ] **Step 2: Change `startReconcile` to open the amount step**

```ts
const startReconcile = (paymentType: PaymentType, cardId: string | null, accountName: string) => {
  reconcileContextRef.current = { paymentType, cardId, accountName };
  reconcileExpectedTotalRef.current = null;
  setReconcilePrompt({
    accountName,
    paymentType,
    cardId,
    expectedTotalDisplay: "",
  });
};
```

- [ ] **Step 3: Add continue handler + prompt modal JSX**

Handler:

```ts
const continueReconcileWithExpectedTotal = () => {
  if (!reconcilePrompt) return;
  const amount = parseAmountDisplay(reconcilePrompt.expectedTotalDisplay);
  if (!(amount > 0)) return;
  reconcileExpectedTotalRef.current = amount;
  setReconcilePrompt(null);
  reconcileFileInputRef.current?.click();
};
```

Render a fixed overlay (same visual language as expense modal: `fixed inset-0 z-50 ...`, Card, Input) when `reconcilePrompt` is set:

- Title: `Reconcile — {accountName}`
- Label: `Expected total after reconcile` + currency symbol hint
- Input using `formatAmountDisplay` / `expectedTotalDisplay`
- Helper text: `Include installment and recurring charges for this month.`
- Buttons: Cancel (`setReconcilePrompt(null)`), Continue (disabled when `parseAmountDisplay(...) <= 0`)

- [ ] **Step 4: Send `expectedTotal` in the fetch body + seed state**

In `onReconcileFileChange`, before fetch:

```ts
const expectedTotal = reconcileExpectedTotalRef.current;
if (!(typeof expectedTotal === "number" && expectedTotal > 0)) {
  setReconcile({
    status: "error",
    accountName: ctx.accountName,
    paymentType: ctx.paymentType,
    cardId: ctx.cardId,
    changes: [],
    selected: {},
    lineItemCount: 0,
    imageCount: files.length,
    error: "A positive expected total is required.",
    applying: false,
    expectedTotal: 0,
  });
  return;
}
```

Include `expectedTotal` in every `setReconcile(...)` initialization in this handler, and in the JSON body:

```ts
body: JSON.stringify({
  images,
  expenses: scoped,
  accountName: ctx.accountName,
  currencyCode,
  selectedMonthKey,
  expectedTotal,
}),
```

On ready response, keep `expectedTotal` from ref (or `json.expectedTotal` if present).

- [ ] **Step 5: Manual UI check**

- Click Reconcile → amount step appears (file picker does not open yet).
- Continue disabled for empty/0.
- Valid amount → file picker opens.
- Cancel closes without picker.

- [ ] **Step 6: Commit (only if user asked)**

```bash
git add app/page.tsx
git commit -m "$(cat <<'EOF'
Ask for expected reconcile total before statement upload.

EOF
)"
```

---

### Task 5: UI — match/mismatch banner + live total vs expected

**Files:**
- Modify: `app/page.tsx`
- Optionally import `totalsMatch` from `@/lib/reconcile-totals` (or inline `Math.abs(diff) <= 0.01` to avoid coupling — prefer import for one source of truth)

**Interfaces:**
- Consumes: `reconcile.expectedTotal`, existing `newTotal` reduce in results IIFE
- Produces: banner above change list; live off-by as checkboxes toggle

- [ ] **Step 1: Prefer shared selection helper when building initial `selected`**

After API returns `changes`, replace the manual selected loop with:

```ts
import { defaultReconcileSelection, totalsMatch } from "@/lib/reconcile-totals";

const selected = defaultReconcileSelection(changes);
```

(Keep behavior identical to current loop.)

- [ ] **Step 2: Add banner in `status === "ready"` block**

Place after the “Statement charges found…” paragraph:

```tsx
{(() => {
  const expected = reconcile.expectedTotal;
  const liveTotal = newTotal;
  const delta = liveTotal - expected;
  const matches = totalsMatch(liveTotal, expected);
  return (
    <Card>
      <CardContent className={`p-4 text-sm ${matches ? "text-[#34d399]" : "text-[#fbbf24]"}`}>
        {matches ? (
          <p>Total matches expected: {formatCurrencySymbol(expected, currencyCode)}</p>
        ) : (
          <p>
            Expected {formatCurrencySymbol(expected, currencyCode)}
            {" · "}
            reconciled total {formatCurrencySymbol(liveTotal, currencyCode)}
            {" · "}
            off by {formatCurrencySymbol(Math.abs(delta), currencyCode)}
            {delta > 0.01 ? " (over)" : delta < -0.01 ? " (under)" : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
})()}
```

`newTotal` is already computed above in the same IIFE — reuse it (do not recompute differently).

- [ ] **Step 3: Ensure Apply remains enabled on mismatch**

Do not gate `applyReconcile` / Approve button on `totalsMatch`. No code change if already ungated — verify only.

- [ ] **Step 4: Manual check**

- Banner shows expected vs live total.
- Toggle a kept/add checkbox → off-by updates.
- Approve still works when mismatched.

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add app/page.tsx
git commit -m "$(cat <<'EOF'
Show live expected vs reconciled total on statement reconcile.

EOF
)"
```

---

### Task 6: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run unit tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run lint on touched files**

```bash
npx eslint lib/reconcile-totals.ts app/api/reconcile-statement/route.ts app/page.tsx
```

Expected: no new errors.

- [ ] **Step 3: Manual reconcile happy path**

1. Reconcile → enter expected total that matches your known month total → upload statement page(s).
2. Confirm results load; banner match or mismatch is sensible.
3. If first pass was off, check network/logs that a second model call occurred (`usedSecondPass` in JSON).
4. Toggle rows; banner updates; Apply still works.

- [ ] **Step 4: Manual failure paths**

1. API without `expectedTotal` → 400.
2. Cancel on amount step → no upload.
3. (Optional) Force pass-2 failure by temporarily throwing in revise — results still show pass-1. Revert after check.

---

## Spec coverage self-review

| Spec requirement | Task |
| --- | --- |
| Required expected total (UI) | Task 4 |
| Required expected total (API 400) | Task 2 |
| Total includes locked installment/recurring | Task 1 + 2 (`computeProjectedTotal`) |
| Pass 1 prompt target | Task 2 |
| Pass 2 when off > 0.01, with images + delta | Task 3 |
| Pass 2 failure keeps pass 1 | Task 3 |
| No third pass | Task 3 |
| Response fields expected/projected/matches/usedSecondPass | Tasks 2–3 |
| Results banner + live checkbox updates | Task 5 |
| Apply not blocked on mismatch | Task 5 |
| Cost ~2× when miss | implicit in Task 3 (documented in spec) |

## Placeholder / consistency check

- Types use `expectedTotal`, `projectedTotal`, `totalMatches`, `usedSecondPass` consistently.
- Selection/total math centralized in `lib/reconcile-totals.ts`.
- No TBD/TODO left in steps.
