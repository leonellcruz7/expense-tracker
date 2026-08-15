import { timingSafeEqual } from "node:crypto";

export type IngestCard = {
  id: string;
  name: string;
  last_four: string | null;
};

export type IngestExpense = {
  description: string;
  amount: number;
  currency_code: "USD" | "PHP";
  expense_date: string;
  payment_type: "credit";
  card_id: string;
  is_installment: false;
  is_recurring: false;
  installment_tenure_months: null;
  installment_monthly_amount: null;
  installment_months_paid: 0;
};

export type IngestSuccess = { ok: true; expense: IngestExpense };
export type IngestFailure = { ok: false; status: number; error: string };

const DEFAULT_TIME_ZONE = "Asia/Manila";

export function isIngestAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length);
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(secret);
  if (tokenBuf.length !== secretBuf.length) return false;
  return timingSafeEqual(tokenBuf, secretBuf);
}

export function parseApplePayIngest(input: {
  body: unknown;
  cards: IngestCard[];
  now?: Date;
  timeZone?: string;
}): IngestSuccess | IngestFailure {
  if (!input.body || typeof input.body !== "object" || Array.isArray(input.body)) {
    return { ok: false, status: 400, error: "JSON body is required." };
  }
  const body = input.body as Record<string, unknown>;
  const description = firstString(body, ["description", "name", "Name", "merchant", "Merchant"]);
  if (!description) {
    return { ok: false, status: 400, error: "A merchant name is required." };
  }

  const amount = parseAmount(firstValue(body, ["amount", "Amount", "currency_amount", "Currency Amount"]));
  if (amount === null) {
    return { ok: false, status: 400, error: "A positive amount is required." };
  }

  const currencyRaw =
    firstString(body, ["currency", "currency_code", "currencyCode", "Currency Code"]) ??
    nestedCurrency(firstValue(body, ["amount", "Amount"]));
  const currency_code = parseCurrency(currencyRaw);

  const cardName = firstString(body, ["card_name", "cardName", "card", "Card"]);
  if (!cardName) {
    return { ok: false, status: 400, error: "A Wallet card name is required." };
  }
  const card = matchCard(cardName, input.cards);
  if (!card) {
    return { ok: false, status: 422, error: `No tracker card matches Wallet card "${cardName}".` };
  }

  const expense_date =
    firstString(body, ["expense_date", "date"]) ??
    formatDateInZone(input.now ?? new Date(), input.timeZone ?? DEFAULT_TIME_ZONE);

  return {
    ok: true,
    expense: {
      description,
      amount,
      currency_code,
      expense_date,
      payment_type: "credit",
      card_id: card.id,
      is_installment: false,
      is_recurring: false,
      installment_tenure_months: null,
      installment_monthly_amount: null,
      installment_months_paid: 0,
    },
  };
}

function firstValue(body: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== "") return body[key];
  }
  return undefined;
}

function firstString(body: Record<string, unknown>, keys: string[]): string | null {
  const value = firstValue(body, keys);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseAmount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? roundMoney(value) : null;
  }
  if (typeof value === "string") {
    const stripped = value.replace(/[^0-9.]/g, "");
    const parsed = Number(stripped);
    return Number.isFinite(parsed) && parsed > 0 ? roundMoney(parsed) : null;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return parseAmount(record.amount ?? record.Amount ?? record.currencyAmount);
  }
  return null;
}

function nestedCurrency(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const raw = record.currencyCode ?? record.currency_code ?? record.currency;
  return typeof raw === "string" ? raw : null;
}

function parseCurrency(value: string | null): "USD" | "PHP" {
  const normalized = (value ?? "").trim().toUpperCase();
  if (normalized === "USD" || normalized === "$" || normalized === "US$") return "USD";
  return "PHP";
}

function matchCard(walletName: string, cards: IngestCard[]): IngestCard | null {
  const walletNorm = normalizeName(walletName);
  const walletDigits = walletName.replace(/\D/g, "");
  const scored = cards
    .map((card) => {
      const nameNorm = normalizeName(card.name);
      let score = 0;
      if (walletNorm === nameNorm) score = 1000 + nameNorm.length;
      else if (walletNorm.includes(nameNorm) || nameNorm.includes(walletNorm)) {
        score = 100 + Math.min(walletNorm.length, nameNorm.length);
      }
      if (card.last_four && walletDigits.includes(card.last_four)) score += 50;
      return { card, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.card ?? null;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function formatDateInZone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
