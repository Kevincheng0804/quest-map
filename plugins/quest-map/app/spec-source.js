'use strict';
// 地圖主程式端：記住每個對話綁的規格任務檔路徑，之後的事件進來時重讀它（Spectra 介面或 CLI 打勾、Claude 用 Bash 改檔，
// 下一個事件地圖就跟著變）。只接受 …/changes|specs/<名稱>/tasks.md 的路徑，擋掉偽造的本機請求去讀別的檔案。
// 有好幾個進行中的變更時不猜：hook 把候選交給這裡，等 Claude 碰到的檔案只出現在其中一個變更的 tasks.md 裡（file-match）才綁。
const { specTasksName, readSpecTasks, mentionsFile } = require('./spec-tasks');
const REFRESH_ON = new Set(['PreToolUse', 'PostToolUse', 'Stop']);
// 線索強度：強的可以換掉弱的，弱的不會覆蓋強的
const STRENGTH = { 'read-tasks': 5, 'prompt-name': 4, 'same-folder': 3, 'file-match': 2, 'active-change': 1 };
const strength = why => STRENGTH[why] || 3;

function createSpecTracker({ fs = require('fs'), now = Date.now, minGap = 1000 } = {}) {
  const bound = new Map();   // session_id → { path, name, why, rank, at, ok, complete }
  const cands = new Map();   // session_id → 候選 tasks.md 路徑（有多個進行中的變更、還沒綁的時候）
  const text = new Map();    // 候選檔的原文快取（路徑 + 修改時間）
  const done = spec => spec.groups.every(g => g.items.every(i => i.done));
  const raw = p => {
    try {
      const m = fs.statSync(p).mtimeMs, c = text.get(p);
      if (c && c.m === m) return c.t;
      const t = fs.readFileSync(p, 'utf8').slice(0, 200 * 1024);
      text.set(p, { m, t }); return t;
    } catch { return ''; }
  };
  const touched = ev => { const ti = ev.tool_input || {}; return ti.file_path || ti.path || ti.notebook_path || ''; };
  const bind = (id, path, why, spec) => bound.set(id, { path, name: specTasksName(path), why, rank: strength(why), at: now(), ok: true, complete: done(spec) });
  return {
    augment(ev) {
      const id = ev.session_id || 'default', kind = ev.hook_event_name;
      if (kind === 'SessionEnd') { bound.delete(id); cands.delete(id); delete ev.spec_path; delete ev.spec_candidates; return ev; }
      // 每一句新的話重新判斷候選：hook 這次有給就換，沒給就清掉（還沒綁的話）
      if (kind === 'UserPromptSubmit' && !ev.spec_path) {
        const list = Array.isArray(ev.spec_candidates) ? ev.spec_candidates.filter(p => specTasksName(p)).slice(0, 8).map(String) : [];
        if (list.length) cands.set(id, list); else cands.delete(id);
      }
      delete ev.spec_candidates;
      const cur = bound.get(id);
      if (ev.spec_path) {   // hook 剛找到的：記住路徑（格式不對就不收；比現有的弱就不覆蓋）
        const why = String(ev.spec_why || 'hook');
        if (cur && strength(why) < cur.rank) { delete ev.spec_path; delete ev.spec_why; delete ev.spec_tasks; return ev; }
        if (specTasksName(ev.spec_path) && ev.spec_tasks) { bind(id, String(ev.spec_path), why, ev.spec_tasks); cands.delete(id); } else delete ev.spec_tasks;
        delete ev.spec_path; delete ev.spec_why;
        return ev;
      }
      // 沒綁（或只是猜的）而且有候選：Claude 碰的檔案只出現在其中一個變更的 tasks.md 裡，就是它
      const list = cands.get(id), f = touched(ev);
      if (list && f && (!cur || cur.rank <= 1) && (kind === 'PreToolUse' || kind === 'PostToolUse')) {
        const hits = list.filter(p => mentionsFile(raw(p), f));
        if (hits.length === 1) {
          const spec = readSpecTasks(hits[0], { fs });
          if (spec) { bind(id, hits[0], 'file-match', spec); cands.delete(id); ev.spec_tasks = spec; return ev; }
        }
      }
      const b = bound.get(id);
      if (!b) { if (list && list.length > 1) ev.spec_ambiguous = list.length; return ev; }   // 讓地圖說明「有 N 個進行中的變更，還不確定是哪一個」
      // 這個 change 已經全部完成，使用者又開了新的一句話：新的一輪，不要再把舊任務檔塞進來
      if (kind === 'UserPromptSubmit' && b.complete) { bound.delete(id); return ev; }
      if (ev.spec_tasks || !REFRESH_ON.has(kind) || now() - b.at < minGap) return ev;
      b.at = now();
      const spec = readSpecTasks(b.path, { fs });
      b.ok = !!spec;
      if (spec) { ev.spec_tasks = spec; b.why = b.why === 'file-match' || b.why === 'active-change' ? b.why : 'refresh'; b.complete = done(spec); }
      return ev;
    },
    // 排查用：綁了哪個 change、為什麼綁、上次讀檔成不成功；還沒綁但有幾個候選（不含路徑與項目文字）
    info() { return [...bound.values()].map(b => ({ change: b.name, why: b.why, ok: b.ok })); },
    ambiguous() { return [...cands.entries()].filter(([id]) => !bound.has(id)).map(([, l]) => l.length); }
  };
}
module.exports = { createSpecTracker };
