# FinFlow

Личный PWA для учёта финансов. React + TypeScript + Vite + Tailwind + Dexie (IndexedDB, offline-first) + Supabase (синк) + Vercel.

## Локальный запуск
```bash
npm ci
cp .env.example .env   # вписать ключи Supabase (без них работает полностью офлайн)
npm run dev -- --host
```

## Деплой
`git push` в `main` → Vercel сам собирает и выкатывает прод. Другие ветки и PR → отдельные preview-ссылки.

Переменные окружения `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` задаются в Vercel (Production и Preview). `.env` в git не попадает.

## База
`supabase_schema.sql` — идемпотентная схема: можно запускать повторно на живой базе, существующие данные не трогает (только `create ... if not exists` и `add column if not exists`). Схема восстановлена по коду, перед первым запуском сверьте с реальной базой.

RLS сейчас `using (true)`: любой с anon-ключом читает и пишет всё. Перед публичным использованием нужна авторизация (Supabase Auth) и политики по `auth.uid()`.
