#!/usr/bin/env node
// Data integrity & freshness monitor for the Mark Six archive.
//
// HARD checks (exit 1 -> red badge): structural corruption in the committed data,
// or a CONFIRMED missed draw (a HKJC result available for >=1 full day yet absent
// here). Designed to never false-alarm: legitimate suspensions (source == repo),
// late-posted results (within a catch-up window) and API downtime are tolerated.
// SOFT checks (warnings only): surfaced in the run summary, badge stays green.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchRange, normalize, isValid, START_DATE } from './scrape.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const JSON_PATH = path.join(DATA_DIR, 'mark-six.json');
const CSV_PATH = path.join(DATA_DIR, 'mark-six.csv');

const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

function checkStructure(all, csv) {
  if (!Array.isArray(all) || all.length === 0) { fail('JSON is empty or not an array'); return; }

  let invalid = 0;
  for (const d of all) if (!isValid(d)) invalid++;
  if (invalid) fail(`${invalid} draw(s) fail validation (need 6 unique numbers + 1 special, all 1-49)`);

  const ids = new Set(), dates = new Set();
  let dupId = 0, dupDate = 0;
  for (const d of all) {
    if (ids.has(d.id)) dupId++; else ids.add(d.id);
    if (dates.has(d.date)) dupDate++; else dates.add(d.date);
  }
  if (dupId) fail(`${dupId} duplicate draw id(s)`);
  if (dupDate) warn(`${dupDate} duplicate draw date(s)`);

  for (let i = 1; i < all.length; i++) {
    if (all[i].date < all[i - 1].date) { fail(`not sorted ascending at index ${i} (${all[i - 1].date} -> ${all[i].date})`); break; }
  }

  if (all[0].date !== START_DATE) warn(`first draw is ${all[0].date}, expected ${START_DATE}`);

  // Per-year draw-number contiguity (warning only: HKJC could in theory skip a
  // number for an abandoned draw, so do not fail the badge on this).
  const byYear = new Map();
  for (const d of all) {
    const [yy, nnn] = d.draw.split('/');
    const y = 2000 + Number(yy);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(Number(nnn));
  }
  for (const [y, nos] of byYear) {
    const s = [...new Set(nos)].sort((a, b) => a - b);
    const miss = [];
    for (let n = s[0]; n <= s[s.length - 1]; n++) if (!s.includes(n)) miss.push(n);
    if (miss.length) warn(`year ${y}: non-contiguous draw number(s) ${miss.slice(0, 10).join(',')}${miss.length > 10 ? '...' : ''}`);
  }

  const rows = csv.trim().split('\n');
  if (rows.length - 1 !== all.length) fail(`CSV rows (${rows.length - 1}) != JSON draws (${all.length})`);
  const a0 = all[0], aN = all[all.length - 1];
  const fExp = [a0.draw, a0.date, a0.weekday, ...a0.numbers, a0.special].join(',');
  const lExp = [aN.draw, aN.date, aN.weekday, ...aN.numbers, aN.special].join(',');
  if ((rows[1] || '') !== fExp) fail('CSV first row does not match JSON');
  if ((rows[rows.length - 1] || '') !== lExp) fail('CSV last row does not match JSON');
}

async function checkFreshness(all) {
  const repoIds = new Set(all.map((d) => d.id));
  const repoLatest = all.reduce((mx, d) => (d.date > mx ? d.date : mx), '0000-00-00');
  const now = new Date();
  const ymd = (dt) => `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`;
  const start = new Date(now); start.setUTCDate(start.getUTCDate() - 85); // < 3-month API cap

  let source;
  try {
    source = await fetchRange(ymd(start), ymd(now));
  } catch (e) {
    warn(`freshness check skipped - HKJC unreachable (${String(e).slice(0, 80)})`);
    return { repoLatest, sourceLatest: null };
  }
  const results = source.filter((r) => r && r.status === 'Result').map(normalize).filter(isValid);
  if (!results.length) {
    warn('no recent HKJC results in the last 85 days (suspension or off-season) - freshness inconclusive');
    return { repoLatest, sourceLatest: null };
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const missed = [];
  let pending = 0;
  for (const d of results) {
    if (repoIds.has(d.id)) continue;
    const ageDays = Math.round((today - Date.parse(d.date + 'T00:00:00Z')) / 86400000);
    if (ageDays >= 2) missed.push(`${d.draw} (${d.date})`); else pending++;
  }
  if (missed.length) fail(`STALE: ${missed.length} HKJC result(s) available >=1 day but missing here: ${missed.slice(0, 5).join(', ')}`);
  if (pending) warn(`${pending} very recent draw(s) not yet ingested (within catch-up window, OK)`);
  const sourceLatest = results.reduce((mx, d) => (d.date > mx ? d.date : mx), '0000-00-00');
  return { repoLatest, sourceLatest };
}

async function main() {
  let all, csv;
  try {
    csv = await readFile(CSV_PATH, 'utf8');
    all = JSON.parse(await readFile(JSON_PATH, 'utf8'));
  } catch (e) {
    console.error('Failed to read/parse data files:', e.message);
    process.exit(1);
  }

  checkStructure(all, csv);
  const fresh = await checkFreshness(all);

  const lines = [];
  lines.push(`Draws:  ${all.length}`);
  lines.push(`Range:  ${all[0] && all[0].date} -> ${all[all.length - 1] && all[all.length - 1].date}`);
  if (fresh.sourceLatest) lines.push(`Latest: HKJC ${fresh.sourceLatest} | repo ${fresh.repoLatest}`);
  for (const w of warnings) lines.push(`WARN  ${w}`);
  for (const e of errors) lines.push(`FAIL  ${e}`);
  lines.push(errors.length ? `RESULT: FAIL (${errors.length} error(s))` : 'RESULT: PASS');
  const summary = lines.join('\n');
  console.log(summary);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.GITHUB_STEP_SUMMARY, '# 六合彩資料監控 (Mark Six monitor)\n\n```\n' + summary + '\n```\n');
  }
  process.exit(errors.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
