#!/usr/bin/env node
/**
 * 屈臣氏酒窖 Watsons Wine 分店地址頁（中英雙語）
 * 藍本: https://www.watsonswine.com/zh-hk/store-finder
 * 排版參考: Fortress 分店頁
 * 資料來源: https://api.watsonswine.com/api/v2/wwhk/stores/watStores
 * 用法: node build-ww-store-list.js [輸出目錄]
 *
 * 設計重點：
 * - 分組只保留地區（港島 → 九龍 → 新界 → 澳門），移除分區層級與標題
 * - 卡片：店號 + 中文店名／英文店名 + 中文地址／英文地址（雙語）+ 繁中營業時間
 * - HTML 不含時間戳，資料無變化時不產生任何差異（精準變更偵測）
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = process.argv[2] || __dirname;
const OUT_HTML = path.join(OUT_DIR, 'index.html');
const OUT_JSON = path.join(OUT_DIR, 'ww-stores.json');

const BASE = 'https://api.watsonswine.com/api/v2/wwhk/stores/watStores?currentPage=0&pageSize=500&fields=FULL&isCceOrCc=false&isPayCollect=false';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'application/json',
  Referer: 'https://www.watsonswine.com/zh-hk/store-finder',
};

/** 解析營業時間: ^zt^星期一至日^10am - 8pm → 星期一至日 10am - 8pm */
function parseHours(raw) {
  if (!raw) return '';
  const parts = String(raw).split('^').filter(p => p && p.trim());
  if (parts.length && /^(zt|en)$/i.test(parts[0].trim())) parts.shift();
  const out = [];
  for (let i = 0; i < parts.length; i += 2) {
    const label = parts[i].trim();
    const time = (parts[i + 1] || '').trim();
    out.push(time ? `${label} ${time}` : label);
  }
  return out.join('；');
}

/** 地區名稱（僅保留港島／九龍／新界／澳門） */
function townZh(town) {
  const map = { '香港': '港島', '九龍': '九龍', '新界': '新界', '澳門': '澳門' };
  return map[town] || town || '';
}
function townEn(town) {
  const map = { '香港': 'Hong Kong Island', '九龍': 'Kowloon', '新界': 'New Territories', '澳門': 'Macau' };
  return map[town] || town || '';
}

/** 分區英文 → 繁體中文對照（API 的 district 欄位為英文） */
const DISTRICT_ZH = {
  // 香港島
  'Central': '中環',
  'Admiralty': '金鐘',
  'Wan Chai': '灣仔',
  'Causeway Bay': '銅鑼灣',
  'Sheung Wan': '上環',
  'Taikoo Shing': '太古城',
  'Kennedy Town': '堅尼地城',
  'North Point': '北角',
  'Quarry Bay': '鰂魚涌',
  'Chai Wan': '柴灣',
  'Aberdeen': '香港仔',
  'Happy Valley': '跑馬地',
  'Repulse Bay': '淺水灣',
  // 九龍
  'Tsim Sha Tsui': '尖沙咀',
  'Mong Kok': '旺角',
  'Kowloon Tong': '九龍塘',
  'Kowloon Bay': '九龍灣',
  'Kwun Tong': '觀塘',
  'Hung Hom': '紅磡',
  'Sham Shui Po': '深水埗',
  'Diamond Hill': '鑽石山',
  'Wong Tai Sin': '黃大仙',
  'Yau Tong': '油塘',
  'Austin': '柯士甸',
  'Mei Foo': '美孚',
  // 新界
  'Tsuen Wan': '荃灣',
  'Tuen Mun': '屯門',
  'Yuen Long': '元朗',
  'Sha Tin': '沙田',
  'Tai Po': '大埔',
  'Fanling': '粉嶺',
  'Sheung Shui': '上水',
  'Ma On Shan': '馬鞍山',
  'Tseung Kwan O': '將軍澳',
  'Tsing Yi': '青衣',
  'Tung Chung': '東涌',
  'Tai Wai': '大圍',
  'Tin Shui Wai': '天水圍',
  'Kwai Fong': '葵芳',
  // 澳門
  'TAIPA': '氹仔',
  'Macau': '澳門半島',
  'Taipa': '氹仔',
};
function districtZh(en) {
  const key = String(en || '').trim();
  return DISTRICT_ZH[key] || DISTRICT_ZH[key.toLowerCase() === key ? key : key] || key;
}

async function fetchLang(lang) {
  const r = await fetch(`${BASE}&lang=${lang}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`${lang} HTTP ${r.status}`);
  const j = await r.json();
  return j.stores || [];
}

async function main() {
  console.log('抓取中英雙語店舖資料...');
  const [zhList, enList] = await Promise.all([fetchLang('zh_HK'), fetchLang('en')]);
  console.log(`中文 ${zhList.length} 間 / 英文 ${enList.length} 間`);

  const enMap = new Map(enList.map(s => [s.elabStoreNumber, s]));

  const records = zhList.map(z => {
    const e = enMap.get(z.elabStoreNumber) || {};
    const za = z.address || {};
    const ea = e.address || {};
    return {
      storeNo: z.elabStoreNumber || '',
      nameZh: (z.displayName || '').trim(),
      nameEn: (e.displayName || z.displayName || '').trim(),
      townZh: townZh(za.town),
      townEn: townEn(za.town),
      districtZh: (za.district || '').trim(),
      districtEn: (ea.district || za.district || '').trim(),
      districtCn: districtZh(za.district),
      addressZh: (za.line1 || za.displayAddress1 || '').trim(),
      addressEn: (ea.line1 || ea.displayAddress1 || '').trim(),
      hoursZh: parseHours(z.openingHours && z.openingHours.name),
      phone: (za.phone || za.phone1 || '').trim(),
      features: (z.elabFeatures || []).map(f => ({ code: f.code || '', zh: f.name || '' })),
      geo: z.geoPoint ? { lat: z.geoPoint.latitude, lng: z.geoPoint.longitude } : null,
      url: z.url || '',
    };
  });

  // 排序：地區順序（港島→九龍→新界→澳門）→ 分區 → 英文店名
  const townOrder = ['港島', '九龍', '新界', '澳門'];
  records.sort((a, b) => {
    const ta = townOrder.indexOf(a.townZh), tb = townOrder.indexOf(b.townZh);
    if (ta !== tb) return (ta < 0 ? 99 : ta) - (tb < 0 ? 99 : tb);
    if (a.districtEn !== b.districtEn) return a.districtEn.localeCompare(b.districtEn, 'en');
    return a.nameEn.localeCompare(b.nameEn, 'en');
  });

  // ── 店鋪生命週期（active / removed / closed）────────────────────────────
  const HIST_PATH = path.join(OUT_DIR, 'store-history.json');
  let history = { updatedAt: '', stores: {} };
  try {
    history = JSON.parse(fs.readFileSync(HIST_PATH, 'utf8'));
  } catch {
    history = { updatedAt: '', stores: {} };
  }
  const now = new Date();
  const nowIso = now.toISOString();
  const DAY_MS = 86400000;
  const REMOVED_KEEP_DAYS = 30;

  const merged = new Map();
  // 官方現有 → active（firstSeen 沿用歷史，沒有則記為現在）
  for (const r of records) {
    const h = history.stores[r.storeNo] || {};
    merged.set(r.storeNo, {
      ...r,
      firstSeen: h.firstSeen || nowIso,
      lastSeen: nowIso,
      removedAt: null,
      removedDays: 0,
      state: 'active',
    });
  }
  // 官方已無但歷史有 → removed / closed（removedAt 只設定一次）
  for (const [no, h] of Object.entries(history.stores)) {
    if (merged.has(no)) continue;
    const removedAt = h.removedAt || nowIso;
    const removedDays = Math.max(0, Math.floor((now.getTime() - new Date(removedAt).getTime()) / DAY_MS));
    merged.set(no, {
      storeNo: no,
      nameZh: h.name || '',
      nameEn: h.nameEn || '',
      townZh: h.region || h.town || '',
      districtCn: h.district || '',
      districtEn: h.district || '',
      addressZh: h.address || '',
      addressEn: '',
      hoursZh: h.hours || '',
      phone: '',
      features: [],
      geo: h.geo || null,
      url: h.url || '',
      firstSeen: h.firstSeen || nowIso,
      lastSeen: h.lastSeen || nowIso,
      removedAt,
      removedDays,
      state: removedDays > REMOVED_KEEP_DAYS ? 'closed' : 'removed',
    });
  }

  const allRecords = [...merged.values()];
  const activeRecords = allRecords.filter((r) => r.state !== 'closed');

  // 資料更新日：只在「資料本體 + 狀態」真的改變時更新
  const prev = fs.existsSync(OUT_JSON) ? JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')) : null;
  const fingerprint = JSON.stringify(allRecords.map(({ storeNo, nameZh, townZh, districtCn, addressZh, hoursZh, phone, removedAt, state }) => ({ storeNo, nameZh, townZh, districtCn, addressZh, hoursZh, phone, removedAt, state })));
  const prevFingerprint = prev && prev.stores ? JSON.stringify(prev.stores.map(({ storeNo, nameZh, townZh, districtCn, addressZh, hoursZh, phone, removedAt, state }) => ({ storeNo, nameZh, townZh, districtCn, addressZh, hoursZh, phone, removedAt, state }))) : null;
  const sameAsPrev = prevFingerprint !== null && prevFingerprint === fingerprint;
  const dataUpdated = (sameAsPrev && prev.dataUpdated)
    ? prev.dataUpdated
    : new Date().toLocaleDateString('zh-HK', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Hong_Kong' });

  fs.writeFileSync(OUT_JSON, JSON.stringify({ dataUpdated, count: allRecords.length, stores: allRecords }, null, 2), 'utf8');

  // 寫回歷史（closed 永久保留，不刪）
  const newHistory = { updatedAt: nowIso, stores: {} };
  for (const r of allRecords) {
    newHistory.stores[r.storeNo] = {
      storeNo: r.storeNo,
      name: r.nameZh,
      nameEn: r.nameEn,
      region: r.townZh,
      district: r.districtCn,
      town: r.townZh,
      address: r.addressZh,
      hours: r.hoursZh,
      geo: r.geo,
      url: r.url,
      firstSeen: r.firstSeen,
      lastSeen: r.lastSeen,
      removedAt: r.removedAt,
    };
  }
  fs.writeFileSync(HIST_PATH, JSON.stringify(newHistory, null, 2), 'utf8');

  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  };

  const card = (r) => {
    const mapLink = r.geo ? `https://www.google.com/maps?q=${r.geo.lat},${r.geo.lng}` : '#';
    const feats = r.features.length
      ? `<div class="tags">${r.features.map(f => `<span class="tag" title="${esc(f.code)}">${esc(f.zh || f.code)}</span>`).join('')}</div>`
      : '';
    const stateCls = r.state === 'removed' ? ' is-removed' : r.state === 'closed' ? ' is-closed' : '';
    const badge = r.state === 'removed'
      ? '<span class="badge-removed">原網頁已移除</span>'
      : r.state === 'closed' ? '<span class="badge-closed">已閉店</span>' : '';
    const note = (r.state === 'removed' || r.state === 'closed')
      ? `<div class="removed-note">最後於官方出現：${fmtDate(r.lastSeen)}・${fmtDate(r.removedAt)} 起已移除</div>`
      : '';
    return `<article id="store-${esc(r.storeNo)}" class="store-card${stateCls}" data-town="${esc(r.townZh)}" data-state="${r.state}" data-search="${esc([r.storeNo, r.nameZh, r.nameEn, r.addressZh, r.addressEn, r.districtCn, r.districtEn].join(' ').toLowerCase())}">
  <div class="card-head">
    <span class="store-no">${esc(r.storeNo)}</span>
    <div class="names">
      <div class="name-zh">${esc(r.nameZh)}</div>
      <div class="name-en">${esc(r.nameEn)}</div>
    </div>
    ${badge}
  </div>
  <dl class="fields">
    <div class="field">
      <dt>地址</dt>
      <dd><span class="zh">${esc(r.addressZh)}</span>${r.addressEn ? `<span class="en">${esc(r.addressEn)}</span>` : ''}</dd>
    </div>
    <div class="field">
      <dt>營業時間</dt>
      <dd><span class="zh">${esc(r.hoursZh)}</span></dd>
    </div>
    ${r.phone ? `<div class="field"><dt>電話</dt><dd><span class="zh">${esc(r.phone)}</span></dd></div>` : ''}
  </dl>
  ${feats}
  ${note}
  <div class="links">
    <a href="${mapLink}" target="_blank" rel="noopener">查看地圖</a>
    ${r.url ? `<a href="https://www.watsonswine.com${esc(r.url)}" target="_blank" rel="noopener">官方頁面</a>` : ''}
  </div>
</article>`;
  };

  // 只按地區分組（不設分區層級）
  const grouped = new Map();
  for (const r of activeRecords) {
    if (!grouped.has(r.townZh)) grouped.set(r.townZh, []);
    grouped.get(r.townZh).push(r);
  }
  const sections = [...grouped.entries()].map(([town, list]) => {
    const en = list[0].townEn || '';
    const removedCount = list.filter((r) => r.state === 'removed').length;
    const countLabel = removedCount
      ? `${list.length}（含 ${removedCount} 已移除）`
      : `${list.length}`;
    return `<section class="town"><h2>${esc(town)} <span class="en-title">${esc(en)}</span> <span class="count">${countLabel}</span></h2><div class="cards">${list.map(card).join('\n')}</div></section>`;
  });

  // 頁底「已閉店」區塊（超過 30 天，不列入左側索引）
  const closedRecords = allRecords.filter((r) => r.state === 'closed');
  const closedSection = closedRecords.length
    ? `<section class="closed-section"><h2>已閉店 <span class="en-title">Closed</span> <span class="count">${closedRecords.length}</span></h2><p class="closed-hint">以下分店已從官方網站移除超過 30 天，僅保留記錄供查閱。</p><div class="cards">${closedRecords.map(card).join('\n')}</div></section>`
    : '';

  const towns = [...new Set(activeRecords.map(r => r.townZh))].filter(Boolean);

  // 左側店號索引：依店號升序；含 removed（灰階）、排除 closed
  const indexRows = [...activeRecords]
    .sort((a, b) => Number(a.storeNo) - Number(b.storeNo))
    .map(r => {
      const cls = r.state === 'removed' ? ' class="is-removed"' : '';
      return `<li${cls}><a href="#store-${esc(r.storeNo)}"><span class="ix-no">${esc(r.storeNo)}</span><span class="ix-name">${esc(r.nameZh)}</span><span class="ix-town">${esc(r.districtCn || r.townZh)}</span></a></li>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-HK">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>屈臣氏酒窖 分店地址 | Watsons Wine Store Finder</title>
<meta name="description" content="屈臣氏酒窖 Watsons Wine 全港分店地址、營業時間及電話，中英雙語對照，按地區整理。">
<style>
:root { --primary:#00a3a3; --accent:#0b7d7d; --bg:#fff; --fg:#1f2430; --muted:#6b7280; --card:#fff; --border:#e5e7eb; --tag:#e8f7f7; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f1418; --fg:#e5e7eb; --muted:#9ca3af; --card:#17202a; --border:#2a3540; --tag:#123b3b; } }
* { box-sizing:border-box; margin:0; padding:0; }
html { scroll-padding-top: 96px; scroll-behavior: smooth; }
.store-card { scroll-margin-top: 96px; }
body { font-family:"Segoe UI","PingFang TC","Microsoft JhengHei","Noto Sans TC",sans-serif; background:var(--bg); color:var(--fg); line-height:1.6; padding:1rem; }
header { max-width:1100px; margin:0 auto 1.25rem; }
h1 { font-size:1.5rem; color:var(--primary); }
h1 .en-title { font-size:1rem; color:var(--muted); font-weight:400; }
.sub { color:var(--muted); font-size:.84rem; margin-top:.3rem; }
.layout { display:flex; gap:1.25rem; max-width:1280px; margin:0 auto; align-items:flex-start; }
main { flex:1; min-width:0; }
.sidebar { position:sticky; top:1rem; flex:0 0 240px; max-height:calc(100vh - 2rem); overflow-y:auto; background:var(--card); border:1px solid var(--border); border-radius:.5rem; padding:.7rem .6rem; }
.sidebar h3 { font-size:.85rem; color:var(--accent); margin-bottom:.5rem; padding-bottom:.35rem; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:baseline; }
.index { list-style:none; display:flex; flex-direction:column; gap:.1rem; }
.index a { display:grid; grid-template-columns:44px 1fr auto; gap:.35rem; align-items:baseline; padding:.28rem .35rem; border-radius:.25rem; text-decoration:none; color:var(--fg); font-size:.8rem; }
.index a:hover, .index a:focus { background:var(--tag); }
.ix-no { font-weight:700; color:var(--primary); font-variant-numeric:tabular-nums; }
.ix-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ix-town { color:var(--muted); font-size:.7rem; white-space:nowrap; }
.filters { position:sticky; top:0; z-index:10; background:var(--bg); border:1px solid var(--border); border-radius:.5rem; padding:.8rem .9rem; margin-bottom:1.25rem; display:flex; flex-wrap:wrap; gap:.7rem; align-items:flex-end; box-shadow:0 2px 8px rgba(0,0,0,.06); }
.filters label { display:flex; flex-direction:column; gap:.2rem; font-size:.76rem; color:var(--muted); }
.filters select, .filters input { background:var(--card); color:var(--fg); border:1px solid var(--border); border-radius:.35rem; padding:.38rem .5rem; font-size:.88rem; min-width:150px; }
.filters input { min-width:230px; }
.filter-reset { background:transparent; color:var(--primary); border:1px solid var(--primary); border-radius:.35rem; padding:.38rem .7rem; font-size:.84rem; cursor:pointer; }
.filter-reset:hover { background:var(--primary); color:#fff; }
.filter-count { font-size:.8rem; color:var(--muted); margin-left:auto; align-self:center; }
.town { margin-bottom:2rem; }
.town h2 { font-size:1.2rem; color:var(--accent); border-bottom:2px solid var(--primary); padding-bottom:.3rem; margin-bottom:.7rem; }
.town h2 .en-title { font-size:.82rem; color:var(--muted); font-weight:400; margin-left:.3rem; }
.count { color:var(--muted); font-weight:400; font-size:.82rem; }
.cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:.75rem; }
.store-card { background:var(--card); border:1px solid var(--border); border-radius:.5rem; padding:.85rem .95rem; display:flex; flex-direction:column; gap:.5rem; }
.card-head { display:flex; gap:.6rem; align-items:baseline; }
.store-no { background:var(--primary); color:#fff; font-size:.72rem; font-weight:700; padding:.1rem .4rem; border-radius:.25rem; white-space:nowrap; }
.names { flex:1; }
.name-zh { font-weight:600; font-size:1.02rem; }
.name-en { font-size:.85rem; color:var(--muted); }
.fields { display:flex; flex-direction:column; gap:.4rem; }
.field dt { font-size:.7rem; color:var(--muted); letter-spacing:.03em; }
.field dd { display:flex; flex-direction:column; gap:.05rem; }
.field .zh { font-size:.9rem; }
.field .en { font-size:.8rem; color:var(--muted); }
.tags { display:flex; flex-wrap:wrap; gap:.3rem; }
.tag { background:var(--tag); color:var(--accent); font-size:.7rem; padding:.12rem .45rem; border-radius:.25rem; }
.links { display:flex; gap:.9rem; }
.links a { color:var(--primary); font-size:.82rem; text-decoration:none; }
.links a:hover { text-decoration:underline; }
/* ── 店鋪生命週期狀態 ── */
.store-card.is-removed { border:1px dashed #d9463f; background:repeating-linear-gradient(135deg,transparent,transparent 10px,rgba(217,70,63,.035) 10px,rgba(217,70,63,.035) 20px); }
.badge-removed { background:#d9463f; color:#fff; font-size:.66rem; font-weight:700; padding:.1rem .4rem; border-radius:.25rem; white-space:nowrap; }
.removed-note { font-size:.72rem; color:#d9463f; }
.store-card.is-closed { opacity:.62; filter:grayscale(1); }
.badge-closed { background:var(--muted); color:#fff; font-size:.66rem; font-weight:700; padding:.1rem .4rem; border-radius:.25rem; white-space:nowrap; }
.index li.is-removed { opacity:.55; }
.closed-section { margin-top:2.5rem; padding-top:1.25rem; border-top:2px dashed var(--border); }
.closed-section h2 { font-size:1.1rem; color:var(--muted); margin-bottom:.35rem; }
.closed-section .closed-hint { font-size:.78rem; color:var(--muted); margin-bottom:.75rem; }
footer { max-width:1280px; margin:2rem auto 0; color:var(--muted); font-size:.78rem; border-top:1px solid var(--border); padding-top:.7rem; }
@media (max-width:680px) { .cards { grid-template-columns:1fr; } }
@media (max-width:900px) {
  .layout { display:block; }
  .sidebar { position:static; flex:none; max-height:none; margin-bottom:1rem; }
  .index { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); }
}
</style>
</head>
<body>
<header>
  <h1>屈臣氏酒窖 分店地址 <span class="en-title">Watsons Wine Store Finder</span></h1>
  <div class="sub">資料來源：屈臣氏酒窖官方網站 store finder・資料更新：${dataUpdated}・現有 ${records.length} 間${(() => {
    const removed = allRecords.filter((r) => r.state === 'removed').length;
    const closed = closedRecords.length;
    const parts = [];
    if (removed) parts.push(`${removed} 間已移除（30 天內保留）`);
    if (closed) parts.push(`${closed} 間已閉店`);
    return parts.length ? `・${parts.join('・')}` : '';
  })()}${(() => {
    const newCount = allRecords.filter((r) => r.state === 'active' && new Date(r.firstSeen).getTime() > Date.now() - 86400000).length;
    return newCount ? `・新增 ${newCount} 間` : '';
  })()}</div>
</header>
<div class="layout">
<aside class="sidebar">
  <h3>店號索引 <span class="count">${activeRecords.length}</span></h3>
  <ol class="index">
${indexRows}
  </ol>
</aside>
<main>
<div class="filters">
  <label>地區
    <select id="filter-town">
      <option value="">全部</option>
${towns.map(t => {
  const en = (activeRecords.find(r => r.townZh === t) || {}).townEn || '';
  return `      <option value="${esc(t)}">${esc(t)}${en ? ' ' + esc(en) : ''}</option>`;
}).join('\n')}
    </select>
  </label>
  <label>搜尋
    <input id="filter-search" type="search" placeholder="店名 / 地址（中英文皆可）">
  </label>
  <button type="button" class="filter-reset" id="filter-reset">清除</button>
  <span class="filter-count" id="filter-count">顯示 ${activeRecords.length} 間</span>
</div>
${sections.join('\n')}
${closedSection}
</main>
</div>
<footer>本頁資料自動抓取自屈臣氏酒窖官方網站，僅供參考；實際營業時間以官方為準。店名與地址為中英雙語，其餘欄位採用繁體中文頁資料。<span id="load-time"></span></footer>
<script>
(function () {
  var townSel = document.getElementById('filter-town');
  var searchIn = document.getElementById('filter-search');
  var resetBtn = document.getElementById('filter-reset');
  var countEl = document.getElementById('filter-count');
  // 已閉店卡片位於頁底獨立區塊，不參與篩選
  var allCards = Array.prototype.slice.call(document.querySelectorAll('.store-card'));
  var cards = allCards.filter(function (c) { return c.getAttribute('data-state') !== 'closed'; });
  var towns = Array.prototype.slice.call(document.querySelectorAll('.town'));
  var indexItems = Array.prototype.slice.call(document.querySelectorAll('.index li'));
  var total = cards.length;

  // 本頁載入時間由前端動態產生，不寫入 HTML，避免污染變更偵測
  var lt = document.getElementById('load-time');
  if (lt) lt.textContent = ' 本頁載入時間：' + new Date().toLocaleString('zh-HK');

  function apply() {
    var vTown = townSel.value, vQ = (searchIn.value || '').trim().toLowerCase();
    var shown = 0;
    cards.forEach(function (c) {
      var ok = (!vTown || c.getAttribute('data-town') === vTown) &&
               (!vQ || (c.getAttribute('data-search') || '').indexOf(vQ) !== -1);
      c.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    towns.forEach(function (t) {
      var any = Array.prototype.some.call(t.querySelectorAll('.store-card'), function (x) { return x.style.display !== 'none'; });
      t.style.display = any ? '' : 'none';
    });
    // 左側店號索引跟隨篩選同步顯示
    indexItems.forEach(function (li) {
      var a = li.querySelector('a');
      if (!a) return;
      var target = document.querySelector(a.getAttribute('href'));
      li.style.display = (target && target.style.display !== 'none') ? '' : 'none';
    });
    countEl.textContent = '顯示 ' + shown + ' / ' + total + ' 間';
  }

  townSel.addEventListener('change', apply);
  searchIn.addEventListener('input', apply);
  resetBtn.addEventListener('click', function () {
    townSel.value = ''; searchIn.value = '';
    apply();
  });
})();
</script>
</body>
</html>`;

  fs.writeFileSync(OUT_HTML, html, 'utf8');
  console.log('已寫入:', OUT_HTML, `(${html.length} bytes, ${records.length} 間分店)`);
  console.log('資料更新日:', dataUpdated, sameAsPrev ? '（資料未變，沿用舊日期）' : '（資料已更新）');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

main().catch(e => { console.error('失敗:', e.message); process.exit(1); });
