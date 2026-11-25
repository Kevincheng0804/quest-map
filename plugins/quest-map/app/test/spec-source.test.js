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

test('active-change：只有一個進行中的變更才綁；兩個以上不猜，回報候選', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'act-'));
  mkChange(root, 'docs/spectra/changes', 'add-b', TASKS);
  fs.mkdirSync(path.join(root, '.spectra', 'changes'), { recursive: true });
  fs.writeFileSync(path.join(root, '.spectra', 'changes', 'add-b.started'), '');
  const one = activeChange(root);
  assert.equal(one.why, 'active-change'); assert.ok(one.path.replace(/\\/g, '/').endsWith('add-b/tasks.md'));
  assert.equal(detectSpecPath({ hook_event_name: 'UserPromptSubmit', prompt: '直接驗收再跑spectra' }, { root }).why, 'active-change');
  mkChange(root, 'docs/spectra/changes', 'add-a', TASKS);
  const two = activeChange(root);
  assert.equal(two.ambiguous, 2); assert.equal(two.candidates.length, 2); assert.equal(two.path, undefined);
  assert.equal(detectSpecPath({ hook_event_name: 'UserPromptSubmit', prompt: '改一下設計' }, { root }).ambiguous, 2);
});

test('active-change：全部勾完或在 archive 底下的不算候選；什麼都沒有不報錯', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'act2-'));
  mkChange(root, 'openspec/changes', 'old-done', TASKS.replace(/\[ \]/g, '[x]'));
  mkChange(root, 'openspec/changes/archive', 'archived', TASKS);
  assert.equal(activeChange(root), null, '全部勾完與 archive 都不算');
  mkChange(root, 'openspec/changes', 'pending-a', TASKS);
  assert.ok(activeChange(root).path.endsWith('pending-a/tasks.md'));
  assert.equal(activeChange(undefined), null);
  assert.equal(activeChange(fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'))), null);
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

const { projectRoots, probe } = require('../spec-tasks');
const { createStats } = require('../stats');

test('projectRoots：專案、worktree 的主專案、往上最多 3 層', () => {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'main-'));
  fs.mkdirSync(path.join(main, '.git', 'worktrees', 'wt'), { recursive: true });
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'wt')}\n`);
  const roots = projectRoots(wt);
  assert.equal(roots[0], wt.replace(/\\/g, '/'));
  assert.ok(roots.includes(main.replace(/\\/g, '/')), '含主專案');
  assert.ok(roots.length <= 5 && roots.length >= 2);
  assert.deepEqual(projectRoots(undefined), []);
  const deep = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'deep2-')), 'a', 'b', 'c', 'd'); fs.mkdirSync(deep, { recursive: true });
  assert.equal(projectRoots(deep).length, 4, '自己加上往上 3 層');
});

test('detectSpecPath：change 在 worktree 的主專案或上層資料夾時也找得到', () => {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'main2-'));
  fs.mkdirSync(path.join(main, '.git', 'worktrees', 'wt'), { recursive: true });
  const t = mkChange(main, 'docs/spectra/changes', 'add-foreach-scenario', TASKS);
  const wt = path.join(main, 'wts', 'wt1'); fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'wt')}`);
  const r = detectSpecPath({ hook_event_name: 'UserPromptSubmit', prompt: '/spectra-apply add-foreach-scenario' }, { root: wt });
  assert.equal(r.why, 'prompt-name');
  assert.ok(r.path.replace(/\\/g, '/').endsWith('add-foreach-scenario/tasks.md'));
  const sub = path.join(main, 'src', 'deep'); fs.mkdirSync(sub, { recursive: true });
  assert.ok(detectSpecPath({ hook_event_name: 'UserPromptSubmit', prompt: '/spectra-apply add-foreach-scenario' }, { root: sub }), '從較深的資料夾往上也找得到');
});

test('probe 與 stats：診斷只有資料夾名稱、版本與數量；specProbe 最多 5 筆；hookVersions 計數', () => {
  const p = project();
  const info = probe({ prompt: '/spectra-apply some-name' }, p.root);
  assert.equal(info.root, path.basename(p.root));
  assert.ok(info.known.includes('docs/spectra/changes'));
  assert.equal(info.names, 1);
  assert.ok(!JSON.stringify(info).includes(p.root.replace(/\\/g, '/')), '不含完整路徑');
  const st = createStats(() => 1000);
  for (let i = 0; i < 7; i++) st.record('hook', { hook_event_name: 'UserPromptSubmit', hook: '0.20.3', spec_probe: { root: 'proj', roots: 2, names: 1, known: ['docs/spectra/changes'], started: 0, worktree: false } });
  st.record('hook', { hook_event_name: 'PostToolUse' });
  const snap = st.snapshot();
  assert.equal(snap.specProbe.length, 5);
  assert.deepEqual(snap.hookVersions, { '0.20.3': 7, old: 1 });
  assert.ok(!JSON.stringify(snap.specProbe).includes('prompt'));
});


const { mentionsFile, activeCandidates } = require('../spec-tasks');
const TASKS_A = '## 1. 環繞鏡頭\n- [x] 1.1 軌道鏡頭：新增 src/camera/orbit.ts\n- [ ] 1.2 接進流程：改 src/flow/strike.ts\n';
const TASKS_B = '## 1. 投手重新設計\n- [x] 1.1 重做模型：改 src/pitcher/chibi.ts 與 tests/chibi.test.ts\n- [ ] 1.2 貼圖：src/pitcher/texture.ts\n';
function twoChanges() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'two-'));
  const a = mkChange(root, 'docs/spectra/changes', 'add-strike-orbit-shot', TASKS_A);
  const b = mkChange(root, 'docs/spectra/changes', 'redesign-realistic-pitcher', TASKS_B);
  return { root, a, b };
}

test('mentionsFile：最後兩段路徑或夠長的檔名；太普通的檔名不算', () => {
  assert.ok(mentionsFile(TASKS_B, 'C:\\p\\src\\pitcher\\chibi.ts'));
  assert.ok(mentionsFile(TASKS_B, '/x/tests/chibi.test.ts'));
  assert.equal(mentionsFile(TASKS_B, '/x/src/index.ts'), false);
  assert.equal(mentionsFile('改 index.ts', '/x/src/index.ts'), false, 'index.ts 太普通');
  assert.ok(mentionsFile('改 src/main.ts', '/x/src/main.ts'), '有一層資料夾就算');
  assert.equal(mentionsFile(TASKS_A, ''), false);
});

test('file-match：兩個進行中的變更，Claude 改的檔案只出現在 B → 綁 B；之後的更新跟著 B', () => {
  const { root, a, b } = twoChanges();
  const tr = createSpecTracker({ now: () => 1_000_000 });
  const found = detectSpecPath({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: '之前 3D 投手的設計我不太喜歡' }, { root });
  assert.equal(found.ambiguous, 2);
  const e1 = tr.augment({ session_id: 's', hook_event_name: 'UserPromptSubmit', spec_ambiguous: found.ambiguous, spec_candidates: found.candidates });
  assert.equal(e1.spec_ambiguous, 2, '沒綁時告訴地圖「有 2 個，還不確定」');
  assert.equal(e1.spec_candidates, undefined, '候選路徑不往下傳');
  const e2 = tr.augment({ session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src', 'pitcher', 'chibi.ts') } });
  assert.equal(e2.spec_tasks.name, 'redesign-realistic-pitcher');
  assert.deepEqual(tr.info(), [{ change: 'redesign-realistic-pitcher', why: 'file-match', ok: true }]);
  assert.deepEqual(tr.ambiguous(), []);
  fs.writeFileSync(b, TASKS_B.replace('- [ ]', '- [x]'));
  const e3 = tr.augment({ session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Bash' });
  assert.equal(e3, e3); assert.equal(tr.info()[0].why, 'file-match');
});

test('file-match：檔案出現在兩個變更、或兩個都沒有，都不綁；已用強線索綁定時不被換掉', () => {
  const { root } = twoChanges();
  const tr = createSpecTracker({ now: () => 1 });
  const cand = activeCandidates(root);
  tr.augment({ session_id: 's', hook_event_name: 'UserPromptSubmit', spec_ambiguous: 2, spec_candidates: cand });
  assert.equal(tr.augment({ session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/p/src/other/unknown.ts' } }).spec_tasks, undefined);
  assert.deepEqual(tr.ambiguous(), [2]);
  const strong = createSpecTracker({ now: () => 1 });
  const aPath = cand.find(p => p.includes('add-strike-orbit-shot'));
  strong.augment({ session_id: 's', hook_event_name: 'UserPromptSubmit', spec_ambiguous: 2, spec_candidates: cand });
  strong.augment({ session_id: 's', hook_event_name: 'PostToolUse', spec_path: aPath, spec_why: 'prompt-name', spec_tasks: readSpecTasks(aPath) });
  const ev = strong.augment({ session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/p/src/pitcher/chibi.ts' } });
  assert.equal(ev.spec_tasks, undefined);
  assert.equal(strong.info()[0].change, 'add-strike-orbit-shot');
});

test('強度：弱線索（active-change）會被更強的換掉；弱的不會蓋掉強的', () => {
  const { root, a, b } = twoChanges();
  const tr = createSpecTracker({ now: () => 1 });
  tr.augment({ session_id: 's', hook_event_name: 'UserPromptSubmit', spec_path: a, spec_why: 'active-change', spec_tasks: readSpecTasks(a) });
  tr.augment({ session_id: 's', hook_event_name: 'PostToolUse', spec_path: b, spec_why: 'same-folder', spec_tasks: readSpecTasks(b) });
  assert.equal(tr.info()[0].change, 'redesign-realistic-pitcher');
  tr.augment({ session_id: 's', hook_event_name: 'UserPromptSubmit', spec_path: a, spec_why: 'active-change', spec_tasks: readSpecTasks(a) });
  assert.equal(tr.info()[0].change, 'redesign-realistic-pitcher', '猜測不會蓋掉強線索');
});
