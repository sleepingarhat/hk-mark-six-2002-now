#!/usr/bin/env node
// HK Mark Six (六合彩) results scraper — official HKJC GraphQL source.
// Full-backfills history from 2002-07-04 and appends new draws on each run.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ENDPOINT = 'https://info.cld.hkjc.com/graphql/base/';
const START_DATE = '2002-07-04';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const JSON_PATH = path.join(DATA_DIR, 'mark-six.json');
const CSV_PATH = path.join(DATA_DIR, 'mark-six.csv');

// Exact persisted operation used by the HKJC Mark Six SPA (operationName must be
// "marksixResult"; the gateway whitelists by operation name then validates the
// query against the schema). dates are YYYYMMDD, max ~3 months (one quarter) per
// request, drawType "All".
const GQL = `fragment lotteryDrawsFragment on LotteryDraw {
  id
  year
  no
  openDate
  closeDate
  drawDate
  status
  snowballCode
  snowballName_en
  snowballName_ch
  lotteryPool {
    sell
    status
    totalInvestment
    jackpot
    unitBet
    estimatedPrize
    derivedFirstPrizeDiv
    lotteryPrizes {
      type
      winningUnit
      dividend
    }
  }
  drawResult {
    drawnNo
    xDrawnNo
  }
}

query marksixResult($lastNDraw: Int, $startDate: String, $endDate: String, $drawType: LotteryDrawType) {
  lotteryDraws(lastNDraw: $lastNDraw, startDate: $startDate, endDate: $endDate, drawType: $drawType) {
    ...lotteryDrawsFragment
  }
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRange(startDate, endDate, tries = 5) {
  const body = JSON.stringify({
    operationName: 'marksixResult',
    query: GQL,
    variables: { startDate, endDate, drawType: 'All' },
  });
  for (let k = 0; k < tries; k++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (mark-six-archive bot)',
          Origin: 'https://bet.hkjc.com',
          Referer: 'https://bet.hkjc.com/',
        },
        body,
      });
      const json = await res.json();
      if (json && json.data && json.data.lotteryDraws) return json.data.lotteryDraws;
      if (json && json.errors) throw new Error(JSON.stringify(json.errors));
    } catch (err) {
      if (k === tries - 1) throw err;
      await sleep(800 * (k + 1));
    }
  }
  return [];
}

function quarterRanges(fromYear, toYear) {
  const qs = [];
  const parts = [['0101', '0331'], ['0401', '0630'], ['0701', '0930'], ['1001', '1231']];
  for (let y = fromYear; y <= toYear; y++) {
    for (const [a, b] of parts) qs.push([`${y}${a}`, `${y}${b}`]);
  }
  return qs;
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function weekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  return WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function normalize(r) {
  const numbers = (r.drawResult && r.drawResult.drawnNo ? r.drawResult.drawnNo : [])
    .slice()
    .sort((a, b) => a - b);
  const date = (r.drawDate || '').slice(0, 10);
  const pool = r.lotteryPool || {};
  return {
    id: r.id,
    draw: `${String(r.year).slice(2)}/${String(r.no).padStart(3, '0')}`,
    date,
    weekday: weekday(date),
    numbers,
    special: r.drawResult ? r.drawResult.xDrawnNo : null,
    snowball: r.snowballName_ch || null,
    totalInvestment: pool.totalInvestment || null,
    jackpot: pool.jackpot || null,
    firstPrizeDividend: pool.derivedFirstPrizeDiv || null,
  };
}

function isValid(d) {
  if (!d.date || d.date < START_DATE) return false;
  if (!Array.isArray(d.numbers) || d.numbers.length !== 6) return false;
  if (d.special == null) return false;
  const all = [...d.numbers, d.special];
  if (all.some((n) => !Number.isInteger(n) || n < 1 || n > 49)) return false;
  if (new Set(all).size !== 7) return false;
  return true;
}

function todayYYYYMMDD() {
  const n = new Date();
  return `${n.getUTCFullYear()}${String(n.getUTCMonth() + 1).padStart(2, '0')}${String(n.getUTCDate()).padStart(2, '0')}`;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  let existing = [];
  if (existsSync(JSON_PATH)) {
    try { existing = JSON.parse(await readFile(JSON_PATH, 'utf8')); } catch { existing = []; }
  }
  const byId = new Map(existing.map((d) => [d.id, d]));
  const before = byId.size;

  const nowYear = new Date().getUTCFullYear();
  const fullBackfill = existing.length === 0;
  const ranges = fullBackfill
    ? quarterRanges(2002, nowYear)
    : quarterRanges(nowYear - 1, nowYear); // incremental: last 2 years (covers quarter boundaries + late corrections)

  console.log(`${fullBackfill ? 'FULL BACKFILL' : 'INCREMENTAL'} — ${ranges.length} quarter requests`);
  const today = Number(todayYYYYMMDD());
  for (const [sd, ed] of ranges) {
    if (Number(sd) > today) break;
    const rows = await fetchRange(sd, ed);
    let kept = 0;
    for (const r of rows) {
      if (!r || r.status !== 'Result') continue;
      const d = normalize(r);
      if (isValid(d)) { byId.set(d.id, d); kept++; }
    }
    await sleep(200);
  }

  const all = [...byId.values()]
    .filter(isValid)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.draw < b.draw ? -1 : a.draw > b.draw ? 1 : 0));

  await writeFile(JSON_PATH, JSON.stringify(all, null, 2) + '\n');
  const header = 'draw,date,weekday,no1,no2,no3,no4,no5,no6,special';
  const lines = all.map((d) => [d.draw, d.date, d.weekday, ...d.numbers, d.special].join(','));
  await writeFile(CSV_PATH, header + '\n' + lines.join('\n') + '\n');

  console.log(`draws: ${before} -> ${all.length} (added ${all.length - before})`);
  console.log(`range: ${all[0] ? all[0].date : '-'} .. ${all[all.length - 1] ? all[all.length - 1].date : '-'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
