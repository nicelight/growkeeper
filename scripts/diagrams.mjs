import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url),dir=new URL('docs/diagrams/',root);
const names=(await fs.readdir(dir)).filter(x=>x.endsWith('.mmd')).sort();
let md='# GrowKeeper — схемы реализации\n\nИсходники находятся в `docs/diagrams/*.mmd`. Генерация этого документа: `npm run diagrams`. Проверка структуры выполняется в `npm run check`; полноценный Mermaid renderer в этой сборочной среде не запускался.\n\n';
for(const name of names){const text=await fs.readFile(new URL(name,dir),'utf8');md+=`## ${name.replace(/\.mmd$/,'')}\n\n\`\`\`mermaid\n${text.trim()}\n\`\`\`\n\n`;}
await fs.writeFile(new URL('docs/DIAGRAMS.md',root),md);console.log(`Assembled ${names.length} Mermaid sources.`);
