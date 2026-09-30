/** Meter's pure data engine. No network, DOM, storage, or third-party code. */
export const LIMITS = Object.freeze({ bytes: 10 * 1024 * 1024, rows: 50000, columns: 100, models: 100 });
export const FIELDS = {
  date: ['date', 'timestamp', 'start_time', 'start_time_iso', 'created_at'],
  model: ['model', 'model_name'],
  input: ['input_tokens', 'prompt_tokens', 'n_context_tokens'],
  cached: ['cached_input_tokens', 'input_cached_tokens', 'cache_read_input_tokens'],
  written: ['cache_write_tokens', 'cache_creation_input_tokens', 'input_cache_write_tokens'],
  output: ['output_tokens', 'completion_tokens', 'n_generated_tokens'],
  cost: ['cost_usd', 'cost', 'total_cost_usd'],
  currency: ['currency'],
  basis: ['cost_basis']
};
const normal = value => value.trim().toLowerCase().replace(/[\s.-]+/g, '_');

/** RFC-style quoted CSV, TSV, and semicolon exports. Limits are checked before mapping. */
export function parseCSV(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('The file is empty.');
  if (new TextEncoder().encode(text).length > LIMITS.bytes) throw new Error('Use a file smaller than 10 MB.');
  text = text.replace(/^\uFEFF/, '').replace(/^(?:[ \t]*\r?\n)+/, '');
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (inQuote && text[i + 1] === '"') { i++; continue; } inQuote = !inQuote; }
    if (!inQuote && (c === '\n' || c === '\r')) break;
    if (!inQuote && Object.hasOwn(counts, c)) counts[c]++;
  }
  const delimiter = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const records = [];
  let row = [], field = '', quoted = false, closed = false;
  function cell() {
    row.push(field.trim()); field = ''; closed = false;
    if (row.length > LIMITS.columns) throw new Error('The file has more than 100 columns.');
  }
  function record() {
    cell();
    if (row.some(value => value !== '')) records.push(row);
    row = [];
    if (records.length > LIMITS.rows + 1) throw new Error('Use at most 50,000 data rows.');
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += c;
    } else if (c === delimiter) cell();
    else if (c === '\n' || c === '\r') { record(); if (c === '\r' && text[i + 1] === '\n') i++; }
    else if (c === '"' && !field.trim() && !closed) { field = ''; quoted = true; }
    else if (c === '"' || (closed && !/\s/.test(c))) throw new Error('Malformed CSV quoting. Re-export the file with quoted text fields.');
    else if (!closed) field += c;
  }
  if (quoted) throw new Error('The CSV has an unclosed quote.');
  if (field || row.length || closed) record();
  if (records.length < 2) throw new Error('Include a header and at least one data row.');
  const headers = records.shift();
  if (headers.some(h => !h) || new Set(headers.map(normal)).size !== headers.length) throw new Error('Column headers must be non-empty and unique.');
  return { headers, records, delimiter };
}

export function detectMapping(headers) {
  const names = headers.map(normal);
  return Object.fromEntries(Object.entries(FIELDS).map(([field, aliases]) => [field, names.findIndex(name => aliases.includes(name))]));
}
export function detectSemantics(headers) {
  return headers.some(h => ['cache_read_input_tokens', 'cache_creation_input_tokens'].includes(normal(h))) ? 'exclusive' : 'inclusive';
}

/** Dates are UTC. Ambiguous day/month formats and impossible calendar dates are rejected. */
export function parseDate(value) {
  const text = String(value).trim();
  if (/^\d{10}(\d{3})?$/.test(text)) {
    const d = new Date(Number(text) * (text.length === 10 ? 1000 : 1));
    if (!Number.isNaN(d.valueOf())) return d.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.test(text)) throw new Error('date must be YYYY-MM-DD, an ISO timestamp with timezone, or a Unix timestamp');
  const date = text.slice(0, 10);
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('date does not exist');
  const parsed = new Date(text.length === 10 ? `${text}T00:00:00Z` : text);
  if (Number.isNaN(parsed.valueOf())) throw new Error('invalid timestamp');
  return parsed.toISOString().slice(0, 10);
}
function number(value, name, integer = true) {
  const text = String(value).trim();
  if (!text) return 0;
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) throw new Error(`${name} must be a non-negative number`);
  const n = Number(text.replaceAll(',', ''));
  if (!Number.isFinite(n) || (integer && !Number.isSafeInteger(n)) || n > 1e12) throw new Error(`${name} is too large or not a whole number`);
  return n;
}

/** Invalid rows are reported, never silently counted as zero. Duplicate rows are retained. */
export function normalise(parsed, mapping = detectMapping(parsed.headers), semantics = detectSemantics(parsed.headers)) {
  if (!['inclusive', 'exclusive'].includes(semantics)) throw new Error('Choose how the input column treats cache tokens.');
  if (mapping.date < 0 || mapping.model < 0 || (mapping.input < 0 && mapping.output < 0)) throw new Error('Map Date, Model, and at least one input/output token column.');
  const selected = Object.values(mapping).filter(index => index >= 0);
  if (new Set(selected).size !== selected.length) throw new Error('Each source column can only be mapped once.');
  if (selected.some(index => !Number.isInteger(index) || index >= parsed.headers.length)) throw new Error('Invalid column mapping.');
  const rows = [], errors = [], seen = new Set(), modelNames = new Set();
  let duplicates = 0, tokenTotal = 0;
  parsed.records.forEach((cells, index) => {
    try {
      if (cells.length !== parsed.headers.length) throw new Error(`expected ${parsed.headers.length} columns, found ${cells.length}`);
      const get = key => mapping[key] >= 0 ? cells[mapping[key]] : '';
      const date = parseDate(get('date'));
      const model = get('model').trim();
      if (!model || model.length > 160) throw new Error('model is missing or longer than 160 characters');
      const input = number(get('input'), 'input tokens'), cached = number(get('cached'), 'cached tokens');
      const written = number(get('written'), 'cache-write tokens'), output = number(get('output'), 'output tokens');
      if (!get('input') && !get('output')) throw new Error('both input and output token counts are empty');
      const fresh = semantics === 'inclusive' ? input - cached - written : input;
      if (fresh < 0) throw new Error('cache tokens exceed input; check the cache convention');
      const currency = get('currency').toUpperCase();
      if (currency && currency !== 'USD') throw new Error('only USD cost rows are supported; currency conversion is not available');
      const cost = get('cost') === '' ? null : number(get('cost'), 'USD cost', false);
      const costBasis = get('basis').toLowerCase() || (cost === null ? 'unpriced' : 'recorded');
      if (!['recorded', 'estimated', 'unpriced'].includes(costBasis) || ((cost === null) !== (costBasis === 'unpriced'))) throw new Error('cost basis must agree with the presence of a cost');
      if (!modelNames.has(model) && modelNames.size >= LIMITS.models) throw new Error('use at most 100 distinct models per import');
      const item = { date, model, fresh, cached, written, output, cost, costBasis, sourceRow: index + 2 };
      const tokens = fresh + cached + written + output;
      if (!Number.isSafeInteger(tokenTotal + tokens)) throw new Error('token total exceeds safe numeric precision');
      tokenTotal += tokens; modelNames.add(model);
      const signature = JSON.stringify([date, model, fresh, cached, written, output, cost, costBasis]);
      if (seen.has(signature)) duplicates++;
      seen.add(signature); rows.push(item);
    } catch (error) { errors.push({ row: index + 2, message: error.message }); }
  });
  return { rows, errors, duplicates, total: parsed.records.length };
}

/** Missing rates are unknown, not free. Supplied USD costs always take precedence; estimated provenance is preserved. */
export function priceRow(row, rates = new Map()) {
  if (row.cost !== null) return { cost: row.cost, basis: row.costBasis === 'estimated' ? 'estimated' : 'recorded' };
  const rate = rates.get(row.model) || {};
  let cost = 0;
  for (const bucket of ['fresh', 'cached', 'written', 'output']) {
    if (!row[bucket]) continue;
    const raw = rate[bucket];
    if (raw === '' || raw === undefined || raw === null || !Number.isFinite(Number(raw)) || Number(raw) < 0 || Number(raw) > 1e6) return { cost: null, basis: 'unpriced' };
    cost += row[bucket] * Number(raw) / 1e6;
  }
  return { cost, basis: 'estimated' };
}
export function filterRows(rows, { model = '', from = '', to = '' } = {}) {
  return rows.filter(row => (!model || row.model === model) && (!from || row.date >= from) && (!to || row.date <= to));
}
export function summarise(rows, rates = new Map()) {
  const result = { tokens: 0, input: 0, output: 0, cached: 0, written: 0, cost: 0, recorded: 0, estimated: 0, unpriced: 0, count: rows.length, models: [], days: [] };
  const models = new Map(), days = new Map();
  for (const row of rows) {
    const input = row.fresh + row.cached + row.written, tokens = input + row.output;
    const priced = priceRow(row, rates);
    result.tokens += tokens; result.input += input; result.output += row.output;
    result.cached += row.cached; result.written += row.written;
    result.cost += priced.cost ?? 0; result[priced.basis]++;
    for (const [map, key] of [[models, row.model], [days, row.date]]) {
      if (!map.has(key)) map.set(key, { name: key, tokens: 0, cost: 0, rows: 0, unpriced: 0 });
      const group = map.get(key); group.tokens += tokens; group.cost += priced.cost ?? 0;
      group.rows++; group.unpriced += priced.cost === null ? 1 : 0;
    }
  }
  result.models = [...models.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
  result.days = [...days.values()].sort((a, b) => a.name.localeCompare(b.name));
  result.coverage = rows.length ? (rows.length - result.unpriced) / rows.length : 0;
  return result;
}
export function csvCell(value) {
  let text = String(value ?? '');
  // Stop spreadsheet formula execution in user-controlled text, including leading controls.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function exportCSV(rows, rates) {
  const headers = ['date', 'model', 'input_tokens', 'cached_input_tokens', 'cache_write_tokens', 'output_tokens', 'cost_usd', 'cost_basis', 'currency'];
  return [headers, ...rows.map(row => { const p = priceRow(row, rates); return [row.date, row.model, row.fresh + row.cached + row.written, row.cached, row.written, row.output, p.cost === null ? '' : String(p.cost), p.basis, 'USD']; })].map(row => row.map(csvCell).join(',')).join('\r\n');
}
export const TEMPLATE = 'date,model,input_tokens,cached_input_tokens,cache_write_tokens,output_tokens,cost_usd,currency\n2026-09-01,your-model,10000,2000,0,1000,,USD\n';
export function demoData() {
  const models = ['swift-small', 'studio-large', 'reasoner-pro'];
  const rows = [];
  for (let day = 1; day <= 21; day++) for (let m = 0; m < models.length; m++) {
    const scale = ((day * 7 + m * 3) % 9 + 3) * 12000;
    rows.push({ date: `2026-09-${String(day).padStart(2, '0')}`, model: models[m], fresh: scale * (m + 1), cached: scale * 2, written: m === 1 ? scale / 4 : 0, output: scale / 3, cost: null, sourceRow: rows.length + 2 });
  }
  const rates = new Map([
    ['swift-small', { fresh: '0.5', cached: '0.05', written: '0.625', output: '2' }],
    ['studio-large', { fresh: '3', cached: '0.3', written: '3.75', output: '15' }],
    ['reasoner-pro', { fresh: '10', cached: '1', written: '12.5', output: '40' }]
  ]);
  return { rows, rates };
}
