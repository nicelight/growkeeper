# Проверки GrowKeeper 0.2.0

## Выполнено в среде подготовки

**63 автоматических теста**: Node.js 22.16.0 / SQLite 3.49.1 через `node:sqlite`, настоящие SQL constraints/transactions, production Worker/domain/auth/MCP modules. R2 и исходящие callbacks — локальные test adapters. Это не workerd и не облачная D1.

**10 browser/UI проверок**: Chromium, Python Playwright, настоящий собранный widget HTML/CSS/JS, offline iframe и имитация window.openai. Данные сценария сформированы настоящими domain handlers на SQLite; host bridge подставлен. Проверены две карточки растений, настройки, case, гипотеза, journal, сравнение фото, пустые очереди, mobile layout 390px и отсутствие unhandled JS errors.

Прямая browser-навигация к локальному HTTP была заблокирована политикой среды (`ERR_BLOCKED_BY_ADMINISTRATOR`). Ограничение не обходилось. Поэтому screenshot-тесты **не** означают пройденный browser end-to-end login/API test и **не** являются снимками реального ChatGPT. `scripts/browser-live.py` оставлен для отдельного локального запуска в подходящей среде; использует только локальный тестовый сервер и может удалять локальные тестовые растения.

## Покрытые риски

| Область | Проверки |
|---|---|
| Доступ | Два пользователя, чужие UUID, подмена user_id, auth/cookies, Origin/CSRF, entity-page redirects |
| Identity | Pending text/photo, отсутствие auto-bind при одном plant, threshold, conflicting signals, отсутствие trusted refs |
| Фото | Реальные bytes в MCP image content, неизвестная capture date, форматы/размер, signed URL, временной/визуальный подбор |
| Повторы | UUID retry, conflicting content, одновременная загрузка разных bytes без перезаписи winning R2 object |
| Связи | Запрет cross-plant observations/photo refs, защита привязки после производных данных |
| Эксперименты | PLANNED до подтверждения, start time, один ACTIVE, терминальные переходы |
| Journal | Атомарное закрытие, rollback при ошибке INSERT, concurrent close, unique outcome, stale case, UNKNOWN vs failure |
| Время | Time-to-result отдельно от time-to-close; даты с timezone |
| Уведомления | Read не ack, lease, NOTIFIED не DONE, signed challenge, retry/backoff/stable event ID, 410 stop |
| Подписки | Владелец, expiry, inactive user, одна подписка, secret rotation и bounded dual-sign window |
| OAuth | PKCE, replay, resource/client, exact redirect, deny/issuer, refresh rotation, revoke |
| MCP | Legacy initialize, modern discover/meta/headers, malformed JSON, tools/schema annotations, actual image content, Skill digest |
| Удаление | Exact-name confirmation, D1 cascade + R2, failed-delete tombstone и возобновление |

## Команды

```bash
npm run verify
python3 scripts/browser-smoke.py
```

Первая команда не скачивает зависимости. Для второй нужны установленный Python Playwright и Chromium; путь можно передать `CHROMIUM=/path/to/chromium`. UI test специально не делает сетевых запросов.

```bash
# Только в отдельном локальном тестовом окружении с npm run dev:
python3 scripts/browser-live.py
```

Последний сценарий **не засчитывается** как выполненный в этом архиве. Не направлять его на production, не использовать с ценными локальными данными.

## Артефакты

- `reports/automated-tests.tap` — фактический вывод последнего полного тестового запуска.
- `reports/browser-smoke.json` — подробные 10 UI assertions и режим исполнения.
- `reports/ui-*.png` — offline widget с fixture-данными; не production screenshots.
- `docs/tools.schema.json` — каталог schemas, сформированный из кода.
- `npm run check` — JS syntax, config consistency, manifest, unique tools и базовая структура Mermaid sources. **Не полноценный Mermaid renderer или protocol certification.**

## Не проверено и должно входить в deployment acceptance

Cloudflare account/Workers runtime/реальная D1/R2, Wrangler dry-run и лимиты CPU/memory; реальный OAuth flow в ChatGPT; attachment URL domains и import; Skills discovery конкретного клиента; встроенный host bridge и переход по entity link; native event subscribe/refresh/delivery/unsubscribe; точность распознавания растений и многофакторная динамика болезни; нагрузка, большие фото, browser login/API E2E и security audit.

Интеграционные mock-тесты доказывают корректность механики для проверенных сценариев, но не работоспособность всех внешних сервисов. Детальный checklist — в конце `RUNBOOK.md`.
