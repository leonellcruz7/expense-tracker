import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isIngestAuthorized,
  parseApplePayIngest,
  type IngestCard,
} from "./ingest-apple-pay";

const cards: IngestCard[] = [
  { id: "ub-rewards", name: "UnionBank Rewards Platinum", last_four: "4411" },
  { id: "ub-visa", name: "UnionBank U Visa Platinum", last_four: "8822" },
  { id: "metro", name: "Metrobank Titanium", last_four: "1001" },
];

const validBody = {
  description: "Starbucks",
  amount: 185.5,
  currency: "PHP",
  card_name: "UnionBank Rewards Platinum",
};

describe("isIngestAuthorized", () => {
  it("accepts a matching Bearer token", () => {
    assert.equal(isIngestAuthorized("Bearer secret-123", "secret-123"), true);
  });

  it("rejects a missing or mismatched token", () => {
    assert.equal(isIngestAuthorized(null, "secret-123"), false);
    assert.equal(isIngestAuthorized("Bearer other", "secret-123"), false);
    assert.equal(isIngestAuthorized("Bearer secret-123", ""), false);
  });
});

describe("parseApplePayIngest", () => {
  it("builds a credit expense on the matching card for today", () => {
    const result = parseApplePayIngest({
      body: validBody,
      cards,
      now: new Date("2026-08-15T16:30:00.000Z"),
      timeZone: "Asia/Manila",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.expense, {
      description: "Starbucks",
      amount: 185.5,
      currency_code: "PHP",
      expense_date: "2026-08-16",
      payment_type: "credit",
      card_id: "ub-rewards",
      is_installment: false,
      is_recurring: false,
      installment_tenure_months: null,
      installment_monthly_amount: null,
      installment_months_paid: 0,
    });
  });

  it("matches a Wallet card name that contains the tracker name", () => {
    const result = parseApplePayIngest({
      body: { ...validBody, card_name: "Metrobank Titanium Mastercard" },
      cards,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.expense.card_id, "metro");
  });

  it("parses Shortcut amount strings with currency symbols", () => {
    const result = parseApplePayIngest({
      body: { ...validBody, amount: "₱1,250.00", currency: "php" },
      cards,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.expense.amount, 1250);
    assert.equal(result.expense.currency_code, "PHP");
  });

  it("reads merchant and card from Shortcut-style aliases", () => {
    const result = parseApplePayIngest({
      body: {
        Name: "Grab",
        Amount: { amount: 99, currencyCode: "PHP" },
        Card: "UnionBank U Visa Platinum",
      },
      cards,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.expense.description, "Grab");
    assert.equal(result.expense.amount, 99);
    assert.equal(result.expense.card_id, "ub-visa");
  });

  it("rejects an unknown Wallet card instead of guessing", () => {
    const result = parseApplePayIngest({
      body: { ...validBody, card_name: "Apple Cash" },
      cards,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 422);
    assert.match(result.error, /card/i);
  });

  it("rejects a missing merchant or non-positive amount", () => {
    const noName = parseApplePayIngest({ body: { ...validBody, description: "  " }, cards });
    assert.equal(noName.ok, false);
    if (!noName.ok) assert.equal(noName.status, 400);

    const zero = parseApplePayIngest({ body: { ...validBody, amount: 0 }, cards });
    assert.equal(zero.ok, false);
    if (!zero.ok) assert.equal(zero.status, 400);
  });
});
