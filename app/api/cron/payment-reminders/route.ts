import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CreditCardRow = {
  id: string;
  user_id: string;
  name: string;
  cutoff_day: number;
  payment_deadline_day: number;
};

type ExpenseRow = {
  id: string;
  user_id: string;
  card_id: string | null;
  description: string;
  amount: number;
  expense_date: string;
  payment_type: "cash" | "credit";
  is_installment: boolean;
  installment_tenure_months: number | null;
  installment_monthly_amount: number | null;
  installment_months_paid: number;
  is_recurring: boolean;
};

type PaymentRow = {
  card_id: string;
  statement_month_key: string;
};

type ReminderRow = {
  card_id: string;
  statement_month_key: string;
};

type DueCardItem = {
  label: string;
  amount: number;
};

type DueCard = {
  card: CreditCardRow;
  deadline: Date;
  daysUntilDue: number;
  balance: number;
  statementMonthKey: string;
  items: DueCardItem[];
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pad2 = (value: number) => String(value).padStart(2, "0");

const parseDbDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  if (!day || !month || !year) return null;
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return parsed;
};

const getStatementMonthKey = (expenseDate: Date, cutoffDay: number) => {
  const statementDate = new Date(expenseDate.getFullYear(), expenseDate.getMonth(), 1);
  if (expenseDate.getDate() > cutoffDay) statementDate.setMonth(statementDate.getMonth() + 1);
  return `${statementDate.getFullYear()}-${pad2(statementDate.getMonth() + 1)}`;
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

const formatHistoryDate = (value: string) => {
  const [, month, day] = value.split("-").map(Number);
  if (!month || !day) return value;
  return `${MONTH_NAMES[month - 1]} ${day}`;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildDueLabel = (daysUntilDue: number) =>
  daysUntilDue === 0 ? "due today" : daysUntilDue === 1 ? "due tomorrow" : `due in ${daysUntilDue} days`;

const computeDueCardsForUser = (
  userCards: CreditCardRow[],
  userExpenses: ExpenseRow[],
  paidKeys: Set<string>,
  today: Date,
): DueCard[] => {
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  const getDeadlineDate = (deadlineDay: number, baseYear: number, baseMonth: number) => {
    const lastDay = new Date(baseYear, baseMonth + 1, 0).getDate();
    return new Date(baseYear, baseMonth, Math.min(deadlineDay, lastDay));
  };

  const results: DueCard[] = [];

  for (const card of userCards) {
    let deadline = getDeadlineDate(card.payment_deadline_day, today.getFullYear(), today.getMonth());
    if (deadline.getTime() < todayMidnight.getTime()) {
      deadline = getDeadlineDate(card.payment_deadline_day, today.getFullYear(), today.getMonth() + 1);
    }
    const daysUntilDue = Math.round((deadline.getTime() - todayMidnight.getTime()) / MS_PER_DAY);
    if (daysUntilDue > 5 || daysUntilDue < 0) continue;

    let statementYear = deadline.getFullYear();
    let statementMonth = deadline.getMonth();
    if (card.cutoff_day > card.payment_deadline_day) {
      const previousMonth = new Date(statementYear, statementMonth - 1, 1);
      statementYear = previousMonth.getFullYear();
      statementMonth = previousMonth.getMonth();
    }
    const statementMonthKey = `${statementYear}-${pad2(statementMonth + 1)}`;
    if (paidKeys.has(`${card.id}:${statementMonthKey}`)) continue;

    const items: DueCardItem[] = [];
    for (const item of userExpenses) {
      if (item.payment_type !== "credit" || item.card_id !== card.id) continue;
      const parsedDate = parseDbDate(item.expense_date);
      if (!parsedDate) continue;
      const baseMonthKey = getStatementMonthKey(parsedDate, card.cutoff_day);
      if (item.is_recurring) {
        if (baseMonthKey <= statementMonthKey) {
          items.push({
            label: `${formatHistoryDate(item.expense_date)} \u2014 ${item.description} (Recurring)`,
            amount: Number(item.amount),
          });
        }
        continue;
      }
      if (!item.is_installment || !item.installment_tenure_months || !item.installment_monthly_amount) {
        if (baseMonthKey === statementMonthKey) {
          items.push({
            label: `${formatHistoryDate(item.expense_date)} \u2014 ${item.description}`,
            amount: Number(item.amount),
          });
        }
        continue;
      }
      const [startYear, startMonth] = baseMonthKey.split("-").map(Number);
      for (let idx = item.installment_months_paid; idx < item.installment_tenure_months; idx += 1) {
        const cycleDate = new Date(startYear, startMonth - 1 + idx, 1);
        const cycleKey = `${cycleDate.getFullYear()}-${pad2(cycleDate.getMonth() + 1)}`;
        if (cycleKey === statementMonthKey) {
          items.push({
            label: `${formatHistoryDate(item.expense_date)} \u2014 ${item.description} ${idx + 1}/${item.installment_tenure_months}`,
            amount: Number(item.installment_monthly_amount),
          });
        }
      }
    }

    const balance = items.reduce((sum, line) => sum + line.amount, 0);
    if (balance <= 0) continue;
    results.push({ card, deadline, daysUntilDue, balance, statementMonthKey, items });
  }

  return results.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
};

const renderEmailHtml = (dueCards: DueCard[]) => {
  const sections = dueCards
    .map(({ card, deadline, daysUntilDue, balance, statementMonthKey, items }) => {
      const [statementYearStr, statementMonthStr] = statementMonthKey.split("-");
      const deadlineLabel = `${MONTH_NAMES[deadline.getMonth()]} ${deadline.getDate()}, ${deadline.getFullYear()}`;
      const statementLabel = `${MONTH_NAMES[Number(statementMonthStr) - 1]} ${statementYearStr} statement`;
      const itemRows = items
        .map(
          (line) => `
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#374151;">${escapeHtml(line.label)}</td>
              <td style="padding:6px 0;font-size:13px;color:#374151;text-align:right;white-space:nowrap;">${formatMoney(line.amount)}</td>
            </tr>
          `,
        )
        .join("");
      return `
        <div style="padding:20px 24px;border-bottom:1px solid #e5e7eb;">
          <table role="presentation" style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="vertical-align:top;">
                <div style="font-size:16px;font-weight:600;color:#111827;">${escapeHtml(card.name)}</div>
                <div style="font-size:13px;color:#b45309;margin-top:2px;font-weight:600;">${buildDueLabel(daysUntilDue).toUpperCase()} \u2022 ${deadlineLabel}</div>
                <div style="font-size:12px;color:#6b7280;margin-top:2px;">${statementLabel}</div>
              </td>
              <td style="vertical-align:top;text-align:right;white-space:nowrap;font-size:28px;line-height:1.1;font-weight:800;color:#b91c1c;">
                ${formatMoney(balance)}
              </td>
            </tr>
          </table>
          ${
            items.length > 0
              ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin-top:12px;border-top:1px solid #e5e7eb;padding-top:8px;">
                  <thead>
                    <tr>
                      <th style="text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;padding:8px 0 4px;font-weight:600;">Transactions</th>
                      <th style="text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;padding:8px 0 4px;font-weight:600;">Amount</th>
                    </tr>
                  </thead>
                  <tbody>${itemRows}</tbody>
                </table>`
              : ""
          }
        </div>
      `;
    })
    .join("");

  return `
    <div style="background:#e5e7eb;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
      <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #d1d5db;border-radius:12px;overflow:hidden;">
        <div style="padding:24px;background:#f3f4f6;border-bottom:1px solid #e5e7eb;">
          <h1 style="margin:0;font-size:20px;color:#111827;">Credit Card Payment Reminder</h1>
          <p style="margin:6px 0 0;font-size:14px;color:#6b7280;">You have ${dueCards.length} card${dueCards.length === 1 ? "" : "s"} due for payment soon.</p>
        </div>
        ${sections}
        <div style="padding:16px 24px;font-size:12px;color:#6b7280;background:#f9fafb;">
          Open the expense tracker and tap "Mark as Paid" to stop these reminders.
        </div>
      </div>
    </div>
  `;
};

const renderEmailText = (dueCards: DueCard[]) => {
  const lines: string[] = ["Credit Card Payment Reminder", ""];
  for (const { card, deadline, daysUntilDue, balance, statementMonthKey, items } of dueCards) {
    const [statementYearStr, statementMonthStr] = statementMonthKey.split("-");
    const deadlineLabel = `${MONTH_NAMES[deadline.getMonth()]} ${deadline.getDate()}, ${deadline.getFullYear()}`;
    const statementLabel = `${MONTH_NAMES[Number(statementMonthStr) - 1]} ${statementYearStr} statement`;
    lines.push(`${card.name} \u2014 ${formatMoney(balance)}`);
    lines.push(`  ${buildDueLabel(daysUntilDue)} \u2014 ${deadlineLabel} (${statementLabel})`);
    if (items.length > 0) {
      lines.push("  Transactions:");
      for (const line of items) {
        lines.push(`    \u2022 ${line.label}: ${formatMoney(line.amount)}`);
      }
    }
    lines.push("");
  }
  lines.push('Open the expense tracker and tap "Mark as Paid" to stop these reminders.');
  return lines.join("\n");
};

const isAuthorized = (request: Request) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${cronSecret}`) return true;
  const url = new URL(request.url);
  if (url.searchParams.get("secret") === cronSecret) return true;
  return false;
};

const buildSmtpTransport = () => {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !user || !pass) {
    throw new Error("Missing SMTP_HOST, SMTP_USER, or SMTP_PASSWORD env vars.");
  }
  const port = Number(process.env.SMTP_PORT ?? 587);
  // SMTP_SECURE optional override; defaults to true on port 465, false otherwise.
  const secureEnv = process.env.SMTP_SECURE?.toLowerCase();
  const secure = secureEnv ? secureEnv === "true" || secureEnv === "1" : port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
};

const handle = async (request: Request) => {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let transporter: ReturnType<typeof nodemailer.createTransport>;
  try {
    transporter = buildSmtpTransport();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to initialize SMTP transport";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to initialize Supabase admin client";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const fromAddress = process.env.REMINDER_FROM_EMAIL || process.env.SMTP_USER || "";
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;

  const [cardsResult, expensesResult, paymentsResult, remindersResult] = await Promise.all([
    admin.from("credit_cards").select("id,user_id,name,cutoff_day,payment_deadline_day"),
    admin
      .from("expenses")
      .select(
        "id,user_id,card_id,description,amount,expense_date,payment_type,is_installment,installment_tenure_months,installment_monthly_amount,installment_months_paid,is_recurring",
      )
      .eq("payment_type", "credit"),
    admin.from("credit_card_payments").select("card_id,statement_month_key"),
    admin.from("payment_reminders").select("card_id,statement_month_key").eq("sent_on", todayKey),
  ]);

  if (cardsResult.error) return NextResponse.json({ error: cardsResult.error.message }, { status: 500 });
  if (expensesResult.error) return NextResponse.json({ error: expensesResult.error.message }, { status: 500 });
  if (paymentsResult.error) return NextResponse.json({ error: paymentsResult.error.message }, { status: 500 });
  if (remindersResult.error) return NextResponse.json({ error: remindersResult.error.message }, { status: 500 });

  const cards = (cardsResult.data ?? []) as CreditCardRow[];
  const expenses = (expensesResult.data ?? []) as ExpenseRow[];
  const payments = (paymentsResult.data ?? []) as PaymentRow[];
  const remindersSentToday = (remindersResult.data ?? []) as ReminderRow[];

  const paidKeys = new Set(payments.map((p) => `${p.card_id}:${p.statement_month_key}`));
  const alreadySentKeys = new Set(remindersSentToday.map((r) => `${r.card_id}:${r.statement_month_key}`));

  const cardsByUser = new Map<string, CreditCardRow[]>();
  for (const card of cards) {
    const list = cardsByUser.get(card.user_id) ?? [];
    list.push(card);
    cardsByUser.set(card.user_id, list);
  }
  const expensesByUser = new Map<string, ExpenseRow[]>();
  for (const expense of expenses) {
    const list = expensesByUser.get(expense.user_id) ?? [];
    list.push(expense);
    expensesByUser.set(expense.user_id, list);
  }

  const summary: { userId: string; email: string | null; sent: number; skipped: number; error?: string }[] = [];

  for (const [userId, userCards] of cardsByUser) {
    const userExpenses = expensesByUser.get(userId) ?? [];
    const dueCards = computeDueCardsForUser(userCards, userExpenses, paidKeys, today);

    const pending = dueCards.filter((entry) => !alreadySentKeys.has(`${entry.card.id}:${entry.statementMonthKey}`));
    if (pending.length === 0) {
      summary.push({ userId, email: null, sent: 0, skipped: dueCards.length });
      continue;
    }

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
    const email = userData?.user?.email ?? null;
    if (userError || !email) {
      summary.push({
        userId,
        email: null,
        sent: 0,
        skipped: pending.length,
        error: userError?.message ?? "User has no email on file.",
      });
      continue;
    }

    try {
      const subject =
        pending.length === 1
          ? `${pending[0].card.name} payment ${buildDueLabel(pending[0].daysUntilDue)}`
          : `${pending.length} credit card payments due soon`;

      await transporter.sendMail({
        from: fromAddress,
        to: email,
        subject,
        html: renderEmailHtml(pending),
        text: renderEmailText(pending),
      });

      const insertRows = pending.map((entry) => ({
        user_id: userId,
        card_id: entry.card.id,
        statement_month_key: entry.statementMonthKey,
        sent_on: todayKey,
      }));
      const { error: insertError } = await admin.from("payment_reminders").insert(insertRows);
      if (insertError) throw new Error(`Email sent but failed to log reminders: ${insertError.message}`);

      summary.push({
        userId,
        email,
        sent: pending.length,
        skipped: dueCards.length - pending.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      summary.push({ userId, email, sent: 0, skipped: pending.length, error: message });
    }
  }

  const totalSent = summary.reduce((sum, item) => sum + item.sent, 0);
  return NextResponse.json({ ok: true, date: todayKey, totalSent, users: summary });
};

export const GET = handle;
export const POST = handle;
