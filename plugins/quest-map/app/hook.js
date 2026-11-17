#!/usr/bin/env node
// Claude Code hook：把事件原封不動轉給桌面上的闖關地圖。地圖沒開就安靜結束，絕不擋住 Claude Code。
'use strict';
const http = require('http');
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
  try { out = JSON.stringify({ ...JSON.parse(body), project_dir: process.env.CLAUDE_PROJECT_DIR || undefined }); } catch { /* 原樣轉送 */ }
  req.end(out);
});
setTimeout(bye, 1500);
