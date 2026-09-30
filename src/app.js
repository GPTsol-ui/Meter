import { LIMITS, FIELDS, parseCSV, detectMapping, detectSemantics, normalise, priceRow, filterRows, summarise, exportCSV, TEMPLATE, demoData } from './engine.js';

const $ = id => document.getElementById(id);
const full = n => n.toLocaleString('en-US');
const compact = n => n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const money = n => n === null ? 'Unpriced' : n > 0 && n < 0.0001 ? '<$0.0001' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n > 0 && n < 1 ? 4 : 2 })}`;
const percent = n => `${(n * 100).toFixed(1)}%`;
function node(tag, text, className = '') {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function notice(text, error = false) { $('status').textContent = text; $('status').className = error ? 'status error' : 'status'; }
const state = { ...demoData(), demo: true, name: "A fictional studio's September", pending: null, page: 0, metric: 'cost', request: 0 };
function filters() { return { model: $('model-filter').value, from: $('from-filter').value, to: $('to-filter').value }; }
function visible() { return filterRows(state.rows, filters()); }
function resetFilters() { $('model-filter').value = ''; $('from-filter').value = ''; $('to-filter').value = ''; state.page = 0; }
function refreshDataset() {
  const select = $('model-filter'); select.replaceChildren(new Option('All models', ''));
  for (const model of [...new Set(state.rows.map(row => row.model))].sort()) select.add(new Option(model, model));
  resetFilters(); $('budget').value = '';
  $('dataset-tag').textContent = state.demo ? 'DEMO' : state.rows.length ? 'LOCAL FILE' : 'EMPTY';
  $('dataset-name').textContent = state.name;
  $('dataset-note').textContent = state.demo ? 'Illustrative models and prices. Not your account.' : state.rows.length ? 'In memory only. Reloading clears this dataset.' : 'Import a CSV or explore the demo.';
  $('sample-button').textContent = state.demo ? 'Reset demo' : 'View demo';
  renderRates(); render();
}
function renderRates() {
  const body = $('rate-rows'); body.replaceChildren();
  for (const model of [...new Set(state.rows.map(row => row.model))].sort()) {
    const tr = node('tr'); tr.append(node('th', model)); tr.firstChild.scope = 'row';
    for (const [key, label] of [['fresh', 'Fresh input'], ['cached', 'Cache read'], ['written', 'Cache write'], ['output', 'Output']]) {
      const td = node('td'), input = node('input');
      input.type = 'number'; input.min = '0'; input.max = '1000000'; input.step = 'any'; input.placeholder = 'Not set';
      input.value = state.rates.get(model)?.[key] ?? ''; input.setAttribute('aria-label', `${model} ${label} rate`);
      input.addEventListener('input', () => {
        const valid = input.validity.valid;
        input.setAttribute('aria-invalid', String(!valid));
        if (!state.rates.has(model)) state.rates.set(model, {});
        state.rates.get(model)[key] = valid ? input.value : '';
        render();
      });
      td.append(input); tr.append(td);
    }
    body.append(tr);
  }
  if (!body.children.length) { const tr = node('tr'), td = node('td', 'Import usage to add model rates.', 'empty-cell'); td.colSpan = 5; tr.append(td); body.append(tr); }
}
function render() {
  const rows = visible(), summary = summarise(rows, state.rates);
  const wrongRange = filters().from && filters().to && filters().from > filters().to;
  $('row-count').textContent = wrongRange ? 'From date must be before To date.' : `${full(rows.length)} of ${full(state.rows.length)} rows`;
  $('metric-cost').textContent = rows.length && summary.coverage ? money(summary.cost) : '—';
  $('metric-tokens').textContent = compact(summary.tokens); $('metric-tokens').title = full(summary.tokens);
  $('metric-cache').textContent = summary.input ? percent(summary.cached / summary.input) : '—';
  $('metric-coverage').textContent = rows.length ? percent(summary.coverage) : '—';
  $('cost-caption').textContent = `${full(summary.recorded)} recorded · ${full(summary.estimated)} estimated rows`;
  $('tokens-caption').textContent = `${compact(summary.input)} input · ${compact(summary.output)} output`;
  $('coverage-caption').textContent = `${full(summary.unpriced)} rows need rates`;
  $('coverage-warning').hidden = !summary.unpriced;
  $('coverage-warning').textContent = `${full(summary.unpriced)} rows have no known cost. Totals and cost charts exclude them; add missing rates below. Unknown does not mean free.`;
  $('model-count').textContent = `${summary.models.length} models`;
  const breakdown = $('model-breakdown'); breakdown.replaceChildren();
  const metric = state.metric;
  for (const [index, model] of summary.models.entries()) {
    const item = node('div', undefined, 'model-item'), heading = node('div', undefined, 'model-line');
    const name = node('span', model.name, 'model-name'); name.title = model.name;
    heading.append(name, node('b', metric === 'cost' ? model.unpriced === model.rows ? 'Unpriced' : money(model.cost) : compact(model.tokens)));
    const bar = node('div', undefined, 'model-track'), fill = node('div', undefined, `model-fill tone-${index % 3}`);
    const denominator = metric === 'cost' ? summary.cost : summary.tokens;
    fill.style.width = `${denominator ? (model[metric] / denominator) * 100 : 0}%`; bar.append(fill);
    item.append(heading, bar, node('small', `${full(model.rows)} rows · ${compact(model.tokens)} tokens${model.unpriced ? ` · ${full(model.unpriced)} unpriced` : ''}`)); breakdown.append(item);
  }
  if (!summary.models.length) breakdown.append(node('p', 'No matching usage yet.', 'empty-message'));
  const days = summary.days.slice(-30), max = Math.max(0, ...days.map(day => day[metric]));
  const chart = $('daily-chart'); chart.replaceChildren();
  $('chart-cost').setAttribute('aria-pressed', String(metric === 'cost')); $('chart-tokens').setAttribute('aria-pressed', String(metric === 'tokens'));
  $('chart-max').textContent = metric === 'cost' ? money(max) : compact(max);
  $('chart-note').textContent = metric === 'cost' ? 'Supplied costs + estimates from your rate card.' : 'Total input (including cache) + output tokens.';
  $('chart-legend').textContent = metric === 'cost' ? 'Known cost in USD' : 'Total tokens';
  for (const day of days) {
    const column = node('div', undefined, 'chart-column'), bar = node('div', undefined, 'chart-bar');
    const description = `${day.name}: ${metric === 'cost' ? money(day.cost) : `${full(day.tokens)} tokens`}${day.unpriced ? `; ${day.unpriced} unpriced rows` : ''}`;
    column.setAttribute('role', 'listitem'); column.setAttribute('aria-label', description); column.title = description;
    bar.style.height = `${max ? day[metric] / max * 100 : 0}%`; column.append(bar); chart.append(column);
  }
  if (!days.length || !max) chart.append(node('span', rows.length && metric === 'cost' ? 'No positive known cost to plot.' : 'No usage to plot.', 'chart-empty'));
  $('chart-dates').replaceChildren(node('span', days[0]?.name ?? ''), node('span', days.at(-1)?.name ?? ''));
  const leading = metric === 'cost' ? summary.models.find(m => m.cost > 0) : [...summary.models].sort((a, b) => b.tokens - a.tokens)[0];
  $('insight-text').textContent = leading ? `${leading.name} accounts for ${percent(leading[metric] / (metric === 'cost' ? summary.cost : summary.tokens))} of ${metric === 'cost' ? 'known cost' : 'tokens'} in this view.${summary.unpriced ? ' Missing prices may change the cost picture.' : ''}` : 'A usage export tells half the story. Add your rates to see the cost behind the tokens.';
  const budget = Number($('budget').value);
  $('budget-note').textContent = budget > 0 && Number.isFinite(budget) && summary.coverage ? `${percent(summary.cost / budget)} used by known cost${summary.unpriced ? ' · excludes unpriced rows' : ''}.` : 'A comparison, not a spending limit.';
  renderLedger(rows);
  $('export-csv').disabled = !rows.length; $('export-report').disabled = !rows.length;
}
function renderLedger(rows) {
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date) || a.sourceRow - b.sourceRow);
  const size = 15, pages = Math.max(1, Math.ceil(rows.length / size)); state.page = Math.min(state.page, pages - 1);
  const body = $('ledger-rows'); body.replaceChildren();
  for (const row of sorted.slice(state.page * size, (state.page + 1) * size)) {
    const p = priceRow(row, state.rates), tr = node('tr');
    for (const [index, value] of [row.date, row.model, full(row.fresh + row.cached + row.written), full(row.output), money(p.cost)].entries()) {
      const td = node('td', value, index >= 2 ? 'numeric' : ''); if (index === 1) td.title = row.model; tr.append(td);
    }
    const td = node('td'); td.append(node('span', p.basis, `basis ${p.basis}`)); tr.append(td); body.append(tr);
  }
  if (!rows.length) { const tr = node('tr'), td = node('td', 'No rows match this view. Import a file or reset your filters.', 'empty-cell'); td.colSpan = 6; tr.append(td); body.append(tr); }
  $('ledger-range').textContent = rows.length ? `${state.page * size + 1}–${Math.min((state.page + 1) * size, rows.length)} of ${full(rows.length)} rows` : '0 rows';
  $('page-prev').disabled = state.page === 0; $('page-next').disabled = state.page === pages - 1;
}
const fieldLabels = { date: 'Date *', model: 'Model *', input: 'Input tokens', cached: 'Cache-read tokens', written: 'Cache-write tokens', output: 'Output tokens', cost: 'Recorded cost · USD', currency: 'Currency', basis: 'Cost basis (optional)' };
async function loadFile(file) {
  if (!file) return;
  const request = ++state.request;
  try {
    if (file.size > LIMITS.bytes) throw new Error('Use a file smaller than 10 MB.');
    const text = await file.text(); if (request !== state.request) return;
    const parsed = parseCSV(text);
    state.pending = { parsed, name: file.name, mapping: detectMapping(parsed.headers), result: null };
    $('import-file-name').textContent = `${file.name} · ${full(parsed.records.length)} rows found`;
    $('semantics').value = detectSemantics(parsed.headers); $('skip-invalid').checked = false;
    const container = $('mapping-fields'); container.replaceChildren();
    for (const field of Object.keys(FIELDS)) {
      const label = node('label', fieldLabels[field]), select = node('select'); select.setAttribute('aria-label', `Map ${fieldLabels[field]}`);
      select.add(new Option('Not mapped', '-1'));
      parsed.headers.forEach((header, i) => select.add(new Option(header, String(i))));
      select.value = String(state.pending.mapping[field]);
      select.addEventListener('change', () => { state.pending.mapping[field] = Number(select.value); $('skip-invalid').checked = false; previewImport(); });
      label.append(select); container.append(label);
    }
    $('guide-dialog').close(); previewImport();
    if (!$('import-dialog').open) $('import-dialog').showModal();
  } catch (error) { notice(error.message, true); }
}
function previewImport() {
  const panel = $('import-preview'); panel.replaceChildren(); $('skip-label').hidden = true;
  try {
    const p = state.pending; p.result = normalise(p.parsed, p.mapping, $('semantics').value);
    const { rows, errors, duplicates } = p.result;
    panel.append(node('p', `${full(rows.length)} valid rows · ${full(errors.length)} invalid rows`, errors.length ? 'notice' : 'success-note'));
    if (duplicates) panel.append(node('p', `${full(duplicates)} identical normalised rows detected and kept. Check whether these are repeated exports or legitimate usage.`, 'notice'));
    if (errors.length) {
      const list = node('ul', undefined, 'import-errors');
      for (const error of errors.slice(0, 5)) list.append(node('li', `Data record ${error.row}: ${error.message}`));
      if (errors.length > 5) list.append(node('li', `…and ${full(errors.length - 5)} more. Correct your source CSV for a complete import.`));
      panel.append(list); $('skip-label').hidden = false;
    }
    if (rows[0]) panel.append(node('p', `First valid row: ${rows[0].date} · ${rows[0].model} · ${full(rows[0].fresh)} fresh / ${full(rows[0].cached)} cached / ${full(rows[0].written)} cache-write / ${full(rows[0].output)} output tokens.`, 'fine-print'));
    $('import-confirm').disabled = !rows.length || Boolean(errors.length && !$('skip-invalid').checked);
  } catch (error) { state.pending.result = null; panel.append(node('p', error.message, 'notice')); $('import-confirm').disabled = true; }
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type })), anchor = node('a');
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function report() {
  const rows = visible(), s = summarise(rows, state.rates), f = filters();
  const modelRows = s.models.map(model => `<tr><td>${escapeHTML(model.name)}</td><td>${full(model.tokens)}</td><td>${model.unpriced === model.rows ? 'Unpriced' : money(model.cost)}</td><td>${full(model.unpriced)}</td></tr>`).join('');
  const rateRows = [...state.rates].filter(([name]) => s.models.some(m => m.name === name)).map(([name, r]) => `<tr><td>${escapeHTML(name)}</td>${['fresh', 'cached', 'written', 'output'].map(key => `<td>${escapeHTML(r[key] ?? '') || 'Not set'}</td>`).join('')}</tr>`).join('');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Meter usage report</title><style>body{font:16px/1.6 system-ui;margin:40px auto;max-width:950px;padding:0 24px;color:#202322}h1{font-size:40px}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}small{color:#555}.note{padding:16px;background:#f4f1e8}@media print{body{margin:0;font-size:11px}h1{font-size:26px}tr{break-inside:avoid}}</style><h1>meter. / Usage report</h1><p>${escapeHTML(state.name)}${state.demo ? ' — FICTIONAL DEMO DATA AND RATES' : ''}</p><small>Generated ${escapeHTML(new Date().toISOString())}. Filters: model ${escapeHTML(f.model || 'all')}; ${escapeHTML(f.from || 'start')} to ${escapeHTML(f.to || 'end')} (UTC).</small><h2>${s.coverage ? money(s.cost) : 'Unpriced'} known cost · ${full(s.tokens)} tokens</h2><p>${full(s.count)} rows · ${percent(s.coverage)} cost coverage · ${s.recorded} recorded / ${s.estimated} estimated / ${s.unpriced} unpriced rows.</p><table><thead><tr><th>Model</th><th>Tokens</th><th>Known cost · USD</th><th>Unpriced rows</th></tr></thead><tbody>${modelRows}</tbody></table><h2>Rate card · USD per million tokens</h2><table><thead><tr><th>Model</th><th>Fresh input</th><th>Cache read</th><th>Cache write</th><th>Output</th></tr></thead><tbody>${rateRows}</tbody></table><p class="note">Supplied CSV costs take precedence; imported estimates remain labelled as estimates. Estimated cost = sum of each token category × its supplied rate / 1,000,000. Unpriced rows are excluded from known cost, not assumed free. This report is not an invoice. Flat estimates exclude tool fees, taxes, discounts and modality/context/speed/cache-duration tiers. No subscription or credit conversion.</p><p>Generated locally by Meter. Print this page from your browser to save a paper/PDF copy.</p></html>`;
  download('meter-report.html', html, 'text/html;charset=utf-8'); notice('Report exported. It includes the current filters, pricing basis and rate card.');
}
$('file-input').addEventListener('change', event => { loadFile(event.target.files?.[0]); event.target.value = ''; });
$('import-open').addEventListener('click', () => $('file-input').click());
$('choose-other').addEventListener('click', () => $('file-input').click());
$('import-close').addEventListener('click', () => $('import-dialog').close());
$('semantics').addEventListener('change', () => { $('skip-invalid').checked = false; previewImport(); });
$('skip-invalid').addEventListener('change', previewImport);
$('import-confirm').addEventListener('click', () => {
  const pending = state.pending;
  if (!pending?.result?.rows.length || (pending.result.errors.length && !$('skip-invalid').checked)) return;
  state.rows = pending.result.rows; state.rates = new Map(); state.demo = false; state.name = pending.name;
  $('import-dialog').close(); refreshDataset(); notice(`Imported ${full(state.rows.length)} rows; excluded ${full(pending.result.errors.length)} invalid rows. Enter rates to price any rows without recorded costs.`);
  state.pending = null;
});
for (const id of ['model-filter', 'from-filter', 'to-filter']) $(id).addEventListener('change', () => { state.page = 0; render(); });
$('reset-filters').addEventListener('click', () => { resetFilters(); render(); });
$('budget').addEventListener('input', render);
$('chart-cost').addEventListener('click', () => { state.metric = 'cost'; render(); });
$('chart-tokens').addEventListener('click', () => { state.metric = 'tokens'; render(); });
$('page-prev').addEventListener('click', () => { state.page--; render(); });
$('page-next').addEventListener('click', () => { state.page++; render(); });
$('sample-button').addEventListener('click', () => {
  if (!state.demo && state.rows.length && !window.confirm('Replace the imported dataset and rate card with fictional demo data?')) return;
  state.request++; Object.assign(state, demoData(), { demo: true, name: "A fictional studio's September", pending: null }); refreshDataset(); notice('Demo loaded. Model names, usage and rates are fictional.');
});
$('clear-button').addEventListener('click', () => {
  if (state.rows.length && !window.confirm('Clear the dataset and rate card from this tab? Export anything you want to keep first.')) return;
  state.request++; Object.assign(state, { rows: [], rates: new Map(), demo: false, name: 'A clean slate', pending: null }); refreshDataset(); notice('Dataset and rates cleared. Previously downloaded files are unchanged.');
});
$('guide-open').addEventListener('click', () => $('guide-dialog').showModal());
for (const id of ['guide-close', 'guide-done']) $(id).addEventListener('click', () => $('guide-dialog').close());
$('template-download').addEventListener('click', () => download('meter-template.csv', TEMPLATE, 'text/csv;charset=utf-8'));
$('export-csv').addEventListener('click', () => { download('meter-usage.csv', exportCSV(visible(), state.rates), 'text/csv;charset=utf-8'); notice('Filtered usage exported. Cost basis is included for every row.'); });
$('export-report').addEventListener('click', report);
window.addEventListener('dragover', event => { event.preventDefault(); });
window.addEventListener('drop', event => { event.preventDefault(); if (event.dataTransfer.files.length === 1) loadFile(event.dataTransfer.files[0]); else notice('Import one file at a time. Each import replaces the dataset.', true); });
refreshDataset();
