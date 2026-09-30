"""Optional browser regression test: pip install playwright; playwright install chromium.
Run after npm run build. Uses a local, already-built HTML string; no network access.
"""
import json
import os
from pathlib import Path
import shutil
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('METER_TEST_OUTPUT', ROOT / 'dist'))
OUT.mkdir(parents=True, exist_ok=True)
checks = []
def check(condition, name):
    assert condition, name
    checks.append(name)
    print('PASS', name)

def upload(page, text, name='usage.csv'):
    page.locator('#file-input').set_input_files({'name': name, 'mimeType': 'text/csv', 'buffer': text.encode()})
    page.locator('#import-dialog').wait_for(state='visible')

with sync_playwright() as p:
    executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
    options = {'headless': True}
    if executable:
        options['executable_path'] = executable
    browser = p.chromium.launch(**options)
    context = browser.new_context(viewport={'width': 1440, 'height': 1100}, accept_downloads=True)
    page = context.new_page()
    errors, requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))
    html = (ROOT / 'dist/index.html').read_text()
    page.set_content(html)
    check(page.locator('#dataset-tag').inner_text() == 'DEMO', 'Fictional demo clearly labelled')
    check(page.locator('#metric-cost').inner_text() == '$101.55', 'Demo cost renders correctly')
    check(page.locator('#rate-rows input').count() == 12, 'Editable model rate card')
    check(page.locator('#daily-chart .chart-bar').count() == 21, 'All demo dates charted')
    check(not page.evaluate('document.documentElement.scrollWidth > innerWidth'), 'Desktop has no page overflow')
    page.screenshot(path=str(OUT / 'meter-desktop.png'), full_page=True)
    page.locator('#page-next').click()
    check(page.locator('#ledger-range').inner_text() == '16–30 of 63 rows', 'Ledger pagination')
    page.locator('#model-filter').select_option('swift-small')
    page.locator('#from-filter').fill('2026-09-01'); page.locator('#from-filter').dispatch_event('change')
    page.locator('#to-filter').fill('2026-09-03'); page.locator('#to-filter').dispatch_event('change')
    check(page.locator('#row-count').inner_text() == '3 of 63 rows', 'Combined model/date filter')
    page.locator('#chart-tokens').click()
    check(page.locator('#chart-tokens').get_attribute('aria-pressed') == 'true', 'Chart mode button and accessibility state')
    page.locator('#from-filter').fill('2026-10-01'); page.locator('#from-filter').dispatch_event('change')
    check('From date' in page.locator('#row-count').inner_text(), 'Reversed date range explained')
    check(page.locator('#export-report').is_disabled(), 'Empty filtered reports cannot export')
    page.locator('#reset-filters').click(); page.locator('#chart-cost').click()
    page.locator('#guide-open').click()
    check(page.locator('#guide-dialog').is_visible(), 'Keyboard-accessible native guide dialog')
    page.keyboard.press('Escape')
    check(not page.locator('#guide-dialog').is_visible(), 'Escape closes dialog')
    header = 'date,model,input_tokens,cached_input_tokens,cache_write_tokens,output_tokens,cost_usd,currency\n'
    fixture = header + '2026-09-01,research-model,1000000,200000,0,100000,5,USD\n2026-09-02,studio-model,2000000,1000000,0,200000,,USD\nbad,broken,1,0,0,2,,USD'
    upload(page, fixture)
    check('2 valid rows' in page.locator('#import-preview').inner_text(), 'Import preview validates before replacing data')
    check(page.locator('#import-confirm').is_disabled(), 'Invalid-row exclusion requires acknowledgement')
    page.locator('#skip-invalid').check(); page.locator('#import-confirm').click()
    check(page.locator('#dataset-tag').inner_text() == 'LOCAL FILE', 'Real import replaces demo')
    check(page.locator('#metric-coverage').inner_text() == '50.0%', 'Unknown cost coverage stays explicit')
    check(page.locator('#metric-cost').inner_text() == '$5.00', 'Only known cost counted')
    page.get_by_label('studio-model Fresh input rate', exact=True).fill('2')
    page.get_by_label('studio-model Cache read rate', exact=True).fill('0.2')
    page.get_by_label('studio-model Output rate', exact=True).fill('8')
    check(page.locator('#metric-cost').inner_text() == '$8.80', 'Editing rates updates cost without double-counting cache')
    check(page.locator('#metric-coverage').inner_text() == '100.0%', 'All required rates yield complete coverage')
    page.locator('#budget').fill('10')
    check('88.0%' in page.locator('#budget-note').inner_text(), 'Budget calculation matches filtered known cost')
    with page.expect_download() as dl:
        page.locator('#export-report').click()
    report_path = OUT / 'meter-example-report.html'; dl.value.save_as(str(report_path))
    check('1 recorded / 1 estimated / 0 unpriced' in report_path.read_text(), 'Report exports honest pricing provenance')
    report_page = context.new_page(); report_page.set_content(report_path.read_text())
    check('$8.80' in report_page.locator('h2').first.inner_text(), 'Exported report renders independently')
    with page.expect_download() as dl:
        page.locator('#export-csv').click()
    csv_path = OUT / 'meter-example-export.csv'; dl.value.save_as(str(csv_path))
    check('estimated' in csv_path.read_text(), 'CSV export includes estimate basis')
    upload(page, csv_path.read_text(), 'roundtrip.csv'); page.locator('#import-confirm').click()
    check('1 recorded · 1 estimated' in page.locator('#cost-caption').inner_text(), 'CSV reimport does not launder estimates into recorded charges')
    check(page.get_by_label('studio-model Fresh input rate', exact=True).input_value() == '', 'New file clears previous rate card')
    page.locator('#file-input').set_input_files({'name': 'bad.csv', 'mimeType': 'text/csv', 'buffer': b'a,b\n"unterminated,2'})
    expect(page.locator('#status')).to_contain_text('unclosed quote')
    check('unclosed quote' in page.locator('#status').inner_text(), 'Malformed CSV produces useful error')
    check(page.locator('#metric-cost').inner_text() == '$8.80', 'Failed import preserves previous dataset')
    upload(page, 'When,Which,In,Out\n2026-09-03,bespoke,100,20', 'custom.csv')
    for label, index in [('Date *','0'),('Model *','1'),('Input tokens','2'),('Output tokens','3')]:
        page.get_by_label('Map ' + label, exact=True).select_option(index)
    page.locator('#import-confirm').click()
    check(page.locator('#metric-tokens').inner_text() == '120', 'Manual column mapping works')
    upload(page, 'date,model,input_tokens,cache_read_input_tokens,cache_creation_input_tokens,output_tokens\n2026-09-03,anthropic-style,60,30,10,20')
    check(page.locator('#semantics').input_value() == 'exclusive', 'Fresh-input cache convention auto-detected')
    page.locator('#import-confirm').click()
    check(page.locator('#metric-tokens').inner_text() == '120', 'Fresh-input import preserves complete token count')
    evil = '<img src=x onerror=window.hacked=true>'
    upload(page, header + f'2026-09-01,{evil},100,0,0,20,1,USD', '<unsafe>.csv')
    page.locator('#import-confirm').click()
    check(page.locator('img').count() == 0 and not page.evaluate('Boolean(window.hacked)'), 'Untrusted CSV model names never become HTML')
    with page.expect_download() as dl:
        page.locator('#export-report').click()
    hostile_report = OUT / 'meter-escaped-report.html'; dl.value.save_as(str(hostile_report))
    check('&lt;img' in hostile_report.read_text(), 'Exported HTML report escapes untrusted model names')
    page.once('dialog', lambda d: d.accept()); page.locator('#clear-button').click()
    check(page.locator('#dataset-tag').inner_text() == 'EMPTY', 'Clear removes dataset and rates')
    check(page.locator('#rate-rows input').count() == 0, 'Clear removes rate fields')
    page.locator('#sample-button').click()
    page.set_viewport_size({'width':390,'height':844}); page.evaluate('scrollTo(0,0)')
    check(not page.evaluate('document.documentElement.scrollWidth > innerWidth'), 'Mobile has no page overflow')
    page.screenshot(path=str(OUT / 'meter-mobile.png'), full_page=True)
    upload(page, fixture, 'mobile.csv')
    check(page.locator('#import-dialog').is_visible(), 'Mobile import dialog works')
    page.locator('#skip-invalid').check(); page.locator('#import-confirm').click()
    check(page.locator('#metric-cost').inner_text() == '$5.00', 'Mobile import completes')
    check(not errors, 'No JavaScript runtime exceptions')
    check(not [url for url in requests if url.startswith(('http://','https://'))], 'No external HTTP requests during full workflow')
    browser.close()
(OUT / 'browser-results.json').write_text(json.dumps({'passed': len(checks), 'checks': checks, 'runtime_errors':errors, 'external_requests':[u for u in requests if u.startswith(('http://','https://'))]}, indent=2))
print(f'\n{len(checks)} browser checks passed.')
