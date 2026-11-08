-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  FinFlow — схема Supabase, версия 3                                    ║
-- ║  Выполнить целиком в Supabase → SQL Editor. Идемпотентна.              ║
-- ╚════════════════════════════════════════════════════════════════════════╝
--
-- ГЛАВНОЕ ОТЛИЧИЕ ОТ ПРЕДЫДУЩЕЙ ВЕРСИИ:
-- раньше политики были `for all using (true)` — то есть любой, кто открыл
-- сайт и получил anon-ключ из бандла, мог читать и удалять ВСЕ финансовые
-- данные. Здесь каждая строка принадлежит auth.uid(), и чужую строку нельзя
-- ни прочитать, ни изменить, ни вставить от чужого имени.
--
-- Суммы хранятся в КОПЕЙКАХ (bigint). Никаких float для денег.

-- ── Таблицы ──────────────────────────────────────────────────────────────

create table if not exists accounts (
  id              text primary key,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind            text not null default 'debit',
  name            text not null default '',
  bank            text not null default 'other',
  currency        text not null default 'RUB',
  opening_balance bigint not null default 0,
  opening_date    timestamptz,
  last_four       text,
  color           text,
  is_archived     smallint not null default 0,
  sort_order      integer not null default 0,
  credit_limit    bigint,
  interest_rate   numeric,
  capitalization  text,
  maturity_date   timestamptz,
  is_replenishable smallint,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- Подпрофили одного кабинета. Делят user_id — RLS и синхронизация не меняются.
-- Роль нужна приложению для разграничения интерфейса, база её не проверяет.
create table if not exists profiles (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null default '',
  emoji       text default '👤',
  color       text default '#6C63FF',
  role        text not null default 'member',
  pin_hash    text,
  is_archived smallint not null default 0,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists transactions (
  id                 text primary key,
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type               text not null,
  amount             bigint not null,
  category_id        text,
  account_id         text,
  to_account_id      text,
  title              text default '',
  comment            text,
  tags               jsonb,
  date               timestamptz not null,
  exclude_from_stats smallint not null default 0,
  goal_id            text,
  profile_id         text,
  source             text default 'manual',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

-- Проводки: append-only журнал. Баланс счёта = opening_balance + sum(amount).
create table if not exists postings (
  id             text primary key,
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  transaction_id text not null,
  account_id     text not null,
  amount         bigint not null,
  date           timestamptz not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create table if not exists goals (
  id                 text primary key,
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title              text not null default '',
  icon               text default '🎯',
  kind               text default 'save',
  target_amount      bigint not null default 0,
  funding_account_id text,
  manual_amount      bigint not null default 0,
  -- сколько было накоплено на момент создания цели: база для расчёта темпа
  start_amount       bigint,
  cushion_months     integer,
  deadline           timestamptz,
  is_archived        smallint not null default 0,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

-- Справочник категорий. Встроенные живут в коде приложения и сюда НЕ копируются:
-- здесь только свои категории (is_custom = 1) и переопределения встроенных
-- (строка с id встроенной категории). Пустая таблица — нормальное состояние.
create table if not exists categories (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null default '',
  icon        text default '🏷️',
  color       text default '#607D8B',
  type        text not null default 'expense',
  essential   boolean default false,
  is_archived smallint not null default 0,
  is_custom   smallint not null default 0,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists budgets (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id text not null,
  amount      bigint not null default 0,
  period      text not null default 'month',
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists balance_snapshots (
  id              text primary key,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id      text not null,
  at              timestamptz not null,
  stated_balance  bigint not null,
  derived_balance bigint not null,
  gap             bigint not null,
  resolution      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- Одна строка настроек на пользователя: ключ — user_id, не id.
create table if not exists app_settings (
  user_id              uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  user_name            text,
  currency             text default 'RUB',
  theme                text default 'dark',
  runway_window_months integer default 3,
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

-- ── Индексы ──────────────────────────────────────────────────────────────

-- Колонка профиля для баз, созданных до версии 4.
alter table transactions add column if not exists profile_id text;
-- База для расчёта темпа цели; появилась после версии 3.
-- Без неё upsert целей отваливается с ошибкой и уезжает в dead-letter.
alter table goals add column if not exists start_amount bigint;

create index if not exists idx_tx_user_updated   on transactions (user_id, updated_at);
create index if not exists idx_tx_user_profile   on transactions (user_id, profile_id);
create index if not exists idx_prof_user_updated on profiles (user_id, updated_at);
create index if not exists idx_tx_user_date      on transactions (user_id, date desc);
create index if not exists idx_post_user_updated on postings (user_id, updated_at);
create index if not exists idx_post_account      on postings (user_id, account_id);
create index if not exists idx_acc_user_updated  on accounts (user_id, updated_at);
create index if not exists idx_goal_user_updated on goals (user_id, updated_at);
create index if not exists idx_budget_user_upd   on budgets (user_id, updated_at);
create index if not exists idx_cat_user_updated  on categories (user_id, updated_at);
create index if not exists idx_snap_user_updated on balance_snapshots (user_id, updated_at);

-- ── updated_at проставляется сервером ────────────────────────────────────
-- Клиент тоже его шлёт, но триггер гарантирует монотонность: без этого
-- инкрементальный pull (where updated_at > last_pull) может пропускать строки
-- при расхождении часов на устройстве.

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := greatest(now(), coalesce(old.updated_at, now()) + interval '1 microsecond');
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['accounts','transactions','postings','goals','budgets','balance_snapshots','app_settings','profiles','categories'] loop
    execute format('drop trigger if exists trg_%1$s_updated on %1$I', t);
    execute format('create trigger trg_%1$s_updated before insert or update on %1$I for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- ── Row Level Security: доступ строго к своим строкам ────────────────────

do $$
declare t text;
begin
  foreach t in array array['accounts','transactions','postings','goals','budgets','balance_snapshots','app_settings','profiles','categories'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);

    -- старая всеразрешающая политика, если осталась с прошлой версии
    execute format('drop policy if exists "owner" on %I', t);
    execute format('drop policy if exists "own rows select" on %I', t);
    execute format('drop policy if exists "own rows insert" on %I', t);
    execute format('drop policy if exists "own rows update" on %I', t);
    execute format('drop policy if exists "own rows delete" on %I', t);

    execute format($f$create policy "own rows select" on %I
      for select using (user_id = (select auth.uid()))$f$, t);
    execute format($f$create policy "own rows insert" on %I
      for insert with check (user_id = (select auth.uid()))$f$, t);
    execute format($f$create policy "own rows update" on %I
      for update using (user_id = (select auth.uid()))
                 with check (user_id = (select auth.uid()))$f$, t);
    execute format($f$create policy "own rows delete" on %I
      for delete using (user_id = (select auth.uid()))$f$, t);
  end loop;
end $$;

-- ── Уборка tombstone'ов ──────────────────────────────────────────────────
-- Удалённые строки живут 90 дней, чтобы доехать до редко включаемых устройств.
-- Запускать вручную или через pg_cron.

create or replace function purge_tombstones() returns void
language plpgsql security definer as $$
declare t text;
begin
  foreach t in array array['accounts','transactions','postings','goals','budgets','balance_snapshots','profiles','categories'] loop
    execute format('delete from %I where deleted_at is not null and deleted_at < now() - interval ''90 days''', t);
  end loop;
end $$;

-- ── Старые таблицы предыдущей версии ─────────────────────────────────────
-- Оставлены намеренно: сначала убедитесь, что данные перенеслись,
-- и только потом раскомментируйте.
-- drop table if exists cards;
-- drop table if exists deposits;
