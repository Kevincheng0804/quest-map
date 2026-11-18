'use strict';
// 規格驅動工具（OpenSpec／Spectra、Spec Kit、Kiro）的任務檔 tasks.md：認出它、解析成「分組 → 勾選項」。
// 只在本機解析，只取標題與勾選狀態；hook.js 和測試共用。
const MAX_BYTES = 200 * 1024, MAX_ITEMS = 200;

// 路徑是不是任務檔：…/changes/<名稱>/tasks.md、…/specs/<名稱>/tasks.md（含 .kiro/specs）
function specTasksName(p) {
  const s = String(p || '').replace(/\\/g, '/');
  const m = s.match(/\/(?:changes|specs)\/([^/]+)\/tasks\.md$/i);
  return m ? m[1] : null;
}

const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// 項目文字很長（整段說明在同一行）：去掉編號與 [after: …]，取第一句當標題
function itemTitle(raw) {
  let t = String(raw || '').replace(/\[after:[^\]]*\]/gi, ' ').replace(/^\s*(?:[A-Za-z]\d+|\d+(?:\.\d+)*)[.)]?\s+/, '');
  const cut = t.search(/[：:。]/);
  if (cut > 0) t = t.slice(0, cut);
  return short(t, 30);
}

// 回傳 { groups: [{ title, items: [{ text, done }] }] }；沒有任何勾選項時 groups 是空的
function parseTasks(text) {
  const groups = [];
  let cur = null, n = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    const h = line.match(/^#{2,3}\s+(.*\S)\s*$/);
    if (h) { cur = { title: short(h[1].replace(/^\d+(?:\.\d+)*[.)]?\s*/, ''), 40), items: [] }; groups.push(cur); continue; }
    const c = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*\S)\s*$/);
    if (!c) continue;
    if (n >= MAX_ITEMS) break;
    if (!cur) { cur = { title: '', items: [] }; groups.push(cur); }
    cur.items.push({ text: itemTitle(c[2]) || '…', done: c[1] !== ' ' });
    n++;
  }
  return { groups: groups.filter(g => g.items.length) };
}

module.exports = { specTasksName, parseTasks, itemTitle, MAX_BYTES };
