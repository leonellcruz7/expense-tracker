create table if not exists public.spending_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null check (period in ('weekly', 'monthly')),
  analysis text not null,
  source text,
  created_at timestamptz not null default now()
);

alter table public.spending_analyses enable row level security;

drop policy if exists "Users can read own spending analyses" on public.spending_analyses;
create policy "Users can read own spending analyses"
  on public.spending_analyses
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own spending analyses" on public.spending_analyses;
create policy "Users can insert own spending analyses"
  on public.spending_analyses
  for insert
  to authenticated
  with check (auth.uid() = user_id);
