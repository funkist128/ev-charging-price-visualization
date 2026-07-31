#!/usr/bin/env node
/* 檢查台電電價表是否已調整
 *
 * 從台電「電價表」頁面抓最新的《詳細電價表》PDF，解析「表燈（住商）→ 時間電價 →
 * 簡易型時間電價 →（1）二段式」的費率，與本專案 rates.js 的數字比對。
 *
 * 台電電價每年 4/1、10/1 檢討，沒有公開 API，所以只能定期比對 PDF。
 *
 * 需要 pdftotext（poppler-utils）。
 * 輸出：GITHUB_OUTPUT 的 status = ok | changed | parse-failed | fetch-failed
 *      報告寫入 rate-check-report.md
 */

import { readFileSync, writeFileSync, appendFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RATE_PAGE = 'https://www.taipower.com.tw/2289/2290/46940/';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** 二段式表格內數字的出現順序（pdftotext -layout 由上而下、由左而右） */
const FIELDS = [
  { key: 'base', label: '基本電費（每戶每月）' },
  { key: 'summerPeak', label: '夏月尖峰' },
  { key: 'nonSummerPeak', label: '非夏月尖峰' },
  { key: 'summerOffpeak', label: '夏月離峰' },
  { key: 'nonSummerOffpeak', label: '非夏月離峰' },
  { key: 'weekendSummer', label: '週六日・夏月' },
  { key: 'weekendNonSummer', label: '週六日・非夏月' },
  { key: 'over2000', label: '每月超過 2,000 度加收' },
];

function loadLocalRates() {
  const src = readFileSync(new URL('../rates.js', import.meta.url), 'utf8');
  const window = {};
  new Function('window', src)(window);
  return window.RATE_DATA;
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: RATE_PAGE } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** 台電的 PDF 連結含隨機路徑（/media/xtofy2yw/…），每次改版都會變，所以從頁面現抓。 */
async function findDetailPdfUrl() {
  const html = (await fetchBuffer(RATE_PAGE)).toString('utf8');
  const hrefs = [...html.matchAll(/href="([^"]*\.pdf[^"]*)"/g)].map((m) => m[1]);
  const hit = hrefs.find((h) => decodeURIComponent(h).includes('詳細電價表'));
  if (!hit) {
    throw new Error(`頁面找不到「詳細電價表」PDF 連結，現有連結：${hrefs.join(', ') || '(無)'}`);
  }
  return new URL(hit, RATE_PAGE).href;
}

function pdfToText(buf) {
  const dir = mkdtempSync(join(tmpdir(), 'taipower-'));
  const pdf = join(dir, 'rates.pdf');
  writeFileSync(pdf, buf);
  execFileSync('pdftotext', ['-layout', pdf, join(dir, 'rates.txt')]);
  return readFileSync(join(dir, 'rates.txt'), 'utf8');
}

/** 切出「簡易型時間電價 →（1）二段式」表格，取出其中的費率數字。 */
function parseSimpleTwoTier(text) {
  const simpleStart = text.indexOf('1.簡易型時間電價');
  const standardStart = text.indexOf('2.標準型時間電價');
  if (simpleStart < 0 || standardStart <= simpleStart) {
    throw new Error('找不到「1.簡易型時間電價」～「2.標準型時間電價」區塊');
  }
  const simple = text.slice(simpleStart, standardStart);

  const twoTierStart = simple.search(/\(1\)\s*二\s*段\s*式/);
  const threeTierStart = simple.search(/\(2\)\s*三\s*段\s*式/);
  if (twoTierStart < 0 || threeTierStart <= twoTierStart) {
    throw new Error('找不到「(1)二段式」～「(2)三段式」區塊');
  }
  const block = simple.slice(twoTierStart, threeTierStart);

  const nums = [...block.matchAll(/\d+\.\d{2}/g)].map((m) => Number(m[0]));
  if (nums.length !== FIELDS.length) {
    throw new Error(
      `二段式表格預期 ${FIELDS.length} 個費率數字，實際取到 ${nums.length} 個：${nums.join(', ')}`
    );
  }

  const parsed = Object.fromEntries(FIELDS.map((f, i) => [f.key, nums[i]]));

  // 表格自我檢查：週六日費率本來就等於平日離峰，不相等代表版面變了、位置對應錯亂
  if (
    parsed.weekendSummer !== parsed.summerOffpeak ||
    parsed.weekendNonSummer !== parsed.nonSummerOffpeak
  ) {
    throw new Error(`欄位對應異常，週六日費率與平日離峰不符：${JSON.stringify(parsed)}`);
  }
  return { parsed, block };
}

function compare(local, parsed) {
  const surcharge = local.surcharges.find((s) => s.key === 'over2000');
  const expected = {
    summerPeak: local.taipower.summer.peak,
    nonSummerPeak: local.taipower.nonSummer.peak,
    summerOffpeak: local.taipower.summer.offpeak,
    nonSummerOffpeak: local.taipower.nonSummer.offpeak,
    over2000: surcharge ? surcharge.amount : null,
  };
  return FIELDS.filter((f) => f.key in expected).map((f) => ({
    label: f.label,
    ours: expected[f.key],
    theirs: parsed[f.key],
    same: expected[f.key] === parsed[f.key],
  }));
}

function emit(status, report) {
  writeFileSync(new URL('../rate-check-report.md', import.meta.url), report);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `status=${status}\n`);
  }
  console.log(`status=${status}\n`);
  console.log(report);
}

async function main() {
  const local = loadLocalRates();
  let pdfUrl;
  try {
    pdfUrl = await findDetailPdfUrl();
    var text = pdfToText(await fetchBuffer(pdfUrl));
  } catch (err) {
    emit(
      'fetch-failed',
      `## 抓不到台電電價表\n\n無法從 ${RATE_PAGE} 取得《詳細電價表》PDF。\n\n\`\`\`\n${err.message}\n\`\`\`\n\n台電網站可能改版或暫時無法連線，請人工確認 <${RATE_PAGE}>。`
    );
    return;
  }

  let parsed, block;
  try {
    ({ parsed, block } = parseSimpleTwoTier(text));
  } catch (err) {
    emit(
      'parse-failed',
      `## 台電電價表解析失敗\n\n來源：<${pdfUrl}>\n\n\`\`\`\n${err.message}\n\`\`\`\n\n` +
        `台電可能改了電價表的版面，或費率結構有變動。請人工開啟 PDF 對照 \`rates.js\`，` +
        `必要時同步修改 \`scripts/check-taipower-rates.mjs\` 的解析規則。`
    );
    return;
  }

  const rows = compare(local, parsed);
  const diffs = rows.filter((r) => !r.same);
  const table = [
    '| 項目 | rates.js | 台電現行 | |',
    '|---|---:|---:|:--|',
    ...rows.map((r) => `| ${r.label} | ${r.ours.toFixed(2)} | ${r.theirs.toFixed(2)} | ${r.same ? '✅' : '⚠️ 已調整'} |`),
  ].join('\n');

  if (diffs.length === 0) {
    emit('ok', `## 台電電價未調整\n\n來源：<${pdfUrl}>\n\n${table}\n`);
    return;
  }

  emit(
    'changed',
    `## 台電電價已調整，請更新 \`rates.js\`\n\n來源：<${pdfUrl}>\n\n${table}\n\n` +
      `### 要改的地方\n\n` +
      `1. \`rates.js\` 的 \`taipower\` 四個單價與 \`surcharges\` 的超額電費\n` +
      `2. \`rates.js\` 的 \`source.effectiveLabel\`（改成新的生效日）\n` +
      `3. \`RATES-SOURCE.md\` 的逐字引用\n\n` +
      `社區充電管理費（目前 ${
        (local.surcharges.find((s) => s.key === 'management') || { amount: 0 }).amount.toFixed(2)
      } 元/度）不隨台電調整，除非管委會另行公告。\n\n` +
      `<details><summary>台電 PDF 原始表格文字</summary>\n\n\`\`\`\n${block.trim()}\n\`\`\`\n\n</details>`
  );
}

main().catch((err) => {
  emit('fetch-failed', `## 檢查腳本異常\n\n\`\`\`\n${err.stack || err.message}\n\`\`\``);
});
