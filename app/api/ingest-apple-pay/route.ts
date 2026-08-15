import { NextResponse } from "next/server";

import { isIngestAuthorized, parseApplePayIngest } from "@/lib/ingest-apple-pay";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isIngestAuthorized(request.headers.get("authorization"), process.env.APPLE_PAY_INGEST_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = process.env.APPLE_PAY_INGEST_USER_ID?.trim();
  if (!userId) {
    return NextResponse.json({ error: "APPLE_PAY_INGEST_USER_ID is not configured." }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON body is required." }, { status: 400 });
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to initialize database.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data: cards, error: cardsError } = await admin
    .from("credit_cards")
    .select("id,name,last_four")
    .eq("user_id", userId);

  if (cardsError) {
    return NextResponse.json({ error: cardsError.message }, { status: 500 });
  }

  const parsed = parseApplePayIngest({ body, cards: cards ?? [] });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  const { data: expense, error: insertError } = await admin
    .from("expenses")
    .insert({
      user_id: userId,
      ...parsed.expense,
    })
    .select("id,description,amount,currency_code,expense_date,card_id")
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, expense });
}
