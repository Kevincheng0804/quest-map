'use strict';
// 地圖主程式端：記住每個對話綁的規格任務檔路徑，之後的事件進來時重讀它（Spectra 介面或 CLI 打勾、Claude 用 Bash 改檔，
// 下一個事件地圖就跟著變）。只接受 …/changes|specs/<名稱>/tasks.md 的路徑，擋掉偽造的本機請求去讀別的檔案。
const { specTasksName, readSpecTasks } = require('./spec-tasks');
const REFRESH_ON = new Set(['PreToolUse', 'PostToolUse', 'Stop']);

function createSpecTracker({ fs = require('fs'), now = Date.now, minGap = 1000 } = {}) {
  const bound = new Map();   // session_id → { path, name, why, at, ok, complete }
  const done = spec => spec.groups.every(g => g.items.every(i => i.done));
  return {
    augment(ev) {
      const id = ev.session_id || 'default', kind = ev.hook_event_name;
      if (kind === 'SessionEnd') { bound.delete(id); delete ev.spec_path; return ev; }
      if (ev.spec_path) {   // hook 剛找到的：記住路徑（格式不對就不收）
        const name = specTasksName(ev.spec_path);
        if (name && ev.spec_tasks) bound.set(id, { path: String(ev.spec_path), name, why: String(ev.spec_why || 'hook'), at: now(), ok: true, complete: done(ev.spec_tasks) });
        else delete ev.spec_tasks;
        delete ev.spec_path; delete ev.spec_why;
        return ev;
      }
      const b = bound.get(id);
      if (!b) return ev;
      // 這個 change 已經全部完成，使用者又開了新的一句話：新的一輪，不要再把舊任務檔塞進來
      if (kind === 'UserPromptSubmit' && b.complete) { bound.delete(id); return ev; }
      if (ev.spec_tasks || !REFRESH_ON.has(kind) || now() - b.at < minGap) return ev;
      b.at = now();
      const spec = readSpecTasks(b.path, { fs });
      b.ok = !!spec;
      if (spec) { ev.spec_tasks = spec; b.why = 'refresh'; b.complete = done(spec); }
      return ev;
    },
    // 排查用：綁了哪個 change、為什麼綁、上次讀檔成不成功（不含路徑與項目文字）
    info() { return [...bound.values()].map(b => ({ change: b.name, why: b.why, ok: b.ok })); }
  };
}
module.exports = { createSpecTracker };
