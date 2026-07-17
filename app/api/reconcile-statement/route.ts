import { NextResponse } from "next/server";

type ExpenseInput = {
  id: string;
  description: string;
  amount: number;
  expense_date: string;
  payment_type: "cash" | "credit";
  card_id: string | null;
  is_installment: boolean;
  is_recurring: boolean;
};

type ReconcileRequestBody = {
  image?: string;
  images?: string[];
  expenses?: ExpenseInput[];
  accountName?: string;
  currencyCode?: "USD" | "PHP";
  selectedMonthKey?: string;
};

type StatementLineItem = {
  description: string;
  amount: number;
  date: string | null;
  matchedExpenseId: string | null;
};

type DiffRow = {
  id: string;
  kind: "update" | "add" | "kept" | "unchanged" | "locked";
  expenseId: string | null;
  statement: { description: string; amount: number; date: string | null } | null;
  tracked: { description: string; amount: number; expense_date: string } | null;
};

const AMOUNT_TOLERANCE = 0.01;
/** Reject AI description-only matches when amounts differ by more than this relative ratio. */
const MAX_MATCH_AMOUNT_RATIO = 0.15;

const normalizeText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

const amountsMatch = (a: number, b: number) => Math.abs(Number(a) - Number(b)) <= AMOUNT_TOLERANCE;

const amountsCloseEnoughToMatch = (a: number, b: number) => {
  if (amountsMatch(a, b)) return true;
  const absA = Math.abs(Number(a));
  const absB = Math.abs(Number(b));
  const maxAbs = Math.max(absA, absB, 0.01);
  return Math.abs(absA - absB) / maxAbs <= MAX_MATCH_AMOUNT_RATIO;
};

const pushMatchedRow = (
  rows: DiffRow[],
  nextId: () => string,
  matched: ExpenseInput,
  description: string,
  amount: number,
  date: string | null,
) => {
  const amountDiffers = !amountsMatch(matched.amount, amount);
  const descDiffers = description.length > 0 && normalizeText(matched.description) !== normalizeText(description);
  const dateDiffers = date !== null && date !== matched.expense_date;
  rows.push({
    id: nextId(),
    kind: amountDiffers || descDiffers || dateDiffers ? "update" : "unchanged",
    expenseId: matched.id,
    statement: { description: description || matched.description, amount, date },
    tracked: { description: matched.description, amount: matched.amount, expense_date: matched.expense_date },
  });
};

const buildDiff = (lineItems: StatementLineItem[], expenses: ExpenseInput[]): DiffRow[] => {
  const trackedById = new Map(expenses.map((expense) => [expense.id, expense]));
  const usedExpenseIds = new Set<string>();
  const rows: DiffRow[] = [];
  let rowId = 0;
  const nextId = () => `row-${rowId++}`;

  // Installment/recurring expenses are shown but never auto-changed.
  // Statement lines that match them by amount must NOT become "add" duplicates.
  for (const expense of expenses) {
    if (expense.is_installment || expense.is_recurring) {
      rows.push({
        id: nextId(),
        kind: "locked",
        expenseId: expense.id,
        statement: null,
        tracked: { description: expense.description, amount: expense.amount, expense_date: expense.expense_date },
      });
    }
  }

  const unmatchedLines: { description: string; amount: number; date: string | null }[] = [];

  for (const line of lineItems) {
    const amount = Number(line.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const description = typeof line.description === "string" ? line.description.trim() : "";
    const date = typeof line.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(line.date) ? line.date : null;
    const matched =
      line.matchedExpenseId && !usedExpenseIds.has(line.matchedExpenseId)
        ? trackedById.get(line.matchedExpenseId)
        : undefined;

    if (matched) {
      // Reject description-only matches with wildly different amounts (e.g. NZD 27.90 vs PHP 1003).
      if (!amountsCloseEnoughToMatch(matched.amount, amount)) {
        unmatchedLines.push({ description, amount, date });
        continue;
      }
      // Matched installment/recurring: absorb the statement line (no add, no update).
      if (matched.is_installment || matched.is_recurring) {
        usedExpenseIds.add(matched.id);
        continue;
      }
      usedExpenseIds.add(matched.id);
      pushMatchedRow(rows, nextId, matched, description, amount, date);
      continue;
    }

    unmatchedLines.push({ description, amount, date });
  }

  // Fallback: rematch leftover statement lines by amount.
  // Prefer plain expenses (for rename/amount fixes); otherwise absorb into locked recurring/installment.
  for (const line of unmatchedLines) {
    const plainCandidate = expenses.find(
      (expense) =>
        !usedExpenseIds.has(expense.id) &&
        !expense.is_installment &&
        !expense.is_recurring &&
        amountsMatch(expense.amount, line.amount),
    );
    if (plainCandidate) {
      usedExpenseIds.add(plainCandidate.id);
      pushMatchedRow(rows, nextId, plainCandidate, line.description, line.amount, line.date);
      continue;
    }

    const lockedCandidate = expenses.find(
      (expense) =>
        !usedExpenseIds.has(expense.id) &&
        (expense.is_installment || expense.is_recurring) &&
        amountsMatch(expense.amount, line.amount),
    );
    if (lockedCandidate) {
      usedExpenseIds.add(lockedCandidate.id);
      continue;
    }

    rows.push({
      id: nextId(),
      kind: "add",
      expenseId: null,
      statement: { description: line.description || "Statement charge", amount: line.amount, date: line.date },
      tracked: null,
    });
  }

  // Mark unused locked expenses as used so they are listed under locked, not kept.
  for (const expense of expenses) {
    if (expense.is_installment || expense.is_recurring) usedExpenseIds.add(expense.id);
  }

  // Tracked expenses not found on the statement stay in the list — never suggested for deletion.
  for (const expense of expenses) {
    if (usedExpenseIds.has(expense.id)) continue;
    rows.push({
      id: nextId(),
      kind: "kept",
      expenseId: expense.id,
      statement: null,
      tracked: { description: expense.description, amount: expense.amount, expense_date: expense.expense_date },
    });
  }

  return rows;
};

const extractLineItemsFromImage = async (params: {
  apiKey: string;
  image: string;
  expenses: ExpenseInput[];
  currencyCode: "USD" | "PHP";
  accountName: string;
  selectedMonthKey?: string;
  pageLabel: string;
}): Promise<StatementLineItem[]> => {
  const { apiKey, image, expenses, currencyCode, accountName, selectedMonthKey, pageLabel } = params;

  const prompt = [
    "You are extracting charges from ONE page of a financial statement image.",
    `Currency: ${currencyCode}. Account: ${accountName}. Statement month: ${selectedMonthKey ?? "unknown"}.`,
    `This is ${pageLabel}. Extract only what is visible on THIS image.`,
    "",
    "Extract EVERY purchase/charge line item visible.",
    "Ignore payments, refunds, credits, interest, fees summaries, running balances, and totals.",
    "Only individual spending charges with a POSITIVE billed amount.",
    "AMOUNT RULE: use the billed statement amount column (e.g. PHP 1,003.14), NOT foreign amounts in parentheses like (NZD 27.90) or (USD 20.00).",
    "For each line item capture: description (merchant/text), amount (positive number in billed currency), and date as YYYY-MM-DD if visible (else null).",
    "",
    "Optionally match each line to a tracked expense below by amount (exact or within 0.01).",
    "If amounts match, set matchedExpenseId even when names look different.",
    "Do NOT match when amounts differ by more than ~15%.",
    "If no good amount match, set matchedExpenseId to null.",
    "Each tracked expense id may be matched at most once on this page.",
    "",
    "Return ONLY JSON of this exact shape:",
    '{ "extractedCount": number, "lineItems": [ { "description": string, "amount": number, "date": string|null, "matchedExpenseId": string|null } ] }',
    "extractedCount MUST equal lineItems.length.",
    "",
    "Tracked expenses (JSON):",
    JSON.stringify(
      expenses.map((expense) => ({
        id: expense.id,
        description: expense.description,
        amount: expense.amount,
        date: expense.expense_date,
      })),
    ),
  ].join("\n");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-5",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You extract structured data from financial statement images. Return strict JSON.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: image, detail: "high" } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 1000,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    const isQuotaError =
      response.status === 429 ||
      errorText.toLowerCase().includes("quota exceeded") ||
      errorText.toLowerCase().includes("rate limit");
    throw new Error(isQuotaError ? "AI quota/rate limit reached. Please try again later." : `Reconcile request failed: ${errorText}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) throw new Error(`Empty AI response for ${pageLabel}.`);

  let parsed: { lineItems?: StatementLineItem[] };
  try {
    parsed = JSON.parse(content) as { lineItems?: StatementLineItem[] };
  } catch {
    throw new Error(`Could not read ${pageLabel}. Please try a clearer image.`);
  }

  return Array.isArray(parsed.lineItems) ? parsed.lineItems : [];
};

const dedupeLineItems = (items: StatementLineItem[]): StatementLineItem[] => {
  const seen = new Set<string>();
  const result: StatementLineItem[] = [];
  for (const item of items) {
    const amount = Number(item.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const description = typeof item.description === "string" ? item.description.trim() : "";
    const date = typeof item.date === "string" ? item.date : "";
    const key = `${amount.toFixed(2)}|${date}|${normalizeText(description)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      description,
      amount,
      date: typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : null,
      matchedExpenseId: typeof item.matchedExpenseId === "string" ? item.matchedExpenseId : null,
    });
  }
  return result;
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing OPENROUTER_API_KEY in environment variables." }, { status: 500 });
  }

  let body: ReconcileRequestBody;
  try {
    body = (await request.json()) as ReconcileRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const images = [
    ...(Array.isArray(body.images) ? body.images : []),
    ...(typeof body.image === "string" ? [body.image] : []),
  ].filter((value) => typeof value === "string" && value.startsWith("data:image/"));

  if (images.length === 0) {
    return NextResponse.json({ error: "At least one valid statement image is required." }, { status: 400 });
  }
  if (images.length > 5) {
    return NextResponse.json({ error: "You can upload at most 5 statement images." }, { status: 400 });
  }

  const expenses = Array.isArray(body.expenses) ? body.expenses : [];
  const currencyCode = body.currencyCode ?? "USD";
  const accountName = body.accountName ?? "this account";

  try {
    const pageResults = await Promise.all(
      images.map((image, index) =>
        extractLineItemsFromImage({
          apiKey,
          image,
          expenses,
          currencyCode,
          accountName,
          selectedMonthKey: body.selectedMonthKey,
          pageLabel: images.length === 1 ? "the statement image" : `page ${index + 1} of ${images.length}`,
        }),
      ),
    );

    const lineItems = dedupeLineItems(pageResults.flat());
    const changes = buildDiff(lineItems, expenses);

    return NextResponse.json({
      changes,
      lineItemCount: lineItems.length,
      imageCount: images.length,
      source: "openrouter",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("quota") || message.includes("failed:") ? 502 : 500;
    return NextResponse.json({ error: message.startsWith("Reconcile") || message.includes("AI") || message.includes("Could not") || message.includes("Empty") ? message : `Reconcile failed: ${message}` }, { status });
  }
}
