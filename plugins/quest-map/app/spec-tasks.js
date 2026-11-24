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
  return short(t, 36);
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

// 讀檔並解析；太大、讀不到、沒有勾選項都回傳 null
function readSpecTasks(file, { fs = require('fs') } = {}) {
  try {
    const name = specTasksName(file);
    if (!name || fs.statSync(file).size > MAX_BYTES) return null;
    const { groups } = parseTasks(fs.readFileSync(file, 'utf8'));
    return groups.length ? { name, groups } : null;
  } catch { return null; }
}

// 路徑在某個 change 資料夾裡（proposal.md、design.md、specs/…都算）→ 同資料夾的 tasks.md
function siblingTasks(p) {
  const s = String(p || '').replace(/\\/g, '/');
  const m = s.match(/^(.*?\/(?:changes|specs)\/[^/]+)(?:\/|$)/i);   // 取最前面的那一層（changes/<名稱>/specs/… 裡的 specs 不算）
  return m ? m[1] + '/tasks.md' : null;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '__pycache__', '.venv']);
// 在專案資料夾底下找 …/changes|specs/<name>/tasks.md（限制深度與數量，免得掃太久）
const KNOWN_ROOTS = ['docs/spectra/changes', '.spectra/changes', 'spectra/changes', 'openspec/changes', 'docs/openspec/changes', 'changes', 'docs/changes', '.kiro/specs', 'specs', 'docs/specs'];
function findByName(root, name, { fs = require('fs'), maxDepth = 6, maxEntries = 20000 } = {}) {
  if (!root || !name) return null;
  const base = String(root).replace(/[\\/]+$/, '');
  // 先直接看常見的位置（最快，也不怕專案很大）
  for (const k of KNOWN_ROOTS) {
    const t = `${base}/${k}/${name}/tasks.md`;
    try { if (fs.statSync(t).isFile()) return t; } catch { /* 這個位置沒有 */ }
  }
  const queue = [[String(root), 0]];
  let seen = 0;
  while (queue.length && seen < maxEntries) {
    const [dir, depth] = queue.shift();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const d of entries) {
      if (!d.isDirectory() || SKIP_DIRS.has(d.name)) continue;   // 只算資料夾：專案裡成千上萬的檔案（素材等）不該把額度用光
      if (++seen > maxEntries) break;
      const full = dir.replace(/[\\/]+$/, '') + '/' + d.name;
      if (d.name === name && /(?:^|[\\/])(?:changes|specs)$/i.test(dir)) {
        const t = full + '/tasks.md';
        try { if (fs.statSync(t).isFile()) return t; } catch { /* 沒有 tasks.md，繼續找 */ }
      }
      if (depth < maxDepth) queue.push([full, depth + 1]);
    }
  }
  return null;
}

// 提示裡可能的 change 名稱：kebab-case 的詞（add-array-reference-scenario）
const promptNames = prompt => [...new Set(String(prompt || '').match(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+/g) || [])].filter(x => x.length >= 5).slice(0, 5);

// 這個事件有沒有指向某個規格任務檔？回傳 { path, why } 或 null。
// why：read-tasks 直接碰 tasks.md、same-folder 碰同一個 change 資料夾的別的檔案、prompt-name 提示裡有 change 名稱
function detectSpecPath(ev, { fs = require('fs'), root } = {}) {
  try {
    const ti = ev.tool_input || {};
    for (const f of [ti.file_path, ti.path, ti.notebook_path]) {
      if (!f) continue;
      if (specTasksName(f)) return { path: String(f), why: 'read-tasks' };
      const sib = siblingTasks(f);
      if (sib) { try { if (fs.statSync(sib).isFile()) return { path: sib, why: 'same-folder' }; } catch { /* 沒有 tasks.md */ } }
    }
    if (ev.hook_event_name === 'UserPromptSubmit') {
      for (const n of promptNames(ev.prompt)) {
        const t = findByName(root, n, { fs });
        if (t) return { path: t, why: 'prompt-name' };
      }
    }
  } catch { /* 找不到就當沒這回事 */ }
  return null;
}

module.exports = { specTasksName, parseTasks, itemTitle, MAX_BYTES, readSpecTasks, siblingTasks, findByName, promptNames, detectSpecPath };
