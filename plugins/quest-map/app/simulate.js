#!/usr/bin/env node
// 不用開 Claude Code，也能看桌面寵物動起來：送一串假的 hook 事件。用法：npm run demo（先 npm start）
// 加 --sessions 2 會模擬兩個專案（club-signup、blog）同時在跑，其中 blog 中途會等你。
// 加 --small 會模擬「請 Claude 改一個小東西」：沒有待辦清單，只看得到工具動作。
'use strict';
const http = require('http');
const nums = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
const gap = nums[0] || 2500;
const two = process.argv.includes('--sessions');
const small = process.argv.includes('--small');
const send = (e, who = { session_id: 'demo', cwd: '/demo/club-signup' }) => new Promise(ok => {
  const req = http.request({ host: '127.0.0.1', port: Number(process.env.QUEST_PET_PORT) || 47600, path: '/hook', method: 'POST' }, r => { r.resume(); r.on('end', ok); });
  req.on('error', err => { console.error('連不上闖關地圖，請先 npm start。', err.message); process.exit(1); });
  req.end(JSON.stringify({ ...who, project_dir: who.cwd, ...e }));
});
const todos = (...rows) => ({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: rows.map(([content, status]) => ({ content, status, activeForm: content })) } });
const P = 'pending', D = 'in_progress', C = 'completed';
const steps = [
  { hook_event_name: 'UserPromptSubmit', prompt: '幫我做報名表單，報名成功後要寄確認信' },
  todos(['設計報名欄位', D], ['做出表單畫面', P], ['存下報名資料', P], ['寄確認信', P], ['測試整個流程', P]),
  todos(['設計報名欄位', C], ['做出表單畫面', D], ['存下報名資料', P], ['寄確認信', P], ['測試整個流程', P]),
  todos(['設計報名欄位', C], ['做出表單畫面', C], ['存下報名資料', D], ['寄確認信', P], ['測試整個流程', P]),
  { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' },
  { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {} },
  { hook_event_name: 'UserPromptSubmit', prompt: '想讓報名的人可以上傳大頭照' },
  todos(['設計報名欄位', C], ['做出表單畫面', D], ['存下報名資料', C], ['上傳大頭照', P], ['寄確認信', P], ['測試整個流程', P]),
  todos(['設計報名欄位', C], ['做出表單畫面', C], ['存下報名資料', C], ['上傳大頭照', C], ['寄確認信', D], ['測試整個流程', P]),
  { hook_event_name: 'UserPromptSubmit', prompt: '確認信不要了，改成傳 LINE 通知我就好' },
  todos(['設計報名欄位', C], ['做出表單畫面', C], ['存下報名資料', C], ['上傳大頭照', C], ['LINE 通知', D], ['測試整個流程', P]),
  todos(['設計報名欄位', C], ['做出表單畫面', C], ['存下報名資料', C], ['上傳大頭照', C], ['LINE 通知', C], ['測試整個流程', C]),
  { hook_event_name: 'Stop', last_assistant_message: '報名表單完成了。' }
];
const A = { session_id: 'demo', cwd: '/demo/club-signup' }, B = { session_id: 'demo-blog', cwd: '/demo/blog' };
const stepsB = [
  { hook_event_name: 'UserPromptSubmit', prompt: '幫我把第一篇文章的草稿寫完' },
  todos(['列出文章大綱', D], ['寫開頭', P], ['寫中段', P], ['寫結尾', P]),
  todos(['列出文章大綱', C], ['寫開頭', C], ['寫中段', D], ['寫結尾', P]),
  { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Edit' },
  { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: {} },
  todos(['列出文章大綱', C], ['寫開頭', C], ['寫中段', C], ['寫結尾', C]),
  { hook_event_name: 'Stop', last_assistant_message: '草稿寫完了。' }
];
const pre = (tool, input) => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
const post = (tool, input) => ({ hook_event_name: 'PostToolUse', tool_name: tool, tool_input: input });
const stepsSmall = [
  { hook_event_name: 'UserPromptSubmit', prompt: '把送出按鈕改成紅色' },
  pre('Read', { file_path: '/demo/club-signup/index.html' }), post('Read', { file_path: '/demo/club-signup/index.html' }),
  pre('Grep', { pattern: 'button' }), post('Grep', { pattern: 'button' }),
  pre('Edit', { file_path: '/demo/club-signup/style.css' }), post('Edit', { file_path: '/demo/club-signup/style.css' }),
  pre('Edit', { file_path: '/demo/club-signup/index.html' }), post('Edit', { file_path: '/demo/club-signup/index.html' }),
  pre('Bash', { command: 'npm test' }), post('Bash', { command: 'npm test' }),
  { hook_event_name: 'Stop', last_assistant_message: '## 完成\n已經把送出按鈕改成紅色，改了 style.css 和 index.html。' }
];
(async () => {
  if (small) {
    for (const st of stepsSmall) { await send(st); console.log('→', st.hook_event_name, st.tool_name || st.prompt || ''); await new Promise(r => setTimeout(r, gap)); }
    return;
  }
  if (two) {
    // 兩個專案交錯：A 一步、B 一步
    const n = Math.max(steps.length, stepsB.length);
    for (let i = 0; i < n; i++) {
      for (const [list, who] of [[steps, A], [stepsB, B]]) {
        const st = list[i]; if (!st) continue;
        await send(st, who); console.log('→', who.cwd.split('/').pop(), st.hook_event_name, st.tool_name || st.prompt || st.message || '');
        await new Promise(r => setTimeout(r, gap / 2));
      }
    }
    return;
  }
  for (const s of steps.slice(0, nums[1] || steps.length)) { await send(s); console.log('→', s.hook_event_name, s.tool_name || s.prompt || s.message || ''); await new Promise(r => setTimeout(r, gap)); }
})();
