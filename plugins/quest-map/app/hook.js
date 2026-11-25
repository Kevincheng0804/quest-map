#!/usr/bin/env node
// Claude Code hook：把事件原封不動轉給桌面上的闖關地圖。地圖沒開就安靜結束，絕不擋住 Claude Code。
'use strict';
const http = require('http');
const fs = require('fs');
const { isRemote } = require('./runtime');
const { detectSpecPath, readSpecTasks, probe, MAX_BYTES } = require('./spec-tasks');
const HOOK_VERSION = (() => { try { return require('./package.json').version; } catch { return null; } })();
const { planFileOk } = require('./plan-md');
// 雲端的工作階段連不到使用者電腦上的地圖，不用等逾時，直接結束
if (isRemote()) process.exit(0);
// 找得到這個事件指向的規格任務檔（OpenSpec／Spectra 等的 tasks.md）時，在本機讀檔、解析，只送分組標題、短標題與勾選狀態；
// 另外送 spec_path 讓地圖記住（只在本機用來之後重讀，不會顯示或輸出）
function specInfo(ev) {
  const root = process.env.CLAUDE_PROJECT_DIR || ev.cwd;
  const found = detectSpecPath(ev, { fs, root });
  if (found && found.ambiguous) return { spec_ambiguous: found.ambiguous, spec_candidates: found.candidates, spec_probe: { ...probe(ev, root, { fs }), candidates: found.ambiguous } };   // 有好幾個進行中的變更：不猜，把候選交給地圖等線索
  const spec = found ? readSpecTasks(found.path, { fs }) : null;
  if (spec) return { spec_tasks: spec, spec_path: found.path, spec_why: found.why };
  // 說話時沒找到任務檔：附上診斷（資料夾名稱與數量），/stats 才看得出為什麼沒抓到
  return ev.hook_event_name === 'UserPromptSubmit' ? { spec_probe: { ...probe(ev, root, { fs }), foundButUnreadable: !!found } } : {};
}
// 計畫模式核准後，計畫文字通常就在 tool_input.plan；沒有的話，從 tool_input／tool_response 找 .claude/plans 底下的檔案路徑讀進來
function planInfo(ev) {
  try {
    if (ev.tool_name !== 'ExitPlanMode' || (ev.tool_input && ev.tool_input.plan)) return {};
    const hay = JSON.stringify([ev.tool_input, ev.tool_response]);
    const m = hay.match(/(?:[A-Za-z]:)?[^"\s]*[\\\/]\.claude[\\\/]plans[\\\/][^"\s]+?\.md/i) || hay.match(/(?:[A-Za-z]:)?[^"]*?\.claude(?:\\\\|\/)plans(?:\\\\|\/)[^"]+?\.md/i);
    if (!m) return {};
    const file = m[0].replace(/\\\\/g, '\\');
    if (!planFileOk(file) || fs.statSync(file).size > MAX_BYTES) return {};
    return { plan_md: fs.readFileSync(file, 'utf8') };
  } catch { return {}; }
}
let body = '';
const bye = () => process.exit(0);
process.stdin.on('data', c => { body += c; }).on('end', () => {
  const req = http.request({
    host: '127.0.0.1', port: Number(process.env.QUEST_PET_PORT) || 47600, path: '/hook', method: 'POST',
    headers: { 'content-type': 'application/json' }, timeout: 800
  }, res => { res.resume(); res.on('end', bye); });
  req.on('error', bye);
  req.on('timeout', () => { req.destroy(); bye(); });
  // 補上專案資料夾，闖關地圖靠它分辨是哪個專案的對話
  let out = body;
  try {
    const ev = JSON.parse(body);
    out = JSON.stringify({ ...ev, project_dir: process.env.CLAUDE_PROJECT_DIR || undefined, hook: HOOK_VERSION, ...specInfo(ev), ...planInfo(ev) });
  } catch { /* 原樣轉送 */ }
  req.end(out);
});
setTimeout(bye, 1500);
