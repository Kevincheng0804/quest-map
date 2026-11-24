'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { siblingTasks, findByName, promptNames, detectSpecPath, readSpecTasks } = require('../spec-tasks');
const { createSpecTracker } = require('../spec-source');
const { createSession, createHub } = require('../state');

const TASKS = '## 1. 第一組\n- [x] 1.1 做甲：說明\n- [ ] 1.2 做乙：說明\n## 2. 第二組\n- [ ] 2.1 做丙：說明\n';
function project(prefix = 'docs/spectra/changes') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specsrc-'));
  const dir = path.join(root, ...prefix.split('/'), 'add-array-reference-scenario');
  fs.mkdirSync(path.join(dir, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tasks.md'), TASKS);
  fs.writeFileSync(path.join(dir, 'proposal.md'), '# p');
  fs.mkdirSync(path.join(root, 'node_modules', 'changes', 'add-array-reference-scenario'), { recursive: true });
  return { root, dir, tasks: path.join(dir, 'tasks.md') };
}

test('同一個 change 資料夾的任何檔案都指向它的 tasks.md', () => {
  assert.equal(siblingTasks('C:\\w\\docs\\spectra\\changes\\add-x\\proposal.md'), 'C:/w/docs/spectra/changes/add-x/tasks.md');
  assert.equal(siblingTasks('/w/openspec/changes/add-x/specs/a/spec.md'), '/w/openspec/changes/add-x/tasks.md');
  assert.equal(siblingTasks('/w/src/index.ts'), null);
});

test('detectSpecPath：碰 proposal.md 取同資料夾 tasks.md；碰 tasks.md 直接用；沒有 tasks.md 就不綁', () => {
  const p = project();
  const a = detectSpecPath({ tool_name: 'Read', tool_input: { file_path: path.join(p.dir, 'proposal.md') } }, { root: p.root });
  assert.equal(a.why, 'same-folder'); assert.ok(a.path.endsWith('tasks.md'));
  assert.equal(detectSpecPath({ tool_name: 'Edit', tool_input: { file_path: p.tasks } }, { root: p.root }).why, 'read-tasks');
  fs.unlinkSync(p.tasks);
  assert.equal(detectSpecPath({ tool_name: 'Read', tool_input: { file_path: path.join(p.dir, 'proposal.md') } }, { root: p.root }), null);
  assert.equal(detectSpecPath({ tool_name: 'Read', tool_input: { file_path: '/x/src/a.ts' } }, { root: p.root }), null);
});

test('detectSpecPath：提示裡的 change 名稱找得到檔案（略過 node_modules），找不到不報錯', () => {
  for (const prefix of ['docs/spectra/changes', 'openspec/changes', '.spectra/changes']) {
    const p = project(prefix);
    const r = detectSpecPath({ hook_event_name: 'UserPromptSubmit', prompt: '/spectra-apply add-array-reference-scenario' }, { root: p.root });
    assert.equal(r.why, 'prompt-name', prefix);
    assert.ok(r.path.replace(/\\/g, '/').endsWith(prefix + '/add-array-reference-scenario/tasks.md'), prefix);
  }
  const p = project();
  assert.equal(detectSpecPath({ hook_event_name: 'UserPromptSubmit', prompt: 'fix some-other-thing please' }, { root: p.root }).why, 'active-change', '提示的名稱找不到，退回找進行中的變更');
  assert.equal(detectSpecPath({ hook_event_name: 'UserPromptSubmit', prompt: 'fix some-other-thing please' }, { root: fs.mkdtempSync(path.join(os.tmpdir(), 'none-')) }), null, '什麼都沒有就不綁');
  assert.equal(detectSpecPath({ hook_event_name: 'UserPromptSubmit', prompt: 'hello' }, { root: undefined }), null);
  assert.deepEqual(promptNames('a-b add-array-reference-scenario add-array-reference-scenario'), ['add-array-reference-scenario']);
});

test('findByName：深度與數量上限', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-'));
  const deep = path.join(root, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'changes', 'x-y');
  fs.mkdirSync(deep, { recursive: true }); fs.writeFileSync(path.join(deep, 'tasks.md'), TASKS);
  assert.equal(findByName(root, 'x-y'), null, '超過 6 層找不到');
  assert.ok(findByName(root, 'x-y', { maxDepth: 12 }));
  const odd = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-'));
  for (const n of ['a', 'b', 'c']) fs.mkdirSync(path.join(odd, n));
  const hid = path.join(odd, 'c', 'x', 'changes', 'cap-change'); fs.mkdirSync(hid, { recursive: true }); fs.writeFileSync(path.join(hid, 'tasks.md'), TASKS);
  assert.equal(findByName(odd, 'cap-change', { maxEntries: 2 }), null, '搜尋的數量上限（只算資料夾）');
  assert.ok(findByName(odd, 'cap-change'));
});

test('tracker：記住路徑，之後的工具事件重讀最新的清單；1 秒節流；讀失敗沿用上一份', () => {
  const p = project();
  let t = 1_000_000;
  const tr = createSpecTracker({ now: () => t });
  const first = { session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Read', spec_path: p.tasks, spec_why: 'read-tasks', spec_tasks: readSpecTasks(p.tasks) };
  const e1 = tr.augment(first);
  assert.equal(e1.spec_path, undefined, 'spec_path 不往下傳');
  assert.deepEqual(tr.info(), [{ change: 'add-array-reference-scenario', why: 'read-tasks', ok: true }]);
  fs.writeFileSync(p.tasks, TASKS.replace('- [ ] 1.2', '- [x] 1.2'));
  t += 500;
  assert.equal(tr.augment({ session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Bash' }).spec_tasks, undefined, '1 秒內不重讀');
  t += 1000;
  const e2 = tr.augment({ session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Bash' });
  assert.equal(e2.spec_tasks.groups[0].items.every(i => i.done), true, '勾選變了，地圖跟著變');
  assert.equal(tr.info()[0].why, 'refresh');
  fs.unlinkSync(p.tasks); t += 2000;
  assert.equal(tr.augment({ session_id: 's', hook_event_name: 'Stop' }).spec_tasks, undefined, '讀不到就不補，沿用地圖上原本的');
  assert.equal(tr.info()[0].ok, false);
  tr.augment({ session_id: 's', hook_event_name: 'SessionEnd' });
  assert.deepEqual(tr.info(), []);
});

test('tracker：不補 Notification／說話事件；路徑格式不對就不收；全部完成後新的一句話不再塞舊任務', () => {
  const p = project();
  let t = 5_000_000;
  const tr = createSpecTracker({ now: () => t });
  tr.augment({ session_id: 's', hook_event_name: 'PostToolUse', spec_path: p.tasks, spec_tasks: readSpecTasks(p.tasks) });
  t += 5000;
  assert.equal(tr.augment({ session_id: 's', hook_event_name: 'Notification' }).spec_tasks, undefined);
  assert.equal(tr.augment({ session_id: 's', hook_event_name: 'UserPromptSubmit', prompt: 'x' }).spec_tasks, undefined);
  const evil = tr.augment({ session_id: 'e', hook_event_name: 'PostToolUse', spec_path: '/etc/passwd', spec_tasks: { name: 'x', groups: [] } });
  assert.equal(evil.spec_tasks, undefined); assert.equal(tr.info().length, 1);
  const done = createSpecTracker({ now: () => t });
  fs.writeFileSync(p.tasks, TASKS.replace(/\[ \]/g, '[x]'));
  done.augment({ session_id: 'd', hook_event_name: 'PostToolUse', spec_path: p.tasks, spec_tasks: readSpecTasks(p.tasks) });
  t += 5000;
  done.augment({ session_id: 'd', hook_event_name: 'UserPromptSubmit', prompt: '做別的' });
  assert.deepEqual(done.info(), [], '全部完成後的新任務，解除綁定');
});

test('重讀規格任務檔不會把「等你同意」解除；說話事件裡的任務清單也會綁定', () => {
  const p = project();
  const s = createSession();
  s.handle({ hook_event_name: 'UserPromptSubmit', prompt: '/spectra-apply add-array-reference-scenario', spec_tasks: readSpecTasks(p.tasks) });
  assert.equal(s.plan().levels.length, 2, '第一個事件（說話）就出現分組關卡');
  s.handle({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  assert.ok(s.plan().waitingFor);
  s.handle({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, spec_tasks: readSpecTasks(p.tasks) });
  assert.ok(s.plan().waitingFor, '重讀任務檔不會解除等你同意');
});

test('findByName：專案裡有很多檔案也找得到（常見位置直接看；只算資料夾）', () => {
  const p = project();
  const big = path.join(p.root, 'public', 'assets'); fs.mkdirSync(big, { recursive: true });
  for (let i = 0; i < 4000; i++) fs.writeFileSync(path.join(big, `f${i}.png`), '');
  assert.ok(findByName(p.root, 'add-array-reference-scenario'), '常見位置');
  const odd = fs.mkdtempSync(path.join(os.tmpdir(), 'odd-'));
  const d = path.join(odd, 'public'); fs.mkdirSync(d);
  for (let i = 0; i < 4000; i++) fs.writeFileSync(path.join(d, `f${i}.png`), '');
  const dir = path.join(odd, 'tools', 'x', 'changes', 'my-change'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'tasks.md'), TASKS);
  assert.ok(findByName(odd, 'my-change'), '少見的位置，靠搜尋；檔案再多也不吃額度');
});

const { activeChange } = require('../spec-tasks');
const mkChange = (root, rel, name, text) => { const d = path.join(root, ...rel.split('/'), name); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'tasks.md'), text); return path.join(d, 'tasks.md'); };

test('active-change：Spectra 的 .started 標記指出進行中的變更', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'act-'));
  mkChange(root, 'docs/spectra/changes', 'add-a', TASKS);
  mkChange(root, 'docs/spectra/changes', 'add-b', TASKS);
  fs.mkdirSync(path.join(root, '.spectra', 'changes'), { recursive: true });
  fs.writeFileSync(path.join(root, '.spectra', 'changes', 'add-b.started'), '');
  const r = activeChange(root);
  assert.equal(r.why, 'active-change');
  assert.ok(r.path.replace(/\\/g, '/').endsWith('add-b/tasks.md'), '取有 .started 的那個');
  const viaDetect = detectSpecPath({ hook_event_name: 'UserPromptSubmit', prompt: '直接驗收再跑spectra' }, { root });
  assert.equal(viaDetect.why, 'active-change');
});

test('active-change：沒有標記時只有一個未完成的 change 就綁它；多個取最近修改；全部勾完或在 archive 底下的不算', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'act2-'));
  const done = mkChange(root, 'openspec/changes', 'old-done', TASKS.replace(/\[ \]/g, '[x]'));
  mkChange(root, 'openspec/changes/archive', 'archived', TASKS);
  assert.equal(activeChange(root), null, '全部勾完與 archive 都不算');
  const a = mkChange(root, 'openspec/changes', 'pending-a', TASKS);
  assert.ok(activeChange(root).path.endsWith('pending-a/tasks.md'));
  const b = mkChange(root, 'openspec/changes', 'pending-b', TASKS);
  fs.utimesSync(a, new Date(1000), new Date(1000)); fs.utimesSync(done, new Date(1000), new Date(1000));
  assert.ok(activeChange(root).path.endsWith('pending-b/tasks.md'), '取最近修改的');
  assert.equal(activeChange(undefined), null);
  assert.equal(activeChange(fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'))), null, '什麼都沒有不報錯');
});

test('active-change：提示有名稱時走 prompt-name；已綁定的對話不被「猜測」覆蓋', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'act3-'));
  const t1 = mkChange(root, 'docs/spectra/changes', 'add-named', TASKS);
  mkChange(root, 'docs/spectra/changes', 'add-other', TASKS);
  assert.equal(detectSpecPath({ hook_event_name: 'UserPromptSubmit', prompt: '/spectra-apply add-named' }, { root }).why, 'prompt-name');
  const tr = createSpecTracker({ now: () => 1 });
  tr.augment({ session_id: 's', hook_event_name: 'PostToolUse', spec_path: t1, spec_why: 'read-tasks', spec_tasks: readSpecTasks(t1) });
  const guess = tr.augment({ session_id: 's', hook_event_name: 'UserPromptSubmit', spec_path: path.join(root, 'docs/spectra/changes/add-other/tasks.md'), spec_why: 'active-change', spec_tasks: readSpecTasks(path.join(root, 'docs/spectra/changes/add-other/tasks.md')) });
  assert.equal(guess.spec_tasks, undefined);
  assert.equal(tr.info()[0].change, 'add-named', '仍是原本綁的那個');
});
