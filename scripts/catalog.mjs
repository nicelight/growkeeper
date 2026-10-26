import fs from 'node:fs/promises';
import {toolDefinitions} from '../src/tools.js';
const defs=toolDefinitions();await fs.writeFile(new URL('../docs/tools.schema.json',import.meta.url),JSON.stringify(defs,null,2)+'\n');
let md='# Каталог MCP / Web API\n\nОба транспорта используют `src/tools.js`. Ниже точные имена; полные аргументы и аннотации в `tools.schema.json`. Сервер берёт пользователя из проверенной сессии, а не из аргументов инструмента.\n\n| Tool | Режим | Назначение |\n|---|---|---|\n';
for(const t of defs)md+=`| \`${t.name}\` | ${t.annotations.readOnlyHint?'read':'write'}${t._meta.ui.visibility.join(',')==='app'?' / UI':''} | ${t.description.replaceAll('|','/')} |\n`;
md+='\n## Ответ\n\n`structuredContent = {ok:true,data:{...}}`; при ошибке — `{ok:false,error:{code,message,request_id?}}`, MCP `isError:true`. Фотографии дополнительно возвращаются как `content: image` с реальными байтами. Только `open_growkeeper` привязывает render resource.\n\n## Web API\n\n`POST /api/tools/<name>`: те же аргументы, JSON, browser session cookie и точный Origin. `POST /api/upload?id=<UUID>&caption=...`: binary JPEG/PNG/WebP. API не принимает `user_id` клиента и не использует OAuth bearer вместо cookie. MCP по `/mcp`, напротив, требует bearer OAuth.\n';
await fs.writeFile(new URL('../docs/API.md',import.meta.url),md);console.log(`Exported ${defs.length} tool definitions.`);
