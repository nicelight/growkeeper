#!/usr/bin/env python3
"""Optional UI smoke test. Requires Python Playwright + Chromium and npm run dev.
Runs against LOCAL test data only; never run it against a production origin.
"""
import base64
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:8787'
KEY = json.loads((ROOT / '.local/dev-secrets.json').read_text())['owner_key']
REPORTS = ROOT / 'reports'
REPORTS.mkdir(exist_ok=True)
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1cAAAAASUVORK5CYII=')
checks = []

def check(name, value):
    assert value, name
    checks.append(name)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1360, 'height': 900})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE)
    page.locator('input[name=key]').fill(KEY)
    page.get_by_role('button', name='Войти', exact=True).click()
    page.get_by_role('heading', name='Ваши растения', exact=True).wait_for()
    check('browser login and protected home', True)

    def api(name, data=None):
        r = context.request.post(BASE + '/api/tools/' + name, data=json.dumps(data or {}), headers={'Origin': BASE, 'Content-Type': 'application/json'})
        payload = r.json()
        assert payload.get('ok'), payload
        return payload['data']

    for plant in api('get_plants')['plants']:
        api('delete_plant', {'plant_id': plant['id'], 'confirm_name': plant['display_name']})
    page.get_by_role('button', name='Обновить', exact=True).click()
    page.get_by_role('button', name='Новое растение', exact=True).wait_for()
    for name, profile in [('Зелёный Борис', 'Томат у окна. Общий вид и нижние листья.'), ('Огуречный профсоюз', 'Грядка огурцов. Проверки без лишней суеты.')]:
        page.get_by_role('button', name='Новое растение', exact=True).click()
        page.locator('input[name=display_name]').fill(name)
        page.locator('textarea[name=profile]').fill(profile)
        page.get_by_role('button', name='Создать', exact=True).click()
        page.get_by_role('heading', name=name, exact=True).wait_for()
        page.locator('button[data-nav=home]').click()
        page.get_by_role('heading', name='Ваши растения', exact=True).wait_for()
    check('create two plants through web forms', len(api('get_plants')['plants']) == 2)
    page.screenshot(path=str(REPORTS / 'ui-desktop.png'), full_page=True)

    page.locator('button[data-nav=settings]').click()
    slider = page.locator('input[name=recognition_threshold]')
    slider.fill('98')
    page.locator('input[name=timezone]').fill('Asia/Dushanbe')
    page.get_by_role('button', name='Сохранить', exact=True).click()
    page.get_by_text('Настройки сохранены.', exact=True).wait_for()
    check('threshold settings persisted through browser', api('get_settings')['settings']['recognition_threshold'] == .98)
    page.screenshot(path=str(REPORTS / 'ui-settings.png'), full_page=True)

    pid = api('get_plants')['plants'][0]['id']
    for _ in range(2):
        page.locator('button[data-nav=home]').click()
        page.get_by_role('button', name='Добавить фото', exact=True).click()
        page.locator('input[type=file]').set_input_files({'name': 'fixture.png', 'mimeType': 'image/png', 'buffer': PNG})
        page.locator('textarea[name=caption]').fill('Синтетическое фото для проверки загрузки, не ботаническое наблюдение.')
        page.get_by_role('button', name='Загрузить в неразобранное', exact=True).click()
        form = page.locator('.assign-form').first
        form.locator('select').select_option(pid)
        form.get_by_role('button', name='Подтвердить', exact=True).click()
        page.get_by_text('Все входящие данные разобраны.', exact=True).wait_for()
    photos = api('list_records', {'plant_id': pid, 'type': 'photo'})['items']
    check('raw upload, pending inbox and confirmed plant assignment', len(photos) == 2)
    page.locator('button[data-nav=home]').click()
    page.locator(f'[data-plant="{pid}"]').click()
    page.locator('button[data-tab=photo]').click()
    page.locator('input[name=compare]').first.wait_for()
    for box in page.locator('input[name=compare]').all():
        box.check()
    page.get_by_role('button', name='Показать выбранные рядом', exact=True).click()
    page.get_by_role('heading', name='Сравнение фотографий', exact=True).wait_for()
    check('historical photo side-by-side viewer', page.locator('.comparison img').count() == 2)

    import uuid
    def new_id(): return str(uuid.uuid4())
    issue = api('create_issue', {'id': new_id(), 'plant_id': pid, 'title': 'Пожелтение нижних листьев', 'description': 'Учебный кейс интерфейса, не реальный диагноз.'})['issue']
    hypo = api('save_hypothesis', {'id': new_id(), 'issue_id': issue['id'], 'title': 'Возможная смена условий освещения', 'status': 'ACTIVE', 'reasoning': 'Нужно проверить одинаковые ракурсы и освещение.'})['hypothesis']
    page.goto(BASE + '/entity/hypothesis/' + hypo['id'])
    page.get_by_role('heading', name=hypo['short_code'] + ' · ' + hypo['title'], exact=True).wait_for()
    check('authenticated deep link opens hypothesis detail', True)
    page.screenshot(path=str(REPORTS / 'ui-hypothesis.png'), full_page=True)
    issue = api('get_entity', {'type': 'issue', 'id': issue['id']})['entity']
    closed = api('close_issue', {'issue_id': issue['id'], 'request_id': new_id(), 'expected_version': issue['version'], 'user_confirmed': True, 'outcome': 'UNKNOWN', 'reason': 'Завершение учебного примера', 'result_text': 'Наблюдений недостаточно; эффективность действий не оценивалась.'})
    page.goto(BASE + '/entity/journal/' + closed['journal_entry']['id'])
    page.get_by_text('Итоговая запись', exact=True).wait_for()
    check('closed issue journal is readable with uncertainty', page.get_by_text('недостаточно', exact=False).count() > 0)
    page.screenshot(path=str(REPORTS / 'ui-journal.png'), full_page=True)

    xss = api('add_journal_note', {'id': new_id(), 'plant_id': pid, 'entry_type': 'NOTE', 'title': 'Проверка экранирования', 'summary': '<img src=x onerror="window.PWNED=1">'})['entry']
    page.goto(BASE + '/entity/journal/' + xss['id'])
    page.get_by_role('heading', name=xss['short_code'] + ' · Проверка экранирования', exact=True).wait_for()
    check('untrusted journal text does not execute HTML/JS', page.evaluate('window.PWNED === undefined'))

    page.set_viewport_size({'width': 390, 'height': 844})
    page.goto(BASE + '/settings')
    page.get_by_role('heading', name='Настройки', exact=True).wait_for()
    check('390px mobile has no horizontal document overflow', page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
    page.screenshot(path=str(REPORTS / 'ui-mobile.png'), full_page=True)

    # Host bridge smoke: actual widget HTML runs inside iframe, host calls are mocked.
    # This is NOT a real ChatGPT session/permissions test.
    mock_settings = api('get_settings')
    mock_plants = api('get_plants')
    widget = (ROOT / 'public/widget.html').read_text()
    setup = '<script>window.openai={callTool:async(name,args)=>({structuredContent:{ok:true,data:name==="get_settings"?' + json.dumps(mock_settings, ensure_ascii=False) + ':' + json.dumps(mock_plants, ensure_ascii=False) + '}}),requestDisplayMode:async()=>({mode:"fullscreen"})};</script>'
    isolated = context.new_page()
    isolated.set_content('<iframe id="app" style="width:1100px;height:800px;border:0"></iframe>')
    isolated.locator('#app').evaluate('(el,src)=>el.srcdoc=src', setup + widget)
    frame = isolated.frame_locator('#app')
    frame.get_by_role('heading', name='Ваши растения', exact=True).wait_for()
    frame.locator('button[data-nav=settings]').click()
    frame.get_by_role('heading', name='Настройки', exact=True).wait_for()
    check('MCP widget runs in iframe with mocked window.openai bridge', True)
    check('standalone pages have no unhandled JavaScript errors', not errors)
    browser.close()

report = {'status': 'passed', 'checks': checks, 'count': len(checks), 'browser': 'Chromium via Python Playwright', 'real_chatgpt': False, 'real_cloudflare': False}
(REPORTS / 'browser-smoke.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps(report, ensure_ascii=False, indent=2))
