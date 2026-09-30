#!/usr/bin/env bash
# Запускать из папки АКТУАЛЬНОЙ версии проекта (той, откуда делали `vercel --prod`).
set -e
[ -d .git ] || git init -b main
git add -A
git status --short | head -30
git commit -m "Initial commit: FinFlow PWA" || true
if command -v gh >/dev/null; then
  gh repo create finflow --private --source=. --remote=origin --push
else
  echo
  echo "gh не установлен. Создайте ПРИВАТНЫЙ пустой репозиторий на github.com и выполните:"
  echo "  git remote add origin git@github.com:<ваш-логин>/finflow.git"
  echo "  git push -u origin main"
fi
