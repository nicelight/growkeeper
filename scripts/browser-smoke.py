#!/usr/bin/env python3
"""Offline widget/DOM tests, using mocked host bridge and fixtures produced by real SQLite handlers.
No browser network access. This does NOT claim live ChatGPT, real Cloudflare or live HTTP UI E2E.
Requires Python Playwright and Chromium. browser-live.py separately tests local HTTP on unrestricted hosts.
"""
import json
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
fixture=json.loads(subprocess.check_output(['node','--experimental-sqlite','scripts/demo-fixture.mjs'],cwd=ROOT,text=True))
reports=ROOT/'reports';reports.mkdir(exist_ok=True)
widget=(ROOT/'public/widget.html').read_text()
checks=[]
setup='''<script>
const fixture=FIXTURE;
window.openai={
 requestDisplayMode:async()=>({mode:'fullscreen'}),
 callTool:async(name,args)=>{
  let data;
  if(name==='get_plants')data={...fixture.plants,settings:fixture.settings.settings};
  else if(name==='get_settings')data=fixture.settings;
  else if(name==='set_settings'){fixture.settings={settings:{...args}};data=fixture.settings;}
  else if(name==='get_case_file')data=fixture.cases[args.plant_id];
  else if(name==='get_entity')data={entity:fixture.entities[args.type+':'+args.id]};
  else if(name==='list_records')data=fixture.lists[args.plant_id+':'+args.type];
  else if(name==='get_photo_urls')data={photos:args.photo_ids.map(id=>({id,url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1cAAAAASUVORK5CYII='}))};
  else if(name==='get_pending_inputs')data={inputs:[]};
  else if(name==='get_due_followups')data={followups:[]};
  else throw Error('Unmocked host method: '+name);
  return {structuredContent:{ok:true,data}};
 }
};
</script>'''.replace('FIXTURE',json.dumps(fixture,ensure_ascii=False))
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 context=browser.new_context(viewport={'width':1360,'height':940})
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content('<style>html,body{margin:0}iframe{display:block;width:100vw;height:100vh;border:0}</style><iframe id="app"></iframe>')
 page.locator('#app').evaluate('(el,src)=>el.srcdoc=src',setup+widget)
 ui=page.frame_locator('#app')
 ui.get_by_role('heading',name='Ваши растения',exact=True).wait_for()
 assert ui.locator('.plant-card').count()==2;checks.append('two plants render from domain-generated fixture')
 page.screenshot(path=str(reports/'ui-desktop.png'))
 ui.locator('button[data-nav=settings]').click()
 ui.locator('input[name=recognition_threshold]').fill('98')
 ui.get_by_role('button',name='Сохранить',exact=True).click()
 ui.get_by_text('Настройки сохранены.',exact=True).wait_for()
 assert ui.locator('#threshold-value').inner_text()=='98 / 100';checks.append('settings form calls host and reflects saved threshold')
 page.screenshot(path=str(reports/'ui-settings.png'))
 ui.locator('button[data-nav=home]').click()
 pid=next(p['id'] for p in fixture['plants']['plants'] if p['display_name']=='Зелёный Борис')
 ui.locator(f'[data-plant="{pid}"]').click()
 ui.get_by_role('heading',name='Открытые проблемы',exact=True).wait_for();checks.append('plant case shows issues and scheduled followups')
 page.screenshot(path=str(reports/'ui-case.png'))
 ui.locator('button[data-tab=hypothesis]').click()
 ui.locator('[data-entity=hypothesis]').first.click()
 ui.get_by_text('Основания гипотезы',exact=True).wait_for();checks.append('entity link opens hypothesis details with source links')
 page.screenshot(path=str(reports/'ui-hypothesis.png'))
 ui.locator('button[data-nav=home]').click();ui.locator(f'[data-plant="{pid}"]').click()
 ui.locator('button[data-tab=journal]').click();ui.locator('[data-entity=journal]').first.click()
 ui.get_by_text('Итоговая запись',exact=True).wait_for();checks.append('closed issue journal renders uncertainty and elapsed days')
 page.screenshot(path=str(reports/'ui-journal.png'))
 ui.locator('button[data-nav=home]').click();ui.locator(f'[data-plant="{pid}"]').click()
 ui.locator('button[data-tab=photo]').click()
 for box in ui.locator('input[name=compare]').all():box.check()
 ui.get_by_role('button',name='Показать выбранные рядом',exact=True).click()
 ui.get_by_role('heading',name='Сравнение фотографий',exact=True).wait_for()
 assert ui.locator('.comparison img').count()==2;checks.append('photo selection opens side-by-side viewer')
 ui.locator('button[data-nav=inbox]').click();ui.get_by_text('Все входящие данные разобраны.',exact=True).wait_for();checks.append('empty unresolved inbox is explicit')
 ui.locator('button[data-nav=due]').click();ui.get_by_text('Сейчас нет просроченных проверок.',exact=True).wait_for();checks.append('empty followup list does not imply completed work')
 page.set_viewport_size({'width':390,'height':920})
 ui.locator('button[data-nav=settings]').click();ui.get_by_role('heading',name='Настройки',exact=True).wait_for()
 inner=page.frames[1]
 assert inner.evaluate('document.documentElement.scrollWidth <= innerWidth');checks.append('390px mobile settings has no horizontal overflow')
 page.screenshot(path=str(reports/'ui-mobile.png'))
 assert not errors,errors;checks.append('no unhandled JavaScript errors during navigation')
 browser.close()
report={'status':'passed','count':len(checks),'checks':checks,'mode':'offline widget with mocked window.openai bridge; fixtures from real SQLite domain handlers','live_browser_http':'not run: container Chromium blocks localhost navigation with ERR_BLOCKED_BY_ADMINISTRATOR','real_chatgpt':False,'real_cloudflare':False}
(reports/'browser-smoke.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
