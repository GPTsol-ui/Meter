# Meter

**Your AI spend, understood.** A working, local-first MVP for exploring text-model token usage and USD costs from a CSV. No accounts, API keys, telemetry, external fonts, or upload endpoint.

## Run it

Node.js 20+ is sufficient. There are **zero npm dependencies** and no install step.

```sh
npm test
npm run build
npm run dev
```

Open the localhost address printed by the development server. `npm run build` also creates **`dist/index.html`**, a self-contained app that can be opened in a browser without a web server, or served by a static host. Browser/file-manager policies may restrict opening local HTML, particularly on phones; use the local server on your laptop in that case. Hosting is not configured by this commit.

## What works

- CSV, TSV, and semicolon-separated imports, including BOM, quoted commas, embedded newlines, escaped quotes, and custom column mapping.
- A preview shows validation errors and duplicate rows before replacing any data. Excluding invalid rows requires explicit acknowledgement. Duplicates are flagged **and retained**, because identical calls can be legitimate.
- Model/date filters, token and USD-cost charts, per-model breakdowns, cache-read share, budget comparison, and a paginated ledger.
- Editable USD-per-million rates for fresh input, cache reads, cache writes, and output. **Blank rates are unknown, not zero.**
- Source-provided costs take precedence over calculated estimates. Meter's exported `cost_basis` preserves the distinction between recorded costs, estimates, and unpriced rows on re-import.
- Filtered CSV export and an independent, printable HTML report containing the rate card, filters, and pricing limitations.
- Responsive desktop/mobile layouts, native keyboard-accessible dialogs, visible focus states, and reduced-motion support.

## Import contract

Required: a date, a model, and at least one input/output token column. Other token columns default to zero when absent; ensure that accurately represents your export.

```csv
date,model,input_tokens,cached_input_tokens,cache_write_tokens,output_tokens,cost_usd,currency
2026-09-01,your-model,10000,2000,0,1000,,USD
```

This generic `input_tokens` total **includes** cache reads and writes. In this example, fresh input is 8,000 tokens. For exports whose input column is fresh input only, select **Input excludes cache reads + writes**. Headers such as `cache_read_input_tokens` and `cache_creation_input_tokens` suggest that convention, but **review the preview**. Do not mix cache conventions in one file. Dates are UTC: YYYY-MM-DD, ISO timestamps with an explicit timezone, or Unix seconds/milliseconds. Ambiguous local dates are rejected.

The engine recognises common OpenAI/Anthropic-style field aliases, not every vendor's export format. It does not call either API. Reference semantics reviewed during implementation:

- OpenAI usage: https://platform.openai.com/docs/api-reference/usage — aggregated input includes cached tokens.
- Anthropic prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching — fresh input, cache read, and cache creation are separate buckets.

**Text-model costs only; USD only.** No currency conversion. Limits: 10 MB, 50,000 data rows, 100 columns, 100 distinct models per import. Extra models are invalid rows, visibly reported before import.

## Cost calculation and limitations

For rows without supplied cost:

`estimated USD = (fresh × fresh_rate + cache_read × cache_read_rate + cache_write × cache_write_rate + output × output_rate) / 1,000,000`

A positive-volume category without a valid rate makes the **entire row unpriced**. Zero-volume categories need no rate. Supplied CSV costs retain their declared basis; imported estimates are preserved as supplied estimates, not recalculated from a subsequently edited rate card. Remove the supplied cost column to recalculate those rows.

Known cost excludes unpriced rows; coverage is shown prominently. Prices in the default demo are **fictional illustrative values**, as are its model names and usage. There is no live price database. Flat per-model rates do not account for taxes, tool fees, discounts, multimodal prices, context tiers, speed tiers, or multiple cache-duration rates. Use appropriate separate rate groups or independently calculate and supply costs for complex billing.

**Meter cannot convert a ChatGPT/Claude subscription usage bar into credits, tokens, or money.** It is not a billing authority, invoice reconciler, live account dashboard, or subscription comparison engine.

## Privacy and security

All input data and rate settings stay in this page's memory. Importing replaces the current dataset and clears its rates. Reloading the page discards them and shows the labelled demo again. Clear removes the current data and rate card; it cannot delete downloaded files. There is no localStorage, analytics, cookie, or service-worker persistence.

CSV text is rendered through `textContent`, never interpreted as HTML. Reports escape imported text. CSV exports prefix potential spreadsheet formulas. The shipped CSP prohibits network connections, workers, objects, and form submissions. Inline scripts/styles are allowed to support the portable single-file build; serve with stronger hash-based headers if extending this into a hosted application. These safeguards are not a formal independent security audit.

## Verification

- `npm test`: **68 passing Node tests** for parsing, validation, cache semantics, calculations, filters, export safety, and cost provenance.
- Optional end-to-end checks: install Python Playwright and a Chromium browser, build, then run `python tests/browser.py`.
- **39 browser checks passed** in this build session, including desktop/mobile imports, rate edits, exports, invalid data, HTML injection text, and no external HTTP requests during the tested workflow.
- Browser testing used a locally supplied built document in Chromium, at 1440×1100 and 390×844. It is not a claim of Safari/Firefox or every-device coverage.

The Python browser harness is an optional development dependency, not shipped application code. `METER_TEST_OUTPUT` selects its output directory; `CHROMIUM_PATH` can select an existing browser executable.

## Project structure

- `src/engine.js` — pure parser, normalisation, calculations, filtering, safe export.
- `src/app.js` — DOM-based interface; untrusted values use text nodes.
- `src/style.css` and `index.html` — responsive presentation.
- `scripts/build.mjs` — deterministic, dependency-free single-file bundler.
- `scripts/serve.mjs` — localhost-only development server.
- `tests/engine.test.mjs`, `tests/browser.py` — reproducible tests.

The initial React/Vite spike has been replaced with native browser modules so this MVP can build and run without dependency installation or paid services. This is a tested **MVP**, not a validated business: no payments, paying customers, production deployment, live syncing, or proven demand yet.
