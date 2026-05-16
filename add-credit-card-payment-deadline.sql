alter table public.credit_cards
add column if not exists payment_deadline_day integer not null default 15
  check (payment_deadline_day between 1 and 31);
