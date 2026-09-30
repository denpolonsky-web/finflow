# Запуск и доступ с телефона

## 1. Локально (только в одной Wi-Fi сети)

```bash
npm run dev -- --host
```
Открыть на iPhone: `http://192.168.x.x:5173` (IP вашего Mac)

Ограничение: работает только когда Mac и iPhone в одной сети.

---

## 2. Доступ с любого IP через Ngrok (рекомендуется для разработки)

Ngrok пробрасывает туннель с HTTPS — можно открывать с любой сети.

```bash
# Установка (один раз)
brew install ngrok

# Регистрация (бесплатно)
# https://dashboard.ngrok.com/signup → скопировать authtoken

ngrok config add-authtoken ВАШ_ТОКЕН

# Запуск (каждый раз вместе с npm run dev)
npm run dev -- --host &
ngrok http 5173
```

Ngrok выдаст ссылку вида `https://abc123.ngrok-free.app` — открывайте с любого устройства, с любой сети. Это HTTPS.

Добавить на экран iPhone: Safari → Поделиться → На экран «Домой»

Ограничение бесплатного Ngrok: ссылка меняется при каждом перезапуске.

---

## 3. Постоянный деплой на Vercel через GitHub (основной способ)

Репозиторий подключён к Vercel: `git push` в `main` → автодеплой в прод, другие ветки → preview-ссылки.
Ручной `vercel --prod` не нужен.

```bash
git add -A && git commit -m "описание" && git push
```

---

## 4. Supabase — синхронизация между устройствами

### Создать базу

1. Зайти на https://supabase.com → New project (бесплатно)
2. В SQL Editor выполнить `supabase_schema.sql` из папки проекта
3. В Settings → API скопировать `Project URL` и `anon public key`

### Подключить к приложению

```bash
cp .env.example .env
# Вписать в .env:
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

После этого при каждом подключении к интернету данные автоматически
синхронизируются с Supabase. Добавили транзакцию офлайн с телефона —
при появлении Wi-Fi она улетит в облако и будет видна на других устройствах.

