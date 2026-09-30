-- FinFlow: схема Supabase. Запускать в Supabase → SQL Editor.
-- Идемпотентна: безопасно выполнять повторно, данные не удаляет.
-- Восстановлена по коду приложения (src/types, src/db/syncDown.ts) — сверьте с живой базой.

create table if not exists transactions (
  id          text primary key,
  type        text not null,
  amount      numeric not null,
  category_id text,
  card_id     text,
  to_card_id  text,
  title       text,
  comment     text,
  date        timestamptz,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  synced_at   timestamptz,
  goal_id     text
);
alter table transactions add column if not exists to_card_id text;
alter table transactions add column if not exists tags jsonb;

create table if not exists cards (
  id          text primary key,
  name        text,
  bank        text,
  balance     numeric default 0,
  last_four   text,
  color       text,
  updated_at  timestamptz default now()
);

create table if not exists goals (
  id             text primary key,
  title          text,
  icon           text,
  target_amount  numeric,
  current_amount numeric default 0,
  deadline       date,
  created_at     timestamptz default now(),
  is_archived    boolean default false
);
alter table goals add column if not exists completed_at timestamptz;

create table if not exists deposits (
  id              text primary key,
  name            text,
  bank            text,
  amount          numeric default 0,
  interest_rate   numeric default 0,
  expected_date   timestamptz,
  expected_amount numeric default 0,
  color           text,
  created_at      timestamptz default now(),
  is_active       boolean default true
);

create table if not exists app_settings (
  id              int primary key,
  user_name       text,
  daily_limit     numeric,
  category_limits jsonb,
  reminder_day    int,
  reminder_hour   int,
  theme           text,
  currency        text
);

create table if not exists devices (
  id        text primary key,
  token     text,
  name      text,
  last_seen timestamptz default now()
);

-- RLS включён, но политики открытые (using true) — доступ у любого с anon-ключом.
-- TODO: Supabase Auth + политики по auth.uid().
alter table transactions enable row level security;
alter table cards        enable row level security;
alter table goals        enable row level security;
alter table deposits     enable row level security;
alter table app_settings enable row level security;
alter table devices      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['transactions','cards','goals','deposits','app_settings','devices'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'owner') then
      execute format('create policy "owner" on %I for all using (true)', t);
    end if;
  end loop;
end $$;
