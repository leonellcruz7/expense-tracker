create table if not exists public.credit_card_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.credit_cards(id) on delete cascade,
  statement_month_key text not null,
  amount_paid numeric(12, 2) not null,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (card_id, statement_month_key)
);

create index if not exists credit_card_payments_user_id_idx on public.credit_card_payments (user_id);
create index if not exists credit_card_payments_card_id_idx on public.credit_card_payments (card_id);

alter table public.credit_card_payments enable row level security;

drop policy if exists "Users can read own credit card payments" on public.credit_card_payments;
create policy "Users can read own credit card payments"
  on public.credit_card_payments
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own credit card payments" on public.credit_card_payments;
create policy "Users can insert own credit card payments"
  on public.credit_card_payments
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own credit card payments" on public.credit_card_payments;
create policy "Users can delete own credit card payments"
  on public.credit_card_payments
  for delete
  to authenticated
  using (auth.uid() = user_id);
