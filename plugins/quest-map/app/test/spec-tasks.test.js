'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { specTasksName, parseTasks, itemTitle } = require('../spec-tasks');
const { createSession, createHub } = require('../state');

const SAMPLE = [
  '## 1. 追蹤資料格式 version 2', '',
  '- [x] 1.1 依設計稿擴充資料格式：src/core/tracking/types.ts 加上 version。驗證：npx tsc --noEmit',
  '- [x] 1.2 [after: 1.1] 球員沒有號碼時不配對：matchProfiles 略過 null',
  '',
  '## 2. Python 管線', '',
  '- [x] 2.1 依設計稿建立 Python 專案骨架。驗證：uv run pytest',
  '- [ ] 2.2 [after: 2.1] 實作座標對應',
  '- [ ] 2.3 [after: 2.1, 2.2] 實作平滑',
  '',
  '## 3. 收尾', '',
  '- [ ] 3.1 寫 README'
].join('\n');

test('路徑辨識：OpenSpec／Spectra、Spec Kit、Kiro 的 tasks.md', () => {
  assert.equal(specTasksName('C:\\Users\\me\\proj\\docs\\spectra\\changes\\add-x\\tasks.md'), 'add-x');
  assert.equal(specTasksName('/w/openspec/changes/add-y/tasks.md'), 'add-y');
  assert.equal(specTasksName('/w/specs/001-feature/tasks.md'), '001-feature');
  assert.equal(specTasksName('/w/.kiro/specs/feat/tasks.md'), 'feat');
  assert.equal(specTasksName('/w/docs/tasks.md'), null);
  assert.equal(specTasksName('/w/changes/x/design.md'), null);
});

test('項目標題：去掉編號與 [after]，取第一句，最長 30 字', () => {
  assert.equal(itemTitle('1.1 [after: 1.0] 建立骨架：很長的說明'), '建立骨架');
  assert.equal(itemTitle('T001 Setup project. then more'), 'Setup project. then more');
  assert.equal(itemTitle('2.3 ' + '字'.repeat(60)).length, 30);
});

test('解析：分組、勾選狀態、大小寫與其他清單符號', () => {
  const { groups } = parseTasks(SAMPLE);
  assert.deepEqual(groups.map(g => [g.title, g.items.length, g.items.filter(i => i.done).length]), [['追蹤資料格式 version 2', 2, 2], ['Python 管線', 3, 1], ['收尾', 1, 0]]);
  assert.equal(groups[0].items[0].text, '依設計稿擴充資料格式');
  const flat = parseTasks('- [X] one\n* [ ] two\n+ [x] three\r\n');
  assert.equal(flat.groups.length, 1);
  assert.deepEqual(flat.groups[0].items.map(i => i.done), [true, false, true]);
  assert.deepEqual(parseTasks('').groups, []);
  assert.deepEqual(parseTasks('# 只有標題\n沒有勾選').groups, []);
});

test('解析：項目上限 200', () => {
  const big = '## g\n' + Array.from({ length: 500 }, (_, i) => `- [ ] item ${i}`).join('\n');
  assert.equal(parseTasks(big).groups[0].items.length, 200);
});

const prompted = () => { const s = createSession(); s.handle({ hook_event_name: 'UserPromptSubmit', prompt: '接著做任務' }); return s; };
const readTasks = (s, text = SAMPLE) => s.handle({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/w/changes/add-cv/tasks.md' }, spec_tasks: { name: 'add-cv', groups: parseTasks(text).groups } });

test('綁定後：分組是關卡、勾選項是小步驟、水位照勾選進度', () => {
  const s = prompted();
  assert.equal(readTasks(s), true);
  const p = s.plan();
  assert.deepEqual(p.levels.map(l => [l.title, l.status]), [['追蹤資料格式 version 2', 'done'], ['Python 管線', 'doing'], ['收尾', 'todo']]);
  assert.deepEqual(p.levels[1].steps.map(x => x.done), [true, false, false]);
  assert.equal(p.levels[1].steps[1].title, '實作座標對應');
  assert.match(p.levels[1].tech, /規格任務/);
  assert.equal(p.world, 'add-cv');
  assert.ok(p.cup > 0.3 && p.cup < 0.5, '第二關 1/3：' + p.cup);
});

test('綁定後 TodoWrite 被忽略；沒綁定時照舊', () => {
  const todo = { hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: [{ content: '別的清單', status: 'in_progress' }] } };
  const a = prompted(); readTasks(a); a.handle(todo);
  assert.equal(a.plan().levels.some(l => l.title === '別的清單'), false);
  const b = prompted(); b.handle(todo);
  assert.deepEqual(b.plan().levels.map(l => l.title), ['別的清單']);
});

test('改檔後：勾完全部就完成；新增分組會出現新關卡', () => {
  const s = prompted(); readTasks(s);
  readTasks(s, SAMPLE + '\n\n## 4. 新增的\n\n- [ ] 4.1 新工作');
  assert.equal(s.plan().levels.length, 4);
  assert.equal(s.plan().levels[3].isNew, true);
  const done = SAMPLE.replace(/\[ \]/g, '[x]');
  const s2 = prompted(); readTasks(s2, done);
  const p = s2.plan();
  assert.ok(p.levels.every(l => l.status === 'done'));
});

test('沒分組的任務檔：每個勾選項一關', () => {
  const s = prompted(); readTasks(s, '- [x] a\n- [ ] b\n- [ ] c');
  assert.deepEqual(s.plan().levels.map(l => [l.title, l.status]), [['a', 'done'], ['b', 'doing'], ['c', 'todo']]);
});

test('hub：一個對話綁任務檔，另一個沒綁，互不影響', () => {
  const hub = createHub();
  hub.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'a', project_dir: '/w/a', prompt: 'x' });
  hub.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'b', project_dir: '/w/b', prompt: 'y' });
  hub.handle({ hook_event_name: 'PostToolUse', session_id: 'a', project_dir: '/w/a', tool_name: 'Read', tool_input: { file_path: '/w/a/changes/c/tasks.md' }, spec_tasks: { name: 'c', groups: parseTasks(SAMPLE).groups } });
  hub.handle({ hook_event_name: 'PostToolUse', session_id: 'b', project_dir: '/w/b', tool_name: 'TodoWrite', tool_input: { todos: [{ content: '自己的', status: 'in_progress' }] } });
  hub.select('a'); assert.equal(hub.plan().levels.length, 3);
  hub.select('b'); assert.deepEqual(hub.plan().levels.map(l => l.title), ['自己的']);
});

test('hook.js：讀任務檔只送標題與勾選，其他檔案不送', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-'));
  const f = path.join(dir, 'changes', 'add-x', 'tasks.md');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, SAMPLE + '\n\n祕密內容 SECRET-TEXT\n');
  const http = require('http');
  const got = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { got.push(JSON.parse(b)); res.statusCode = 204; res.end(); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const run = ev => new Promise(resolve => {
    const c = spawn(process.execPath, [path.join(__dirname, '..', 'hook.js')], { env: { ...process.env, QUEST_PET_PORT: String(srv.address().port), QUEST_PET_REMOTE: '0', CLAUDE_CODE_REMOTE: '' } });
    c.on('close', resolve); c.stdin.end(JSON.stringify(ev));
  });
  await run({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: f } });
  await run({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(dir, 'README.md') } });
  srv.close();
  assert.equal(got.length, 2);
  assert.equal(got[0].spec_tasks.name, 'add-x');
  assert.equal(got[0].spec_tasks.groups.length, 3);
  assert.ok(!JSON.stringify(got[0]).includes('SECRET-TEXT'));
  assert.equal(got[1].spec_tasks, undefined);
});

test('Claude 端的指引：排程任務等沒人在看的工作不要用地圖工具', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'plain-levels', 'SKILL.md'), 'utf8');
  const head = skill.split('\n').slice(0, 4).join('\n');
  assert.match(head, /排程任務/);
  assert.match(head, /不要用在/);
  assert.match(skill, /## 不要用的情況/);
  const mcp = fs.readFileSync(path.join(__dirname, '..', 'mcp-server.js'), 'utf8');
  assert.match(mcp, /先看這條：排程任務/);
});
