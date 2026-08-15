alter table public.credit_cards
add column if not exists last_four text
  check (last_four is null or last_four ~ '^\d{4}$');
