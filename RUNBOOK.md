# GrowKeeper — runbook 0.2.0

> Для этого развёртывания в Cloudflare с D1 `growkeeper_26`, R2 `growkeeper-photos-26` и адресом `growkeeper.natureonzoom.win` используйте **`DEPLOY_CF26.md`**. Команды и имена ресурсов ниже — примеры из исходного проекта, не копируйте их дословно.

Документ для первого приватного развёртывания. Команды выполняются из корня проекта на Linux/macOS; в Windows нужен совместимый shell. **Не разворачивать `LOCAL_DEV` в Интернет.**

## 1. Предварительная проверка

```bash
node --version                 # 22.16+; в этой сборке проверено 22.16.0
npm run verify
```

В проекте нет npm runtime dependencies. Для облачных команд потребуется отдельно доступный Wrangler 4 и сеть. В рабочей среде сборки registry был недоступен: версия Wrangler здесь не устанавливалась и облачный dry-run не выполнялся.

```bash
npx wrangler@4 --version
npx wrangler@4 login
```

Запишите фактически использованную версию Wrangler в deployment log и зафиксируйте её в своём CI. Не считайте `@4` точной фиксацией версии.

## 2. Быстрый запуск без Cloudflare

```bash
npm run dev
```

Открыть `http://127.0.0.1:8787`. Использовать ключ, напечатанный сервером. Node adapter хранит D1-совместимые данные в `.local/growkeeper.sqlite`, объекты — в `.local/r2/`.

Здесь **не работают автоматически** ChatGPT reasoning и фоновые сообщения. В UI можно создать растения, загрузить фото, подтвердить привязку, открыть сущности и поменять порог. Фото остаётся в архиве; для диагноза нужно продолжить в подключённом ChatGPT.

`.local/` содержит секреты. Не публиковать, не архивировать и не добавлять в Git. Сервер слушает только loopback, без hot reload.

## 3. Создать облачные ресурсы

Это уже команды, меняющие ваш Cloudflare account. Проверить выбранный аккаунт перед запуском.

```bash
npx wrangler@4 whoami
npx wrangler@4 d1 create growkeeper
npx wrangler@4 r2 bucket create growkeeper-photos
```

Скопировать UUID новой D1 из ответа. R2 оставить **приватным**: не включать `r2.dev` и публичный custom domain. Если R2 уже имеет отдельное тарифицирование в вашем аккаунте, проверить его условия; бесплатность всего приложения не обещается.

Определить постоянный origin. Например, рабочий адрес `https://growkeeper.<ВАШ_WORKERS_SUBDOMAIN>.workers.dev` либо собственный HTTPS domain с настроенным Worker route. Последний не создаётся скриптом проекта.

```bash
npm run plugin:configure -- \
  https://growkeeper.REAL_SUBDOMAIN.workers.dev \
  REAL_D1_DATABASE_UUID
```

Заменить обе величины **реальными**. Скрипт меняет только `wrangler.jsonc` и `plugin/mcp.json`. Никаких запросов в Cloudflare он не делает. Для другого bucket/name поправить соответствующие поля `wrangler.jsonc`.

Проверить:

```text
main: src/worker.js
assets: public, binding ASSETS, run_worker_first=true
DB: нужный D1 UUID
PHOTOS: growkeeper-photos
PUBLIC_ORIGIN: точный постоянный origin без /mcp и без завершающего /
EVENTS_ENABLED: "false" для первого развёртывания
```

Не менять `run_worker_first`: иначе static assets могут обходить Worker-маршрутизацию. В проекте нет KV binding.

## 4. Секрет и миграции

Создать независимый секрет для этого окружения:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npx wrangler@4 secret put APP_SECRET
```

В интерактивный prompt вставить полученные **64 hex-символа**. Сохранить в собственном менеджере секретов. Не помещать секрет в `wrangler.jsonc`, git или чат.

```bash
npx wrangler@4 d1 migrations apply growkeeper --remote
```

`0001_initial.sql` предназначена для новой базы. После первого выпуска **не редактировать уже применённую миграцию**: изменения оформлять новым нумерованным SQL-файлом. Таблицы OAuth, сессии и подписки тоже в D1, KV не нужен.

## 5. Создать пользователя

```bash
npm run user:create -- "Владелец"
```

Скрипт напечатает `user_id`, приватный ключ и путь `.local/user-<UUID>.sql`. SQL содержит SHA-256 хеш ключа, а не его оригинал.

```bash
npx wrangler@4 d1 execute growkeeper --remote --file .local/user-ACTUAL_UUID.sql
```

Для второго пользователя повторить с другим именем. Это **invite-only** схема: нет публичной регистрации, паролей, MFA, восстановления по email или административной панели. Ключ передать человеку приватно. ChatGPT не должен получать его в переписке: вход выполняется только на веб-странице OAuth.

## 6. Проверить в workerd перед облачным запуском

Дополнительная проверка, **не выполненная в среде подготовки архива**:

```bash
node scripts/wrangler-local.mjs
cp .dev.vars.example .dev.vars
# В .dev.vars вписать отдельный тестовый APP_SECRET, не production secret.
npx wrangler@4 d1 migrations apply growkeeper --local --config wrangler.local.jsonc
npx wrangler@4 d1 execute growkeeper --local --config wrangler.local.jsonc --file .local/user-ACTUAL_UUID.sql
npx wrangler@4 dev --config wrangler.local.jsonc --ip 127.0.0.1 --port 8787
```

Не запускать одновременно с `npm run dev` на том же порту. Wrangler-local и Node-local используют **разные** локальные базы и R2-копии; пустой список в одном не означает потерю другого.

`wrangler.local.jsonc` имеет `LOCAL_DEV:true` как JSON boolean, HTTP origin и отключённые события. Он генерируется и игнорируется Git. **Никогда не использовать этот файл с `deploy`.**

## 7. Развернуть и проверить HTTP

```bash
npm run verify
npx wrangler@4 deploy --dry-run
npx wrangler@4 deploy
curl -i https://growkeeper.REAL_SUBDOMAIN.workers.dev/healthz
curl -i https://growkeeper.REAL_SUBDOMAIN.workers.dev/.well-known/oauth-protected-resource
curl -i https://growkeeper.REAL_SUBDOMAIN.workers.dev/.well-known/oauth-authorization-server
```

`/healthz` должен дать `ok:true`; это проверка загрузки Worker, а **не** глубокая проверка D1/R2. Открыть `/login`, войти ключом пользователя, создать тестовое растение, загрузить фото, подтвердить привязку, увидеть фото после перезагрузки. В другом браузере под другим пользователем записи не должны быть видны.

Проверить `PUBLIC_ORIGIN`: неверное значение даёт `421 HOST_MISMATCH`. Для окончательного собственного домена заранее настроить route/домен и обновить origin в обоих конфигурационных файлах. Смена origin требует переподключения OAuth.

## 8. Подключить ChatGPT

В актуальной документации OpenAI путь авторского подключения: Developer mode, раздел Plugins, новое MCP-подключение. Конкретная доступность зависит от клиента и аккаунта; ориентироваться на официальную страницу Packaging/Auth из `docs/SOURCES.md`.

Параметры этого сервера:

```text
MCP URL:               https://YOUR_REAL_ORIGIN/mcp
Transport:             Streamable HTTP
Authentication:        OAuth
Client ID:             growkeeper-chatgpt
Client secret:         отсутствует (public client)
Token endpoint auth:   none
Scope:                 growkeeper
Resource/audience:     https://YOUR_REAL_ORIGIN/mcp
PKCE:                  S256
```

Сервер поддерживает **предварительно заданный client ID**, не Dynamic Client Registration и не CIMD. Выбрать соответствующий режим подключения. Если клиент требует иной ID или callback, сначала изменить серверную конфигурацию/код и повторить тесты; не ослаблять проверки wildcard-ами.

По умолчанию разрешён callback:

```text
https://chatgpt.com/connector_platform_oauth_redirect
```

Реальный callback сравнивается точно с `OAUTH_REDIRECT_URIS` (comma-separated). Сохранять проверку PKCE, resource и issuer. Не разрешать произвольный пользовательский redirect.

После подключения rescan tools/resources/skills. Portable package находится в **`plugin/`**, а не в корне всего репозитория. `mcp.json` уже настроен скриптом. Если выбранный локальный marketplace требует `.app.json` с зарегистрированным `plugin_asdk_app...`, получить настоящий ID созданного подключения и выполнить wiring через штатный Plugin Creator. В архиве нет выдуманного ID и регистрации, которые могли бы работать в чужом аккаунте.

Загрузить Skill `growkeeper`: сервер предоставляет его через `skills/list/get` и resource, а пакет — в `plugin/skills/growkeeper/SKILL.md`. После правок Skill выполнить build, deploy и rescan. Установка одной папки в произвольный интерфейс ChatGPT не заменяет регистрацию HTTPS-сервера и OAuth.

### Приёмка в реальном чате

Проверить в отдельном тестовом выращивании:

1. Новое фото → предлагается имя → объект создан → оригинал сохранился.
2. Второе растение не попадает в историю первого; неоднозначное фото остаётся неразобранным.
3. Модель реально вызывает `get_photo_images` для нового и старого снимков. Метаданные сами по себе не считаются сравнением.
4. Уверенная привязка сопровождается именем; снижение score или противоречие требует уточнения даже при одном существующем plant.
5. Ссылка `I/H/E + название` открывает защищённую карточку; виджет открывается через `open_growkeeper`.
6. Предложенная смена условий остаётся PLANNED до сообщения пользователя о выполнении.
7. Закрытие с исходом UNKNOWN создаёт дневник с отсутствием данных, а не фальшивым «лечение не помогло».

Встроенный UI использует `window.openai.callTool`. Если bridge или загрузка из виджета недоступны, использовать прикрепление в чат либо standalone веб-страницу. Загрузку из сообщения обеспечивает объявленный `openai/fileParams`; реальные host download URL не генерировать вручную.

Если `FILE_HOST_NOT_ALLOWED`: проверить **реальный** домен download URL, выданного хостом, добавить только доверенный точный hostname в `FILE_DOWNLOAD_HOSTS`, затем deploy. Не добавлять `*`, IP, localhost или произвольные домены пользователя. Redirects намеренно заблокированы.

## 9. Инициативные сообщения: отдельная активация

**Запись followup в D1 и запуск Cron сами по себе не пишут человеку в ChatGPT.** Нужна разрешённая пользователем подписка хоста или действительно поддерживаемый хостом polling monitor.

### Основной реализованный путь — MCP Events

Протокол `2026-07-28`, событие `growkeeper.followup_due`. В архиве код реализован и протестирован с mock callback, но production delivery не проверена.

1. Убедиться в поддержке MCP Events выбранным аккаунтом/клиентом ChatGPT.
2. Установить `EVENT_WEBHOOK_HOSTS` в точный доверенный публичный hostname callback OpenAI. Начальное значение `chatgpt.com` — allowlist, **не гарантия**, что фактический callback будет на этом домене. Не записывать весь callback URL или secret в публичные логи.
3. Установить `EVENTS_ENABLED: "true"` в production vars, deploy и rescan. Cron уже объявлен каждые 15 минут; точная доставка в заданную минуту не обещается.
4. В новом чате явно попросить: «Подпишись на проверки GrowKeeper. Когда пора наблюдать растение, попроси нужные фото кратким сообщением». Хост должен вызвать `events/subscribe`; это не обычный tool вручную от модели.
5. Сервер проверит подписанный challenge/echo и сохранит одну подписку пользователя. В D1 signing secret зашифрован APP_SECRET.
6. Создать тестовый followup со сроком в ближайшем прошлом. Дождаться Cron. Проверить `2xx` от callback **и отдельно** фактическое сообщение в чате. `NOTIFIED` означает принятие callback, а не прочтение пользователем.
7. Ответить фото: оно должно использовать конкретный plant/followup, а статус стать DONE после обработки. Само уведомление не завершает проверку.
8. Остановить мониторинг в ChatGPT. Проверить `events/unsubscribe`, отсутствие дальнейших доставок, повторную подписку, refresh и отзыв OAuth.

Подписка выдаётся не более чем на 7 дней (`refreshBefore`); хост должен обновлять её. При отключении аккаунта доставка прекращается. Ошибки повторяются с backoff, максимум 8 попыток, затем проверка остаётся видимой в PENDING с `last_error`; `410`/`413` удаляют подписку. Идентификатор события стабилен при повторе. При ротации signing secret 2 минуты выдаются две подписи.

**Ограничение безопасности:** callback-отправитель рассчитан только на точную allowlist доверенных доменов провайдера. Он не реализует независимую DNS/IP pinning для произвольных чужих URL. Не открывать callback произвольным клиентам; см. `docs/SECURITY.md`.

### Альтернативный host polling

Только если ваш клиент действительно позволяет его настроить и проверка прошла: один opted-in monitor периодически читает `get_due_followups`, делает `claim_followup`, отправляет сообщение, затем `ack_followup`. Не включать одновременно с native events. Этот архив не создаёт ChatGPT Scheduled Task сам и не гарантирует доступность такого сценария на любом тарифе/клиенте.

## 10. Ежедневная эксплуатация и поиск проблем

```bash
npx wrangler@4 tail
npx wrangler@4 d1 execute growkeeper --remote --command \
  "SELECT id,status,due_at,attempts,last_error FROM followups WHERE status IN ('PENDING','NOTIFIED') ORDER BY due_at LIMIT 30;"
```

Просмотр SQL — только у владельца сервера. Не копировать результаты с данными пользователей в публичные отчёты.

| Симптом | Действие |
|---|---|
| `401` | Проверить вход/OAuth, истечение, active user. Не добавлять access token в URL. |
| `403 ORIGIN` | Проверить canonical origin, не отключать CSRF. |
| `409 CONFLICT` | Перечитать сущность и version, согласовать изменение, повторить. |
| `IDEMPOTENCY_CONFLICT` | Тот же UUID использован с другим содержимым. Создать новый UUID или выполнять update. |
| `PLANT_UNRESOLVED` | Уточнить субъект исходного input; не угадывать растение. |
| `DERIVED_DATA_EXISTS` | К ошибочной привязке уже относятся наблюдения; нужен осознанный repair, а не перенос только фото. |
| `OBJECT_MISSING` | Сверить R2 и D1, восстановить оригинал из backup; описания не заменяют фото. |
| `IMAGE_BUDGET` | Запросить меньше кадров; 16 MiB суммарно за вызов и до 4 фото. |
| Не приходит напоминание | Проверить EVENTS_ENABLED, подписку, expiry, due_at, backoff, callback и сообщение в чате по отдельности. |
| Удаление зависло | Найти plant с deleting=1, исправить доступ к R2, повторить delete_plant с точным именем. |

Если после восьми неудач доставка поставлена на паузу, сначала устранить причину и проверить/пересоздать подписку, затем через `update_followup` задать новый due_at со свежим expected_version. Не считать PENDING провалом агрономического эксперимента.

**Ошибочная привязка:** пока observations ещё не созданы, есть `correct_input`. После появления производных данных backend специально запрещает тихое перемещение. Для частного MVP исправлять с backup: перечислить все зависимые observations/hypotheses/experiments/journal, согласовать с владельцем, выполнить отдельную проверенную repair-миграцию в копии базы и затем в рабочей базе. Универсального «перетащить всё» инструмента нет. Простой update photos.plant_id разрушит доказательную историю и блокируется.

## 11. Backup, восстановление, обновления

```bash
mkdir -p backups
npx wrangler@4 d1 export growkeeper --remote --output backups/growkeeper-YYYY-MM-DD.sql
```

SQL содержит персональные записи, хеши ключей и зашифрованные секреты — хранить приватно. **D1 backup не содержит R2-фото.** Отдельно копировать приватный bucket собственным доверенным S3/R2 backup-процессом; сохранить соответствие `photos.r2_key`. Независимый `APP_SECRET` хранить в менеджере секретов: без него нельзя расшифровать текущие callback secrets.

Восстановление проверять в другом D1/bucket: schema + данные + R2 objects + соответствующий APP_SECRET, затем тест двух пользователей, чтение старого фото, journal links. Отключить EVENTS_ENABLED в восстановленной копии, чтобы не отправить повторные напоминания.

При обновлении: backup → verify → новые миграции в preview → dry-run → deploy → smoke → rescan при изменении API/Skill. Откат Worker не откатывает автоматически D1. Для несовместимой миграции нужен заранее проверенный restore/forward-fix, а не произвольное применение старого SQL.

## 12. Отзыв и ротация

При компрометации пользователя: выставить `users.active=0`, удалить его `auth_sessions`, `oauth_codes`, `subscriptions` и выдать новый ключ только после расследования. Клиентский `/oauth/revoke` отзывает соответствующую сессию и монитор пользователя. Выход из standalone UI сам по себе не означает отзыв независимого OAuth-подключения.

Ротация APP_SECRET инвалидирует старые signed media URLs и мешает расшифровать существующие subscriptions. Отключить события, удалить/пересоздать подписки после смены секрета и снова проверить challenge/delivery. Не ротировать APP_SECRET незаметно для мониторинга.

Неиспользуемые просроченные OAuth codes/sessions можно периодически удалить SQL по expires_at; это не затрагивает journal. Неразобранные inputs/photos не удаляются автоматически: сначала показать владельцу и получить согласие. Частное хранение имеет пределы и стоимость — контролировать объём R2, D1 и число просроченных запросов.

## 13. Definition of deployment done

Локальный `verify` недостаточен. Отметить вручную:

- [ ] workerd preview и Cloudflare dry-run прошли;
- [ ] приватный R2, миграции, секреты и два раздельных пользователя проверены;
- [ ] реальный OAuth connect/refresh/revoke работает;
- [ ] Skill/Tools видны после rescan;
- [ ] реальное фото из чата сохраняется, старое фото возвращается модели;
- [ ] HTTPS entity links и встроенный UI проверены в целевом клиенте;
- [ ] принудительное и успешное закрытие дают корректный journal;
- [ ] events subscribe/refresh/delivery/unsubscribe проверены в реальном чате;
- [ ] backup и восстановление одного фото проверены.

До этой приёмки не обещать пользователям автономные уведомления и production-ready сервис.
