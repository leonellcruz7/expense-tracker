import { NextResponse } from "next/server";

type ExpenseInput = {
  description: string;
  amount: number;
  expense_date: string;
  payment_type: "cash" | "credit";
  card_id: string | null;
  is_installment: boolean;
  installment_tenure_months: number | null;
  installment_monthly_amount: number | null;
  installment_months_paid: number;
  is_recurring: boolean;
};

type CardInput = {
  id: string;
  name: string;
  cutoff_day: number;
};

type AnalyzeRequestBody = {
  expenses: ExpenseInput[];
  cards: CardInput[];
  currencyCode: "USD" | "PHP";
  selectedMonthKey: string;
  analysisType?: "weekly" | "monthly";
  comparison?: {
    currentTotal: number;
    previousTotal: number;
    trend: "better" | "worse" | "no_change";
    periodLabel: string;
  };
  previousAnalysis?: string | null;
};

const getSymbol = (currencyCode: "USD" | "PHP") => (currencyCode === "USD" ? "$" : "₱");
const formatMoney = (value: number, currencyCode: "USD" | "PHP") =>
  `${getSymbol(currencyCode)}${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

const buildLocalInsights = (
  expenses: ExpenseInput[],
  cards: CardInput[],
  currencyCode: "USD" | "PHP",
  comparison?: AnalyzeRequestBody["comparison"],
) => {
  const topExpenses = [...expenses]
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
    .slice(0, 5);
  const recurring = expenses.filter((item) => item.is_recurring);
  const installments = expenses.filter((item) => item.is_installment);
  const creditTotal = expenses
    .filter((item) => item.payment_type === "credit")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const cashTotal = expenses
    .filter((item) => item.payment_type === "cash")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const cardTotals = cards
    .map((card) => {
      const total = expenses.filter((item) => item.card_id === card.id).reduce((sum, item) => sum + Number(item.amount || 0), 0);
      return { name: card.name, total };
    })
    .filter((card) => card.total > 0)
    .sort((a, b) => b.total - a.total);

  const topExpenseLines =
    topExpenses.length === 0
      ? "- No expenses found."
      : topExpenses
          .map((item) => `- ${item.description}: ${formatMoney(Number(item.amount || 0), currencyCode)} (${item.payment_type})`)
          .join("\n");

  const cutCandidates = topExpenses.slice(0, 3);
  const potentialSavings = cutCandidates.reduce((sum, item) => sum + Number(item.amount || 0) * 0.2, 0);

  const cardFocus = cardTotals[0]
    ? `- Highest card usage: ${cardTotals[0].name} at ${formatMoney(cardTotals[0].total, currencyCode)}.`
    : "- No credit card concentration detected.";
  const comparisonLine = comparison
    ? comparison.trend === "better"
      ? `- Better than previous ${comparison.periodLabel}: ${formatMoney(comparison.previousTotal, currencyCode)} -> ${formatMoney(comparison.currentTotal, currencyCode)} (down by ${formatMoney(comparison.previousTotal - comparison.currentTotal, currencyCode)}).`
      : comparison.trend === "worse"
        ? `- Worse than previous ${comparison.periodLabel}: ${formatMoney(comparison.previousTotal, currencyCode)} -> ${formatMoney(comparison.currentTotal, currencyCode)} (up by ${formatMoney(comparison.currentTotal - comparison.previousTotal, currencyCode)}).`
        : `- Unchanged from previous ${comparison.periodLabel}: both at ${formatMoney(comparison.currentTotal, currencyCode)}.`
    : "- No previous saved analysis for comparison yet.";

  return [
    "0) Comparison with previous period",
    comparisonLine,
    "",
    "1) Biggest spending areas",
    topExpenseLines,
    cardFocus,
    "",
    "2) What to cut this month",
    cutCandidates.length
      ? `- Start by trimming 20% from your top 3 expenses. Estimated savings: ${formatMoney(potentialSavings, currencyCode)}.`
      : "- No clear cut candidates yet.",
    recurring.length
      ? `- Review ${recurring.length} recurring expense(s) and cancel at least one low-value subscription.`
      : "- You currently have no recurring expenses, which is good for flexibility.",
    "",
    "3) Smarter spending habits",
    `- Current split: cash ${formatMoney(cashTotal, currencyCode)} vs credit ${formatMoney(creditTotal, currencyCode)}.`,
    creditTotal > cashTotal
      ? "- Credit spending is higher than cash. Set a weekly card cap and avoid adding new installment purchases."
      : "- Cash spending is higher than credit. Keep using cash envelopes for discretionary categories.",
    installments.length
      ? `- You have ${installments.length} installment expense(s). Prioritize paying down the highest monthly installments first.`
      : "- No installment burden right now; keep it that way for better monthly cash flow.",
    "",
    "4) Quick wins this week",
    "- Add a spending cap for dining/transport and check progress daily.",
    "- Delay one non-essential purchase by 72 hours before buying.",
    "- Move a small fixed amount to savings immediately after each payday.",
    "",
    "_Note: Generated from local rules because AI quota is unavailable right now._",
  ].join("\n");
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing OPENROUTER_API_KEY in environment variables." }, { status: 500 });
  }

  let body: AnalyzeRequestBody;
  try {
    body = (await request.json()) as AnalyzeRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const expenses = Array.isArray(body.expenses) ? body.expenses : [];
  const cards = Array.isArray(body.cards) ? body.cards : [];
  if (expenses.length === 0) {
    return NextResponse.json({ error: "No expenses provided for analysis." }, { status: 400 });
  }

  const totalSpent = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const paymentTotals = expenses.reduce(
    (acc, item) => {
      if (item.payment_type === "credit") acc.credit += Number(item.amount || 0);
      else acc.cash += Number(item.amount || 0);
      return acc;
    },
    { cash: 0, credit: 0 },
  );

  const prompt = [
    "You are a practical personal finance coach.",
    `The user's currency is ${body.currencyCode}.`,
    `Selected month key in app is ${body.selectedMonthKey}.`,
    `Requested analysis window is ${body.analysisType ?? "weekly"}.`,
    "Use the data below to provide spending insights and actionable suggestions.",
    "Response rules:",
    "- Keep it concise and useful.",
    "- Use these sections exactly:",
    "0) Comparison with previous period",
    "1) Biggest spending areas",
    "2) What to cut this month",
    "3) Smarter spending habits",
    "4) Quick wins this week",
    "- Give specific examples based on the actual records.",
    "- Mention caution for recurring/installment expenses.",
    "- In section 0, explicitly state whether spending is better, worse, or unchanged versus previous period.",
    "",
    `Summary: total_spent=${totalSpent.toFixed(2)}, cash=${paymentTotals.cash.toFixed(2)}, credit=${paymentTotals.credit.toFixed(2)}`,
    `Comparison: ${JSON.stringify(body.comparison ?? null)}`,
    `Previous saved analysis (${body.analysisType ?? "weekly"}): ${body.previousAnalysis ?? "none"}`,
    `Cards: ${JSON.stringify(cards)}`,
    `Expenses: ${JSON.stringify(expenses)}`,
  ].join("\n");

  const endpoint = "https://openrouter.ai/api/v1/chat/completions";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a practical personal finance coach.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.4,
        max_tokens: 700,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      const isQuotaError =
        response.status === 429 ||
        errorText.toLowerCase().includes("quota exceeded") ||
        errorText.toLowerCase().includes("rate limit");
      if (isQuotaError) {
        return NextResponse.json({ analysis: buildLocalInsights(expenses, cards, body.currencyCode, body.comparison), source: "local-fallback" });
      }
      return NextResponse.json({ error: `OpenRouter request failed: ${errorText}` }, { status: 502 });
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const analysis = data.choices?.[0]?.message?.content?.trim() ?? "";

    if (!analysis) {
      return NextResponse.json({ analysis: buildLocalInsights(expenses, cards, body.currencyCode, body.comparison), source: "local-fallback" });
    }

    return NextResponse.json({ analysis, source: "openrouter" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({
      analysis: buildLocalInsights(expenses, cards, body.currencyCode, body.comparison),
      source: "local-fallback",
      warning: message,
    });
  }
}
