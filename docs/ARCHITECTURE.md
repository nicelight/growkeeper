# Архитектура GrowKeeper

## Потоки и ответственность

ChatGPT + Skill выбирает plant, рассматривает изображения, формулирует гипотезу и следующий вопрос. Backend не вызывает model API и не «думает» самостоятельно при HTTP upload. Он предоставляет факты/пиксели, проверяет владельца, отношения и переходы, сохраняет результат.

Worker обслуживает `/mcp`, OAuth, web API, защищённые страницы и медиа. MCP и web используют `src/tools.js` и `src/domain.js`, поэтому UI не обходит бизнес-правила. Небольшой ручной MCP adapter реализует только заявленную синхронную часть протокола; это не полный SDK и не claim conformance certification.

## Модули

| Модуль | Ответственность |
|---|---|
| `worker.js` | HTTP routing, auth boundary, common security headers, Cron entry |
| `auth.js` | Private accounts, browser session, OAuth PKCE/discovery/refresh/revoke |
| `mcp.js` | JSON-RPC transport, server discovery, tools/resources/skills/events |
| `tools.js` | Один каталог схем и адаптеров, tool annotations, output format |
| `schema.js` | Только поддерживаемое подмножество JSON Schema для своих схем |
| `domain.js` | Plants, resolution, observations, cases, experiments, followups, journal |
| `db.js` | Tenant-scoped SQL helper, entity links, retry и version guards |
| `media.js` | Archive/import, image bytes, metadata, comparison selection, signed URLs |
| `events.js` | Optional subscription, verification, Standard Webhooks signatures, retries |
| `lib.js` | Small crypto/time/request validation helpers |
| `public/app.js` | Одна UI-логика для browser API и window.openai bridge |

## KISS: что оставлено и что сознательно отсутствует

Нет service mesh, queues, Durable Objects, KV, LangGraph, React и внешнего AI job runner. Webhooks отправляет сам scheduled Worker; durable lease хранится на followup. Повторный запуск безопаснее обеспечивать одной условной SQL-записью, чем строить отдельную систему событий.

`inputs` оправдана: pending текст тоже нужно хранить после уточнения. `journal_entries` оправдана: результат имеет собственную долгосрочную ценность. `subscriptions` оправдана только для opted-in доставки: это callback identity/expiry, не agent runtime.

Свой MCP adapter экономит dependencies, но увеличивает ответственность за transport compatibility. Его область ограничена и покрыта contract tests; перед публичным выпуском стоит сравнить фактическое число исключений с официальным SDK и заменить adapter, если сопровождение станет дороже зависимости. Это осознанный tradeoff, не заявление, что самописный протокол всегда проще.

## Данные

- `user_id` получается из auth и проверяется при каждом чтении/записи. Нельзя выбрать владельца аргументом инструмента.
- Составные внешние ключи фиксируют одинакового user/plant/issue у дочерних записей.
- UUID — identity и idempotency key для создания. Короткие I/H/E/O/F/J коды вычисляются из SQL seq. Seq глобален для таблицы, а не отдельный счётчик пользователя; коды могут иметь пропуски. Это не секрет и не средство доступа.
- Редактируемые сущности имеют version; stale update возвращает 409.
- Issue.version увеличивается при новых связанных наблюдениях и изменении гипотез/экспериментов, чтобы закрытие не перетёрло новый факт.
- Последнее состояние case ограничено по размеру. `truncated` и `list_records` дают продолжение; ограниченный контекст нельзя трактовать как полную историю.
- Нет отдельного Timeline table. Страницы списков показывают даты сущностей; полноценная объединённая timeline UI пока не реализована.

## Привязка и фото

Файл сохраняется в R2 до подтверждения plant, metadata — в D1 с input. У visual resolution обязателен подтверждённый эталон: auto-guess не делает фото новым trusted reference. Сходство вида растения само по себе не identity.

Оригинал неизменяем, object key включает UUID и SHA-256. При совпадении id с другими байтами — конфликт, а не перезапись. Единой транзакции R2+D1 не существует: losing object удаляется компенсацией; авария между сервисами может оставить orphan. Загрузка и удаление поэтому идемпотентны; политика backup/сверки описана в runbook.

При неизвестном времени съёмки captured_at=NULL; received_at не выдаётся за дату съёмки. Подбор по COALESCE используется лишь как эвристический порядок с предупреждением. Фильтры view/area консервативны: лучше попросить сравнимый кадр, чем делать вид, что пятно исчезло за пределами кадра.

## Journal и закрытие

`close_issue` не делает отдельный LLM-вызов. Он принимает сформулированный итог и evidence refs, собирает детерминированную запись из записанных попыток, гипотез и дат. Не выполненные планы явно отделены от начатых экспериментов. Детали остаются в кейсе.

Одна D1 batch-транзакция закрывает Issue, пишет unique journal outcome, отменяет незаконченные действия. Все последующие statements привязаны к winning closure key. Повтор того же request возвращает предыдущий итог; другой request не создаёт второй. Недостаток данных не маркируется NO_IMPROVEMENT.

## Удаление

Plant получает deleting=1. SQL guards не дают добавлять данные, API/медиа перестают его отдавать. Затем идемпотентно удаляются объекты R2; только после успеха выполняется D1 cascade. При сбое tombstone и object keys остаются для повтора. Неразобранные фото не относятся к удаляемому plant и не удаляются с ним.

## Проактивность

Followup — намерение наблюдать, subscription — разрешённый путь доставки. Cron выбирает due items, получает lease и отправляет подписанный webhook. Повтор имеет прежний eventId и свежую подпись. 2xx означает приём webhook; статус NOTIFIED не доказывает, что человек увидел сообщение. Реальный ответ превращает его в DONE.

Ни UI, ни create_followup не подписывают пользователя самостоятельно. Нативные события выключены по умолчанию, пока callback и host не проверены. Одна подписка на пользователя снижает дублирование; параллельный polling запрещён эксплуатационным правилом Skill/runbook.

## Limits и observability

10 MiB/photo, 4 photos/request, суммарно 16 MiB до base64, максимум 20 due deliveries за Cron. Нет decode/resize/antivirus; magic-byte check — не проверка целостности всех пикселей. Пользователь может запросить меньше кадров при host limits. Performance/load test не выполнен.

Ошибки содержат стабильный code и request_id. Логи не включают photo bytes, access tokens, callback secrets и полные tool arguments. Это минимальная диагностика, не audit history. Для приватного пилота достаточно; для публичного сервиса нужны отдельные abuse/rate/storage controls и security review.
