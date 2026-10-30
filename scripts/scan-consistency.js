#!/usr/bin/env node
/**
 * 分店頁一致性掃描 — 屈臣氏酒窖版
 * 改編自 store-page-lifecycle skill 的 scripts/scan-consistency.js
 *
 * 與原版差異：
 *   - 預設 API 指向屈臣氏酒窖（wwhk）
 *   - 資料檔預設 ww-stores.json
 *   - 店號格式允許 3–4 位（屈臣氏為 3 位，如 505、507）
 *   - category 為選填（屈臣氏頁面無店鋪分類）
 *
 * 用法：node scripts/scan-consistency.js [專案目錄]
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const API_URL = process.env.STORE_API
  || 'https://api.watsonswine.com/api/v2/wwhk/stores/watStores?currentPage=0&pageSize=500&isCceOrCc=false&isPayCollect=false&fields=FULL&lang=zh_HK';
const HISTORY_FILE = 'store-history.json';
const DATA_FILE = process.env.STORE_DATA_FILE || 'ww-stores.json';
const STORE_NO_FIELD = 'elabStoreNumber';
const NAME_FIELD = 'displayName';
const CLOSED_DAYS = Number(process.env.STORE_CLOSED_DAYS || 30);

const dir = process.argv[2] || process.cwd();
const histPath = path.join(dir, HISTORY_FILE);
const dataPath = path.join(dir, DATA_FILE);

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

(async () => {
  const resp = await fetch(API_URL, {
    headers: {
      accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Referer: 'https://www.watsonswine.com/zh-hk/store-finder',
    },
  });
  const liveJson = await resp.json();
  const live = new Map((liveJson.stores || []).map(s => [String(s[STORE_NO_FIELD]), (s[NAME_FIELD] || '').trim()]));
  console.log(`① 官方 API 現況: ${live.size} 間`);

  if (!fs.existsSync(histPath)) {
    console.error(`✗ 找不到 ${histPath}（這是漏記錄的根源，請先建立）`);
    process.exit(1);
  }
  const hist = readJson(histPath);
  const histMap = new Map(Object.entries(hist.stores || {}));
  console.log(`② ${HISTORY_FILE}: ${histMap.size} 筆`);

  const everSeen = new Map();
  let commitCount = 0;
  try {
    const log = execSync(`git log --all --format="%H|%ad" --date=format:"%Y-%m-%dT%H:%M:%S" -- ${DATA_FILE}`, {
      cwd: dir, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const commits = log.trim().split('\n').filter(Boolean)
      .map(l => { const [sha, date] = l.split('|'); return { sha, date }; })
      .sort((a, b) => a.date.localeCompare(b.date));
    commitCount = commits.length;
    for (const c of commits) {
      try {
        const buf = execSync(`git show ${c.sha}:${DATA_FILE}`, { cwd: dir, maxBuffer: 50 * 1024 * 1024 });
        const j = JSON.parse(buf.toString('utf8'));
        for (const s of (j.stores || [])) {
          const no = String(s.storeNo || '');
          if (!no) continue;
          const name = (s.nameZh || s.name || '').trim();
          const prev = everSeen.get(no);
          if (!prev) everSeen.set(no, { name, firstSeen: c.date, lastSeen: c.date, names: new Set([name]) });
          else { prev.lastSeen = c.date; prev.names.add(name); }
        }
      } catch { /* skip unreadable commit */ }
    }
  } catch { /* not a git repo */ }
  console.log(`③ git 歷史: ${commitCount} commit, 曾出現店號 ${everSeen.size}`);

  const problems = { missing: [], newStore: [], noRemovedAt: [], revived: [], renamed: [], incomplete: [], badNo: [], logic: [] };

  for (const no of everSeen.keys()) {
    if (!histMap.has(no)) problems.missing.push(`${no} | ${everSeen.get(no).name} | 最後出現 ${everSeen.get(no).lastSeen.slice(0, 10)} | 官方現有:${live.has(no)}`);
  }
  for (const no of live.keys()) if (!histMap.has(no)) problems.newStore.push(`${no} ${live.get(no)}`);

  for (const [no, h] of histMap) {
    const isLive = live.has(no);
    if (!isLive && !h.removedAt) problems.noRemovedAt.push(`${no} ${h.name}`);
    if (isLive && h.removedAt) problems.revived.push(`${no} ${live.get(no)}`);
    const miss = ['name', 'address'].filter(k => !h[k]);
    if (!h.hours) miss.push('hours');
    if (!h.geo || h.geo.lat == null) miss.push('geo');
    if (!h.url) miss.push('url');
    if (!h.district) miss.push('district');
    if (miss.length) problems.incomplete.push(`${no} 缺 ${miss.join(',')}`);
    // 屈臣氏店號為 3 位（505、507…），允許 3–4 位
    if (!/^\d{3,4}$/.test(no)) problems.badNo.push(no);
    if (h.removedAt && h.lastSeen && new Date(h.removedAt) < new Date(h.lastSeen)) {
      problems.logic.push(`${no}: removedAt(${h.removedAt.slice(0, 10)}) < lastSeen(${h.lastSeen.slice(0, 10)})`);
    }
  }

  for (const [no, e] of everSeen) if (e.names.size > 1) problems.renamed.push(`${no}: ${[...e.names].join(' → ')}`);

  const now = Date.now();
  const removedList = [...histMap.entries()].filter(([no]) => !live.has(no))
    .map(([no, h]) => {
      const days = h.removedAt ? Math.floor((now - new Date(h.removedAt)) / 86400000) : null;
      return `  ${no} | ${h.name} | removedAt ${h.removedAt ? h.removedAt.slice(0, 10) : 'null'} | ${days == null ? '未標記' : `已移除 ${days} 天 → ${days > CLOSED_DAYS ? '已閉店' : '已移除≤' + CLOSED_DAYS + '天'}`}`;
    });

  console.log('\n=== C. 歷史檔有、官方已無（已移除）===');
  console.log(removedList.length ? removedList.join('\n') : '  無');

  const sections = [
    ['A. 曾出現但歷史檔漏記錄', problems.missing],
    ['B. 官方有但歷史檔沒有（新店）', problems.newStore],
    ['D. 官方已無但 removedAt 未設定', problems.noRemovedAt],
    ['F. 官方有但標記已移除（需復活）', problems.revived],
    ['E. 店名變更', problems.renamed],
    ['G. 欄位不完整', problems.incomplete],
    ['H. 店號格式異常', problems.badNo],
    ['I. removedAt < lastSeen', problems.logic],
  ];
  let total = 0;
  for (const [title, list] of sections) {
    console.log(`\n=== ${title} ===`);
    if (list.length) { list.forEach(x => console.log('  ⚠️ ' + x)); total += list.length; }
    else console.log('  無 ✅');
  }

  const active = [...histMap.values()].filter(h => !h.removedAt).length;
  const removed = [...histMap.values()].filter(h => h.removedAt && Math.floor((now - new Date(h.removedAt)) / 86400000) <= CLOSED_DAYS).length;
  const closed = [...histMap.values()].filter(h => h.removedAt && Math.floor((now - new Date(h.removedAt)) / 86400000) > CLOSED_DAYS).length;

  console.log('\n=== 統計 ===');
  console.log(`  歷史檔總筆數: ${histMap.size} | 在架: ${active} | 已移除≤${CLOSED_DAYS}天: ${removed} | 已閉店: ${closed}`);

  if (fs.existsSync(dataPath)) {
    const prod = readJson(dataPath);
    const prodArr = prod.stores || [];
    console.log(`  產出檔 ${DATA_FILE}: count=${prod.count} | stores=${prodArr.length}`);
    const prodActive = prodArr.filter(s => s.state === 'active').map(s => String(s.storeNo));
    const liveOnly = [...live.keys()].filter(no => !prodActive.includes(no));
    const prodOnly = prodActive.filter(no => !live.has(no));
    console.log('  官方有但產出缺:', liveOnly.length ? liveOnly.join(',') : '無 ✅');
    console.log('  產出標 active 但官方無:', prodOnly.length ? prodOnly.join(',') : '無 ✅');
    total += liveOnly.length + prodOnly.length;
  }

  console.log(`\n=== 總結 ===`);
  console.log(total === 0 ? '✅ 全部檢查通過，無異常' : `⚠️ 共 ${total} 項異常，請修正`);
  process.exit(total === 0 ? 0 : 2);
})();
