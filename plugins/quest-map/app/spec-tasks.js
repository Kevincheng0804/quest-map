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

// 要找的資料夾清單：專案資料夾、git worktree 的主專案、再往上最多 3 層（Claude 的 cwd 可能比專案深或淺，Spectra 可能在 worktree 裡跑）
function projectRoots(root, { fs = require('fs') } = {}) {
  if (!root) return [];
  const norm = p => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const out = [norm(root)];
  try {   // worktree 的 .git 是一個檔案：gitdir: <主專案>/.git/worktrees/<名稱>
    const g = `${out[0]}/.git`;
    if (fs.statSync(g).isFile()) {
      const m = fs.readFileSync(g, 'utf8').match(/gitdir:\s*(.+?)\s*$/m);
      const main = m && norm(m[1]).match(/^(.*)\/\.git\/worktrees\/[^/]+$/);
      if (main && !out.includes(main[1])) out.push(main[1]);
    }
  } catch { /* 不是 worktree */ }
  let cur = out[0];
  for (let i = 0; i < 3; i++) {
    const up = cur.replace(/\/[^/]*$/, '');
    if (!up || up === cur || /^[A-Za-z]:$/.test(up)) break;
    if (!out.includes(up)) out.push(up);
    cur = up;
  }
  return out;
}

// 提示裡沒有名稱、Claude 也還沒碰到檔案時：找「目前進行中」的變更。
// 1. Spectra 在 .spectra/changes/<名稱>.started 留的進行中標記；2. 常見位置底下還有未勾選項目的 change（排除 archive）。
// tasks.md 已經全部勾完的不算（那是已完成的變更，不是這一輪的任務）。多個時取最近修改的。
// 所有「進行中」的候選變更（tasks.md 還有未勾選項目）：Spectra 的 .started 標記指到的，加上常見位置底下的 change（排除 archive）。
// 已經全部勾完的不算；依最近修改排序。
function activeCandidates(roots, { fs = require('fs') } = {}) {
  const list = Array.isArray(roots) ? roots : [roots];
  const mt = p => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
  const pending = t => { const spec = readSpecTasks(t, { fs }); return !!spec && spec.groups.some(g => g.items.some(i => !i.done)); };
  const out = new Map();
  for (const root of list) {
    if (!root) continue;
    const base = String(root).replace(/[\\/]+$/, '');
    try {
      for (const f of fs.readdirSync(`${base}/.spectra/changes`)) {
        if (!/\.started$/.test(f)) continue;
        const t = findByName(base, f.replace(/\.started$/, ''), { fs });
        if (t && !out.has(t) && pending(t)) out.set(t, mt(t));
      }
    } catch { /* 沒有標記 */ }
    for (const k of ['docs/spectra/changes', 'openspec/changes', '.spectra/changes', 'spectra/changes', 'changes']) {
      let dirs; try { dirs = fs.readdirSync(`${base}/${k}`, { withFileTypes: true }); } catch { continue; }
      for (const d of dirs) {
        if (!d.isDirectory() || /^archive/i.test(d.name)) continue;
        const t = `${base}/${k}/${d.name}/tasks.md`;
        if (!out.has(t) && mt(t) && pending(t)) out.set(t, mt(t));
      }
    }
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}
// 剛好一個候選才綁（why active-change）；兩個以上不猜，回報 { ambiguous, candidates }
function activeChange(roots, opts = {}) {
  const c = activeCandidates(roots, opts);
  if (c.length === 1) return { path: c[0], why: 'active-change' };
  return c.length > 1 ? { ambiguous: c.length, candidates: c.slice(0, 8) } : null;
}

// 被碰的檔案，有沒有寫在這份 tasks.md 的原文裡（最後兩段路徑，或夠長、不普通的檔名）
const COMMON_FILES = new Set(['index.ts', 'index.js', 'index.tsx', 'index.jsx', 'main.ts', 'main.js', 'readme.md', 'package.json', 'package-lock.json', 'tsconfig.json', 'style.css', 'styles.css', 'app.tsx', 'app.ts', 'app.js']);
function mentionsFile(text, file) {
  const parts = String(file || '').replace(/\\/g, '/').split('/').filter(Boolean);
  const base = (parts[parts.length - 1] || '').toLowerCase();
  if (!base) return false;
  const hay = String(text || '').replace(/\\/g, '/').toLowerCase();
  if (parts.length >= 2 && hay.includes((parts[parts.length - 2] + '/' + parts[parts.length - 1]).toLowerCase())) return true;
  return base.length >= 6 && !COMMON_FILES.has(base) && hay.includes(base);
}

// 提示裡可能的 change 名稱：kebab-case 的詞（add-array-reference-scenario）
const promptNames = prompt => [...new Set(String(prompt || '').match(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+/g) || [])].filter(x => x.length >= 5 && !/^(?:spectra|openspec|opsx|speckit)-/i.test(x)).slice(0, 5);   // 指令名稱（/spectra-apply）不是 change 名稱

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
      const roots = projectRoots(root, { fs });
      for (const n of promptNames(ev.prompt)) {
        for (const r of roots) { const t = findByName(r, n, { fs }); if (t) return { path: t, why: 'prompt-name' }; }
      }
      return activeChange(roots, { fs });   // 找不到名稱：找進行中的變更（兩個以上不猜）
    }
  } catch { /* 找不到就當沒這回事 */ }
  return null;
}

// 沒找到任務檔時的診斷（只有資料夾名稱、版本、布林與數量，沒有完整路徑與提示內容）
function probe(ev, root, { fs = require('fs') } = {}) {
  const roots = projectRoots(root, { fs });
  const known = [], isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  for (const r of roots) for (const k of KNOWN_ROOTS) if (isDir(`${r}/${k}`) && !known.includes(k)) known.push(k);
  let started = 0;
  for (const r of roots) { try { started += fs.readdirSync(`${r}/.spectra/changes`).filter(f => /\.started$/.test(f)).length; } catch { /* 沒有 */ } }
  let worktree = false;
  try { worktree = !!roots[0] && fs.statSync(`${roots[0]}/.git`).isFile(); } catch { /* 不是 */ }
  return { root: String(roots[0] || '').split('/').pop() || null, roots: roots.length, names: promptNames(ev.prompt).length, known, started, worktree };
}

module.exports = { activeCandidates, mentionsFile, projectRoots, probe, specTasksName, parseTasks, itemTitle, MAX_BYTES, readSpecTasks, siblingTasks, findByName, promptNames, detectSpecPath, activeChange };
