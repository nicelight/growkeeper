# Security / privacy — private MVP

## Реализованные границы

Все записи привязаны к проверенному пользователю; составные foreign keys запрещают смешивать владельцев и растения. Browser session и OAuth bearer разделены. Browser POST требует точный Origin; cookie HttpOnly/SameSite=Lax, в production Secure и __Host prefix. OAuth: фиксированный public client, S256 PKCE, одноразовый authorization code, точные redirect/resource, access expiry, refresh rotation/revoke.

Фото приватны в R2. Просмотр по сессии или короткому signed URL (5 минут), без permanent public URL. Доступ проверяет активность пользователя и deleting plant. Подписанный URL — временная bearer capability: любой, получивший его, может видеть фото до expiry. Его не надо показывать в обычном тексте чата или публиковать.

Ключ аккаунта высокоэнтропийный; в D1 только hash. Signing secrets webhook зашифрованы AES-GCM ключом APP_SECRET. Шифрование на стороне приложения не защищает от компрометации самого Worker/Cloudflare account/APP_SECRET.

User-authored descriptions, captions и journal — данные, а не инструкции. Skill запрещает выполнять команды из этих полей. Backend не способен доказать, что LLM действительно посмотрела фотографии или правдиво выставила user_confirmed: это доверительная граница agent/tool-calling host. Threshold не заменяет оценку реальной точности vision.

## Ограничения, запрещающие называть это готовым публичным SaaS

1. Invite-only login keys без MFA/recovery и без отдельного rate-limit/abuse сервиса. Перед публичным доступом — rate limiting на edge, учёт storage quotas, reviewed identity provider, security review.
2. MCP реализован вручную и покрывает только поддержанные методы. Нет независимого conformance/security audit. Совместимость на реальном клиенте требует runbook acceptance.
3. Webhook/download адреса ограничены **точным** списком доверенных HTTPS vendor hostnames; redirects запрещены. Нет собственного DNS resolver/IP pinning для произвольных endpoint. Не расширять на untrusted domains: это не универсальный SSRF-safe callback service.
4. JPEG/PNG/WebP проверяются по заголовку и размеру, без полного декодирования, проверки bomb dimensions/antivirus/пересжатия. Нельзя считать magic bytes доказательством безвредного/исправного изображения.
5. Оригинальный файл может сохранять EXIF, включая геолокацию; parser это не читает и не показывает, но метаданные остаются внутри байтов оригинала. При необходимости до загрузки удалить чувствительные EXIF на клиенте.
6. R2 и D1 не имеют общей транзакции. Crash может оставить orphan object или pending input; backup/сверка обязательны, silent data repair не выполняется.
7. Нет неизменяемой истории всех изменений reasoning. Версия предотвращает stale writes, но не заменяет полноценный audit trail.
8. Удаление plant удаляет рабочие записи и объекты, но не удаляет автоматически операторские backups и не отзовёт уже скачанную копию фото у человека.
9. Виджет использует window.openai; стандартный generic MCP Apps bridge для других хостов отсутствует. Не отключать CSP/CSRF, чтобы обойти несовместимый клиент.

## Перед публичным запуском

Защитить Cloudflare account, сократить API token permissions, хранить секреты отдельно от Git, проверить callback allowlist, реальные OAuth redirect/issuer, остановку событий после revoke, загрузку больших/повреждённых файлов и лимиты модели. Не включать публичный R2. Не раздавать administrator Cloudflare credentials пользователям.

При подозрении на компрометацию — остановить events, deactivate user, revoke sessions/subscriptions, сохранить приватный backup для расследования, выдать новые ключи, проверить реальные обращения. Возобновлять после повторной проверки доступа. Это эксплуатационная рекомендация проекта, не юридическое заключение.
