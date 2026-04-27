alter table public.expenses
add column if not exists is_recurring boolean not null default false;
