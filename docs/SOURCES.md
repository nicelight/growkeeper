# Внешние контракты и источники

Сверено при подготовке: **30 сентября 2026**. Собственные архитектурные решения описаны отдельно; ссылки ниже не означают сертификацию проекта или успешный live test. Документация хоста может меняться: после изменения контракта обновить adapter и contract tests.

## OpenAI

- Portable plugin package, root plugin.json и mcp.json: https://developers.openai.com/plugins/build/plugins
- Server, tools/resources/skills: https://developers.openai.com/plugins/build/mcp-server
- Authentication, fixed clients, PKCE/resource/redirect: https://developers.openai.com/plugins/build/auth
- MCP Events, webhook verification/signatures/subscribe/unsubscribe: https://developers.openai.com/plugins/build/mcp-events
- MCP UI / ChatGPT host integration: https://developers.openai.com/plugins/build/chatgpt-ui
- Tool metadata, file parameters и window.openai: https://developers.openai.com/plugins/reference

## MCP / package format

- MCP 2026-07-28: https://modelcontextprotocol.io/specification/2026-07-28/basic/index
- Streamable HTTP: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- Server discovery: https://modelcontextprotocol.io/specification/2026-07-28/server/discover
- Agent Plugins schemas: https://agent-plugins.org/schemas/1.0.0/plugin.schema.json и https://agent-plugins.org/schemas/1.0.0/mcp.schema.json

## Cloudflare

- D1 command syntax (create, execute, migrate, export): https://developers.cloudflare.com/d1/wrangler-commands/
- D1 database/batch: https://developers.cloudflare.com/d1/worker-api/d1-database/
- Worker-first static assets: https://developers.cloudflare.com/workers/static-assets/routing/worker-script/
- R2 bucket creation: https://developers.cloudflare.com/r2/buckets/create-buckets/

Реализация использует отдельное ограниченное подмножество протокола, консервативную host allowlist и приватные аккаунты. Универсальный SSRF-safe callback framework, Dynamic Client Registration, generic UI bridge и полный SDK conformance не заявлены.
