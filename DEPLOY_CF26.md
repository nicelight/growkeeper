# GrowKeeper — конкретное развёртывание CF26

Дата подготовки: 2026-10-26. Это **настройка**, а не подтверждение развёртывания в Cloudflare. Никаких ресурсов в аккаунте этим архивом не создавалось.

## Ресурсы

- D1: `growkeeper_26`
- D1 UUID: `223fac64-f737-49e2-9cea-af6d6c6605df`
- R2: `growkeeper-photos-26` (private; не включать public access)
- Worker: `growkeeper`
- HTTPS origin: `https://growkeeper.natureonzoom.win`
- MCP endpoint: `https://growkeeper.natureonzoom.win/mcp`
- Worker route: Custom Domain `growkeeper.natureonzoom.win` — Wrangler попробует создать при deploy. Домен `natureonzoom.win` должен находиться в этом же Cloudflare-аккаунте. Если hostname уже занят DNS-записью/другим сервисом, сначала устранить конфликт или выбрать другое имя и обновить config.
- События/проактивная отправка: выключены до отдельного end-to-end теста в ChatGPT (`EVENTS_ENABLED=false`). Cron настроен, но не отправляет уведомления при отключённых events.

Бесплатный тариф подходит для пробного запуска, пока соблюдаются лимиты Workers, D1, R2; R2 Free имеет лимит 10 GB-month и лимиты операций, превышение/оплата зависит от условий подписки R2. Cloudflare Free и R2 Free не означают неограниченный бесплатный хостинг.

## На Kubuntu / Linux

Из каталога `growkeeper` в распакованном архиве:

```bash
node -v                 # необходимо >= 22.16.0
npm run verify          # локальные проверки проекта
npx wrangler@4 login    # откроется вход в Cloudflare
npx wrangler@4 whoami   # убедиться, что это тот же аккаунт
```

Не создавайте новую D1 или R2: обе уже созданы в Cloudflare.

## Применить схему

```bash
npx wrangler@4 d1 migrations apply growkeeper_26 --remote
```

Подтвердить миграцию. Проверьте, что в консоли написано `growkeeper_26` и верный UUID; никогда не мигрируйте случайную другую базу.

## Секрет приложения

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npx wrangler@4 secret put APP_SECRET
```

Сгенерированные 64 hex-символа вставить в **интерактивный ввод второго шага**, не отправлять в чат и не вставлять в wrangler.jsonc. Сохранить в менеджере секретов. Если `secret put` предложит создать Worker — допустимо (будет создан stub), затем всё равно выполнить штатный deploy.

## Развернуть

```bash
npx wrangler@4 deploy --dry-run
npx wrangler@4 deploy
curl -i https://growkeeper.natureonzoom.win/healthz
```

Ожидается HTTP 200 и JSON c `ok:true`. Первоначальный custom-domain TLS/DNS может потребовать немного времени. Если Wrangler сообщает о конфликте hostname, не удаляйте существующую DNS-запись вслепую — проверьте, к какому сервису она относится.

## Создать первое учётное приглашение

```bash
npm run user:create -- "Владелец"
```

Команда выдаст уникальные `user_id`, `gk_...` login key и SQL-файл `.local/user-<UUID>.sql`; выполнить ровно напечатанную команду, пример:

```bash
npx wrangler@4 d1 execute growkeeper_26 --remote --file .local/user-<СОЗДАННЫЙ_UUID>.sql
```

Ключ не пересылать в чат, GitHub, Issues или логи. Затем открыть `https://growkeeper.natureonzoom.win/login`, использовать ключ и проверить загрузку страницы/создание тестового растения.

## Подключение ChatGPT — отдельный этап

- MCP: `https://growkeeper.natureonzoom.win/mcp`
- OAuth: public client id `growkeeper-chatgpt`, без client secret, PKCE S256
- `EVENTS_ENABLED` оставить выключенным, пока не проверены OAuth, вложения и поддержка инициативных событий конкретным ChatGPT-клиентом.

Обязательно продолжить по **RUNBOOK.md, разделы 8–13**. Код локально проверен; реальные Cloudflare D1/workerd/MCP интеграции на этапе подготовки конфигурации **не тестировались**.
