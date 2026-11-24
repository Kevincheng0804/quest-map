#!/usr/bin/env node
// Claude Code hook：把事件原封不動轉給桌面上的闖關地圖。地圖沒開就安靜結束，絕不擋住 Claude Code。
'use strict';
const http = require('http');
const fs = require('fs');
const { isRemote } = require('./runtime');
const { detectSpecPath, readSpecTasks } = require('./spec-tasks');
// 雲端的工作階段連不到使用者電腦上的地圖，不用等逾時，直接結束
if (isRemote()) process.exit(0);
// 找得到這個事件指向的規格任務檔（OpenSpec／Spectra 等的 tasks.md）時，在本機讀檔、解析，只送分組標題、短標題與勾選狀態；
// 另外送 spec_path 讓地圖記住（只在本機用來之後重讀，不會顯示或輸出）
function specInfo(ev) {
  const root = process.env.CLAUDE_PROJECT_DIR || ev.cwd;
  const found = detectSpecPath(ev, { fs, root });
  if (!found) return {};
  const spec = readSpecTasks(found.path, { fs });
  return spec ? { spec_tasks: spec, spec_path: found.path, spec_why: found.why } : {};
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
    out = JSON.stringify({ ...ev, project_dir: process.env.CLAUDE_PROJECT_DIR || undefined, ...specInfo(ev) });
  } catch { /* 原樣轉送 */ }
  req.end(out);
});
setTimeout(bye, 1500);
