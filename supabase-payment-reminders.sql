create table if not exists public.payment_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.credit_cards(id) on delete cascade,
  statement_month_key text not null,
  sent_on date not null default (current_date),
  created_at timestamptz not null default now(),
  unique (card_id, statement_month_key, sent_on)
);

create index if not exists payment_reminders_sent_on_idx on public.payment_reminders (sent_on);
create index if not exists payment_reminders_user_id_idx on public.payment_reminders (user_id);

alter table public.payment_reminders enable row level security;

drop policy if exists "Users can read own payment reminders" on public.payment_reminders;
create policy "Users can read own payment reminders"
  on public.payment_reminders
  for select
  to authenticated
  using (auth.uid() = user_id);
