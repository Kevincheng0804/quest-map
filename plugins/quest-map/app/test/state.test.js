'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSession, createHub, summarize, activityOf, summaryOf, cleanPrompt } = require('../state');

const P = 'pending', D = 'in_progress', C = 'completed';
const prompt = text => ({ hook_event_name: 'UserPromptSubmit', prompt: text });
const todos = (...rows) => ({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: rows.map(([content, status]) => ({ content, status })) } });
const taskCreate = (subject, id) => ({ hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject }, ...(id ? { tool_response: { task: { id } } } : {}) });
const taskUpdate = (taskId, status, more = {}) => ({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId, status, ...more } });
const permission = { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' };
const otherTool = { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {} };
const stop = msg => ({ hook_event_name: 'Stop', last_assistant_message: msg });

// 餵一串事件，回傳最後的計畫
function run(...events) {
  const s = createSession();
  let p;
  for (const e of events) { s.handle(e); p = s.plan(); }
  return { s, p: p || s.plan() };
}
const shape = p => p.levels.map(l => `${l.title}:${l.status}`);
const byTitle = (p, t) => p.levels.find(l => l.title === t);

test('待命畫面：說清楚哪些對話看得到、哪些看不到', () => {
  const p = createSession().plan();
  assert.equal(p.goal, '等 Claude Code 或 Cowork 開始工作');
  assert.match(p.aiSays, /Claude Code/);
  assert.match(p.aiSays, /Cowork/);
  assert.match(p.aiSays, /一般聊天和雲端的對話我看不到/);
  assert.match(p.levels[0].plain, /在你電腦上的 Claude Code/);
});

test('還沒下指令：一關待命、機器人在休息', () => {
  const p = createSession().plan();
  assert.equal(p.levels.length, 1);
  assert.equal(p.levels[0].status, 'todo');
  assert.equal(summarize(p).mood, 'sleep');
});

test('下了指令但沒有待辦清單：整件事算一關，停下來就通關', () => {
  const { s, p } = run(prompt('幫我改個錯字'));
  assert.deepEqual(shape(p), ['處理你的要求:doing']);
  assert.equal(p.userSaid, '幫我改個錯字');
  s.handle(stop('改好了。'));
  const after = s.plan();
  assert.equal(after.levels[0].status, 'done');
  assert.equal(summarize(after).mood, 'happy');
});

test('待辦清單變成關卡，狀態對應正確', () => {
  const { p } = run(prompt('做報名表單'), todos(['設計欄位', C], ['做畫面', D], ['測試', P]));
  assert.deepEqual(shape(p), ['設計欄位:done', '做畫面:doing', '測試:todo']);
  assert.match(p.aiSays, /做畫面/);
  assert.equal(p.toast, null, '第一次列清單不算結構改變，不跳通知');
  assert.ok(p.levels.every(l => !l.isNew));
  assert.deepEqual(summarize(p), { done: 1, total: 3, waiting: false, waitingFor: null, waitingName: null, mood: 'work', cup: 0, others: 0 });
});

test('關卡 id 在狀態更新之間保持不變', () => {
  const { s, p } = run(prompt('x'), todos(['甲', D], ['乙', P]));
  s.handle(todos(['甲', C], ['乙', D]));
  assert.deepEqual(s.plan().levels.map(l => l.id), p.levels.map(l => l.id));
});

test('插話加功能：新關卡引用使用者原話，做完的關卡變回頭修', () => {
  const { p } = run(
    prompt('做報名表單'),
    todos(['做畫面', C], ['存資料', D], ['測試', P]),
    prompt('想讓報名的人可以上傳大頭照'),
    todos(['做畫面', D], ['存資料', C], ['上傳大頭照', P], ['測試', P])
  );
  assert.deepEqual(shape(p), ['做畫面:adjust', '存資料:done', '上傳大頭照:todo', '測試:todo']);
  const added = byTitle(p, '上傳大頭照');
  assert.equal(added.isNew, true);
  assert.match(added.reason, /新關卡.*想讓報名的人可以上傳大頭照/);
  assert.match(byTitle(p, '做畫面').reason, /回頭修.*想讓報名的人可以上傳大頭照/);
  assert.equal(p.toast, '地圖更新！新增 1 關，1 關要回頭修');
});

test('回頭修的關卡在重做期間維持施工中，做完才變通關', () => {
  const { s } = run(prompt('a'), todos(['甲', C], ['乙', D]), prompt('甲要改'), todos(['甲', P], ['乙', D]));
  assert.equal(byTitle(s.plan(), '甲').status, 'adjust');
  s.handle(todos(['甲', D], ['乙', P]));
  assert.equal(byTitle(s.plan(), '甲').status, 'adjust');
  s.handle(todos(['甲', C], ['乙', D]));
  const p = s.plan();
  assert.equal(byTitle(p, '甲').status, 'done');
  assert.equal(byTitle(p, '甲').reason, undefined);
});

test('改變心意：舊關卡留在原位變已拆除，新關卡接上', () => {
  const { p } = run(
    prompt('做報名表單'),
    todos(['存資料', C], ['寄確認信', D], ['測試', P]),
    prompt('確認信不要了，改成傳 LINE 通知我就好'),
    todos(['存資料', C], ['LINE 通知', D], ['測試', P])
  );
  assert.deepEqual(shape(p), ['存資料:done', '寄確認信:cancel', 'LINE 通知:doing', '測試:todo']);
  assert.match(byTitle(p, '寄確認信').reason, /已拆除.*確認信不要了/);
  assert.equal(byTitle(p, 'LINE 通知').isNew, true);
  assert.equal(p.toast, '地圖更新！新增 1 關，拆掉 1 關');
  assert.equal(summarize(p).total, 3, '已拆除的關卡不算在總數裡');
});

test('只是改措辭：同一關、不跳通知', () => {
  const { s, p } = run(prompt('x'), todos(['做出表單畫面', D], ['測試', P]));
  s.handle(todos(['做出報名表單畫面', D], ['測試', P]));
  const after = s.plan();
  assert.equal(after.levels[0].id, p.levels[0].id);
  assert.equal(after.levels[0].title, '做出報名表單畫面');
  assert.equal(after.levels.length, 2);
  assert.equal(after.toast, null);
});

test('通知只出現一次', () => {
  const { s } = run(prompt('a'), todos(['甲', D]), prompt('加乙'));
  s.handle(todos(['甲', D], ['乙', P]));
  assert.ok(s.plan().toast);
  assert.equal(s.plan().toast, null);
});

test('下一句話之後，「新關卡」標籤會拿掉', () => {
  const { s } = run(prompt('a'), todos(['甲', D]), prompt('加乙'), todos(['甲', D], ['乙', P]));
  assert.equal(byTitle(s.plan(), '乙').isNew, true);
  s.handle(prompt('繼續'));
  assert.equal(byTitle(s.plan(), '乙').isNew, undefined);
});

test('要你按同意：目前那關變成等你開門，工具跑完就恢復', () => {
  const { s } = run(prompt('a'), todos(['甲', C], ['乙', D], ['丙', P]));
  s.handle(permission);
  let p = s.plan();
  assert.equal(byTitle(p, '乙').status, 'wait');
  assert.match(p.waitingFor, /Bash/);
  assert.equal(summarize(p).mood, 'wait');
  assert.equal(s.handle(otherTool), true, '解除等待要通知畫面更新');
  p = s.plan();
  assert.equal(byTitle(p, '乙').status, 'doing');
  assert.equal(p.waitingFor, null);
});

test('一杯水：任務進行中水位慢慢漲、不會自己滿，換下一個任務從空杯開始', () => {
  const { s } = run(prompt('a'), todos(['甲', D], ['乙', P]));
  assert.equal(s.plan().cup, 0);
  const levels = [];
  for (let i = 0; i < 40; i++) { assert.equal(s.handle(otherTool), true); levels.push(s.plan().cup); }
  assert.ok(levels[0] > 0 && levels[0] < levels[5] && levels[5] < levels[20], '越做水位越高');
  assert.ok(levels[39] <= 0.9, '沒完成就不會滿');
  s.handle(todos(['甲', C], ['乙', D]));
  assert.equal(s.plan().cup, 0, '下一個任務是新的一杯');
  s.handle(otherTool);
  assert.ok(s.plan().cup > 0);
  s.handle(todos(['甲', C], ['乙', C]));
  const p = s.plan();
  assert.equal(p.cup, 1, '全部完成是滿杯');
  assert.equal(summarize(p).cup, 1);
});

test('一杯水：等你的時候水位留在原地；還沒下指令時不會漲', () => {
  const idle = createSession();
  assert.equal(idle.handle(otherTool), false);
  assert.equal(idle.plan().cup, 0);
  const { s } = run(prompt('a'), todos(['甲', D]), otherTool, otherTool, otherTool);
  const before = s.plan().cup;
  s.handle(permission);
  assert.equal(s.plan().cup, before);
});

test('一杯水：沒有待辦清單的小任務也算一杯', () => {
  const { s } = run(prompt('改個錯字'), otherTool, otherTool);
  assert.ok(s.plan().cup > 0 && s.plan().cup < 1);
  s.handle(stop('好了。'));
  assert.equal(s.plan().cup, 1);
});

test('等待前的原因在解除後還原', () => {
  const { s } = run(prompt('a'), todos(['甲', C], ['乙', P]), prompt('甲要改'), todos(['甲', D], ['乙', P]));
  const before = byTitle(s.plan(), '甲').reason;
  s.handle(permission);
  assert.match(byTitle(s.plan(), '甲').reason, /等你開門/);
  s.handle(otherTool);
  const after = byTitle(s.plan(), '甲');
  assert.equal(after.status, 'adjust');
  assert.equal(after.reason, before);
});

test('用問句結束：算是在等你；你回話就解除', () => {
  const { s } = run(prompt('a'), todos(['甲', D], ['乙', P]), stop('要用哪個資料庫？'));
  assert.equal(byTitle(s.plan(), '甲').status, 'wait');
  s.handle(prompt('用 SQLite'));
  const p = s.plan();
  assert.equal(byTitle(p, '甲').status, 'doing');
  assert.equal(p.waitingFor, null);
});

test('停在半路和全部做完，說的話不一樣', () => {
  const half = run(prompt('a'), todos(['甲', C], ['乙', D]), stop('先這樣。')).p;
  assert.match(half.aiSays, /停在這裡/);
  const full = run(prompt('a'), todos(['甲', C], ['乙', C]), stop('完成了。')).p;
  assert.match(full.aiSays, /全部通關/);
  assert.equal(summarize(full).mood, 'happy');
});

test('全部通關後再下指令：上一輪收合成已通過的世界', () => {
  const { p } = run(prompt('做首頁'), todos(['放照片', C], ['放按鈕', C]), stop('好了'), prompt('再做報名表單'));
  assert.equal(p.round, 2);
  assert.deepEqual(p.pastWorlds, [{ name: '做首頁', summary: '放照片、放按鈕' }]);
  assert.deepEqual(shape(p), ['處理你的要求:doing']);
  assert.equal(p.goal, '再做報名表單');
});

test('沒做完就下新指令：不會收合，維持同一個世界', () => {
  const { p } = run(prompt('做首頁'), todos(['放照片', C], ['放按鈕', D]), prompt('按鈕改成紅色'));
  assert.equal(p.round, 1);
  assert.equal(p.pastWorlds.length, 0);
  assert.equal(p.levels.length, 2);
});

test('TaskCreate／TaskUpdate：用任務編號追蹤', () => {
  const { s } = run(prompt('a'), taskCreate('甲', '1'), taskCreate('乙', '2'), taskCreate('丙'));
  assert.deepEqual(s.plan().levels.map(l => l.id), ['k1', 'k2', 'k3'], '沒回傳編號時接續往下數');
  s.handle(taskUpdate('1', C));
  s.handle(taskUpdate('2', D));
  assert.deepEqual(shape(s.plan()), ['甲:done', '乙:doing', '丙:todo']);
  s.handle(taskUpdate('1', D));
  assert.equal(byTitle(s.plan(), '甲').status, 'adjust');
  s.handle(taskUpdate('3', 'deleted'));
  const p = s.plan();
  assert.equal(byTitle(p, '丙').status, 'cancel');
  assert.equal(p.toast, '地圖更新！拆掉 1 關');
});

test('開工之後才建立的任務算新關卡', () => {
  const { s } = run(prompt('a'), taskCreate('甲', '1'), taskCreate('乙', '2'));
  assert.ok(s.plan().levels.every(l => !l.isNew));
  s.handle(taskUpdate('1', D));
  s.handle(prompt('再加一個丙'));
  s.handle(taskCreate('丙', '3'));
  const p = s.plan();
  assert.equal(byTitle(p, '丙').isNew, true);
  assert.match(byTitle(p, '丙').reason, /再加一個丙/);
});

test('describe：用編號、清單位置或原文補上白話名稱', () => {
  const tasks = run(prompt('a'), taskCreate('Create form.html', '1'), taskCreate('Add POST /signup', '2')).s;
  tasks.describe({ world: '報名表單森林', goal: '做出報名表單', finalGoal: '上線城堡', levels: [{ task: '1', title: '做出表單畫面', plain: '讓人可以填資料', tech: 'form.html' }] });
  let p = tasks.plan();
  assert.equal(p.world, '報名表單森林');
  assert.equal(p.finalGoal, '上線城堡');
  assert.deepEqual(p.levels.map(l => l.title), ['做出表單畫面', 'Add POST /signup']);
  assert.equal(p.levels[0].tech, 'form.html');

  const list = run(prompt('a'), todos(['Create form.html', D], ['Add POST /signup', P])).s;
  list.describe({ levels: [{ task: '2', title: '把資料收好', plain: '存起來' }, { task: 'create FORM.html ', title: '做出表單畫面', plain: '填資料' }] });
  p = list.plan();
  assert.deepEqual(p.levels.map(l => l.title), ['做出表單畫面', '把資料收好']);
  assert.match(p.aiSays, /做出表單畫面/, '泡泡也用白話名稱');
  list.handle(todos(['Create form.html', C], ['Add POST /signup', D]));
  assert.deepEqual(list.plan().levels.map(l => l.title), ['做出表單畫面', '把資料收好'], '狀態更新後白話名稱還在');
});

test('收合成世界時，摘要用白話名稱', () => {
  const { s } = run(prompt('a'), todos(['Create form.html', C]));
  s.describe({ world: '表單森林', levels: [{ task: '1', title: '做出表單畫面', plain: 'x' }] });
  s.handle(prompt('下一件事'));
  assert.deepEqual(s.plan().pastWorlds, [{ name: '表單森林', summary: '做出表單畫面' }]);
});

test('小步驟：回報做完幾步，水位照比例精確地漲', () => {
  const { s } = run(prompt('a'), taskCreate('Create form', '1'), taskCreate('Save data', '2'), taskUpdate('1', D));
  s.describe({ levels: [{ task: '1', title: '做出表單畫面', plain: 'x', steps: ['排好欄位', '加上送出按鈕', '調整手機版面', '檢查錯誤提示'] }] });
  let p = s.plan();
  assert.equal(p.cup, 0);
  assert.deepEqual(p.levels[0].steps, [
    { title: '排好欄位', done: false }, { title: '加上送出按鈕', done: false },
    { title: '調整手機版面', done: false }, { title: '檢查錯誤提示', done: false }]);
  assert.match(p.aiSays, /第 1\/4 步：排好欄位/);

  assert.equal(s.progress({ done: 1 }), true, '沒給 task 就是目前這一關');
  p = s.plan();
  assert.equal(p.cup, 0.25);
  assert.deepEqual(p.levels[0].steps.map(x => x.done), [true, false, false, false]);
  assert.match(p.aiSays, /第 2\/4 步：加上送出按鈕/);

  // 同一步裡動工具：水位慢慢往上，但不會超過下一格
  for (let i = 0; i < 50; i++) s.handle(otherTool);
  p = s.plan();
  assert.ok(p.cup > 0.25 && p.cup < 0.5, `水位 ${p.cup} 應該在第 2 格之內`);

  s.progress({ task: '1', done: 3 });
  assert.equal(s.plan().cup, 0.75, '進到下一步，步內的估算歸零');
  s.progress({ task: '1', done: 4 });
  assert.ok(s.plan().cup < 1, '步驟都報完了，但任務沒標完成就不會滿');

  s.handle(taskUpdate('1', C));
  s.handle(taskUpdate('2', D));
  p = s.plan();
  assert.equal(p.cup, 0, '下一個任務是新的一杯');
  assert.ok(p.levels[0].steps.every(x => x.done), '完成的任務，小步驟全部打勾');
});

test('小步驟：沒先給名稱也能只報數字；找不到任務就不動', () => {
  const { s } = run(prompt('a'), todos(['甲', D], ['乙', P]));
  assert.equal(s.progress({ task: '99', done: 1 }), false);
  s.progress({ task: '甲', done: 1, total: 2 });
  let p = s.plan();
  assert.equal(p.cup, 0.5);
  assert.deepEqual(p.levels[0].steps, [{ title: '第 1 步', done: true }, { title: '第 2 步', done: false }]);
  s.progress({ task: '1', done: 9 });
  assert.equal(s.plan().levels[0].steps.filter(x => x.done).length, 2, '報超過總數會被壓回去');
});

test('小步驟：沒回報的任務退回用工具次數估', () => {
  const { s } = run(prompt('a'), todos(['甲', D]));
  for (let i = 0; i < 5; i++) s.handle(otherTool);
  const p = s.plan();
  assert.ok(p.cup > 0 && p.cup <= 0.9);
  assert.equal(p.levels[0].steps, undefined);
});

test('小步驟：補白話名稱時不會洗掉先前給的步驟', () => {
  const { s } = run(prompt('a'), todos(['甲', D]));
  s.describe({ levels: [{ task: '1', title: '第一關', plain: 'x', steps: ['一', '二'] }] });
  s.describe({ levels: [{ task: '1', title: '改名的第一關', plain: 'y' }] });
  const l = s.plan().levels[0];
  assert.equal(l.title, '改名的第一關');
  assert.deepEqual(l.steps.map(x => x.title), ['一', '二']);
});

test('很長的話會被截短', () => {
  const { p } = run(prompt('很長'.repeat(100)));
  assert.ok(p.userSaid.length <= 60);
  assert.ok(p.world.length <= 9);
});

test('多個 Claude Code 視窗：跟著最近有動靜的那個，各自的進度互不干擾', () => {
  const hub = createHub();
  hub.handle({ session_id: 'A', cwd: '/x/alpha', ...prompt('A 的工作') });
  hub.handle({ session_id: 'A', ...todos(['A1', D]) });
  hub.handle({ session_id: 'B', cwd: '/x/beta', ...prompt('B 的工作') });
  let p = hub.plan();
  assert.equal(p.project, 'beta');
  assert.equal(p.userSaid, 'B 的工作');
  hub.handle({ session_id: 'A', ...todos(['A1', C]) });
  p = hub.plan();
  assert.equal(p.project, 'alpha');
  assert.deepEqual(shape(p), ['A1:done']);
});

const sessionOf = (p, id) => p.sessions.find(x => x.id === id);
const ev = (id, dir, e) => ({ session_id: id, cwd: dir, project_dir: dir, ...e });

test('多對話：清單列出每個對話，名稱取資料夾，重複的加編號', () => {
  const hub = createHub();
  hub.handle(ev('A', '/work/club-signup', prompt('a')));
  hub.handle(ev('B', 'C:\\Users\\user\\blog', prompt('b')));
  hub.handle(ev('C', '/other/club-signup', prompt('c')));
  const p = hub.plan();
  assert.deepEqual(p.sessions.map(x => x.name), ['club-signup', 'blog', 'club-signup #2']);
  assert.equal(p.selected, 'C', '沒選過就跟最近有動靜的');
  assert.equal(p.pinned, false);
  assert.equal(p.project, 'club-signup #2');
});

test('多對話：點選後固定顯示，不會被別的對話搶走', () => {
  const hub = createHub();
  hub.handle(ev('A', '/w/alpha', prompt('A 的工作')));
  hub.handle(ev('A', '/w/alpha', todos(['A1', D])));
  hub.handle(ev('B', '/w/beta', prompt('B 的工作')));
  assert.equal(hub.select('A'), true);
  hub.handle(ev('B', '/w/beta', todos(['B1', D], ['B2', P])));
  let p = hub.plan();
  assert.equal(p.selected, 'A');
  assert.equal(p.pinned, true);
  assert.equal(p.userSaid, 'A 的工作');
  assert.equal(sessionOf(p, 'B').total, 2, '沒被選的對話仍然更新自己的進度');
  assert.equal(hub.select('nope'), false);
  hub.select(null);
  assert.equal(hub.plan().selected, 'B', '取消固定後回到跟最近有動靜的');
});

test('多對話：兩個對話的水位互不影響', () => {
  const hub = createHub();
  hub.handle(ev('A', '/w/alpha', prompt('a')));
  hub.handle(ev('A', '/w/alpha', todos(['A1', D])));
  hub.handle(ev('B', '/w/beta', prompt('b')));
  hub.handle(ev('B', '/w/beta', todos(['B1', C], ['B2', C])));
  for (let i = 0; i < 6; i++) hub.handle(ev('A', '/w/alpha', otherTool));
  const p = hub.plan();
  assert.ok(sessionOf(p, 'A').cup > 0 && sessionOf(p, 'A').cup < 1);
  assert.equal(sessionOf(p, 'B').cup, 1);
});

test('多對話：沒被顯示的對話在等你，摘要照樣回報等待並帶專案名', () => {
  const hub = createHub();
  hub.handle(ev('A', '/w/alpha', prompt('a')));
  hub.handle(ev('A', '/w/alpha', todos(['A1', D])));
  hub.handle(ev('B', '/w/blog', prompt('b')));
  hub.handle(ev('B', '/w/blog', todos(['B1', D])));
  hub.select('A');
  assert.equal(summarize(hub.plan()).waiting, false);
  hub.handle(ev('B', '/w/blog', permission));
  const p = hub.plan();
  assert.equal(p.selected, 'A');
  assert.equal(sessionOf(p, 'B').waiting, true);
  const sum = summarize(p);
  assert.equal(sum.waiting, true);
  assert.equal(sum.waitingName, 'blog');
  assert.match(sum.waitingFor, /^blog：.*Bash/);
  assert.equal(sum.others, 1);
  hub.handle(ev('B', '/w/blog', otherTool));
  assert.equal(summarize(hub.plan()).waiting, false, '對方繼續做事後解除');
});

test('多對話：自己在等時，多對話才在提醒前面加專案名', () => {
  const solo = createHub();
  solo.handle(ev('A', '/w/alpha', prompt('a')));
  solo.handle(ev('A', '/w/alpha', todos(['A1', D])));
  solo.handle(ev('A', '/w/alpha', permission));
  assert.match(summarize(solo.plan()).waitingFor, /^Claude 想使用/);
  solo.handle(ev('B', '/w/beta', prompt('b')));
  solo.select('A');
  const sum = summarize(solo.plan());
  assert.equal(sum.waitingName, 'alpha');
  assert.match(sum.waitingFor, /^alpha：Claude 想使用/);
});

test('多對話：白話名稱和進度依專案資料夾貼到正確的對話', () => {
  const hub = createHub();
  hub.handle(ev('A', '/w/alpha', prompt('a')));
  hub.handle(ev('A', '/w/alpha', todos(['Create form', D])));
  hub.handle(ev('B', '/w/beta', prompt('b')));
  hub.handle(ev('B', '/w/beta', todos(['Create form', D])));   // 兩邊清單同名，最容易貼錯
  hub.select('B');
  assert.equal(hub.describe({ project_dir: '/w/alpha', levels: [{ task: '1', title: 'A 的表單', plain: 'x', steps: ['一', '二'] }] }), true);
  assert.equal(hub.progress({ project_dir: '/w/alpha', done: 1 }), true);
  let p = hub.plan();   // 顯示的是 B
  assert.equal(p.levels[0].title, 'Create form', 'B 沒被蓋到');
  assert.equal(p.levels[0].steps, undefined);
  hub.select('A');
  p = hub.plan();
  assert.equal(p.levels[0].title, 'A 的表單');
  assert.equal(p.cup, 0.5);
  // Windows 路徑大小寫、斜線不同也對得上
  hub.handle(ev('W', 'C:\\Users\\User\\Proj', prompt('w')));
  hub.handle(ev('W', 'C:\\Users\\User\\Proj', todos(['甲', D])));
  hub.describe({ project_dir: 'c:/users/user/proj/', levels: [{ task: '1', title: '白話甲', plain: 'x' }] });
  hub.select('W');
  assert.equal(hub.plan().levels[0].title, '白話甲');
});

test('多對話：同資料夾開多個時，貼到最近有動靜的那個；沒資料夾就貼目前顯示的', () => {
  const hub = createHub();
  const t0 = 1_000_000;
  hub.handle(ev('A', '/w/same', prompt('a')), t0);
  hub.handle(ev('A', '/w/same', todos(['甲', D])), t0);
  hub.handle(ev('B', '/w/same', prompt('b')), t0 + 10);
  hub.handle(ev('B', '/w/same', todos(['甲', D])), t0 + 10);
  hub.describe({ project_dir: '/w/same', levels: [{ task: '1', title: '貼給誰', plain: 'x' }] });
  hub.select('B');
  assert.equal(hub.plan().levels[0].title, '貼給誰');
  hub.select('A');
  assert.equal(hub.plan().levels[0].title, '甲');
  assert.equal(hub.describe({ levels: [{ task: '1', title: '預設貼這個', plain: 'x' }] }), true);
  assert.equal(hub.plan().levels[0].title, '預設貼這個');
  assert.equal(createHub().describe({ levels: [] }), false, '沒有任何對話時不會出錯');
});

test('多對話：對話結束或太久沒動靜會從清單移除，被選的結束後解除固定', () => {
  const hub = createHub();
  const t0 = 5_000_000;
  hub.handle(ev('A', '/w/alpha', prompt('a')), t0);
  hub.handle(ev('B', '/w/beta', prompt('b')), t0 + 1);
  hub.select('B');
  assert.equal(hub.handle({ session_id: 'B', hook_event_name: 'SessionEnd' }), true);
  let p = hub.plan();
  assert.deepEqual(p.sessions.map(x => x.id), ['A']);
  assert.equal(p.selected, 'A');
  assert.equal(p.pinned, false);
  assert.equal(hub.handle({ session_id: 'ghost', hook_event_name: 'SessionEnd' }), false);
  hub.handle(ev('C', '/w/gamma', prompt('c')), t0 + 7 * 3600e3);
  p = hub.plan();
  assert.deepEqual(p.sessions.map(x => x.id), ['C'], '超過 6 小時沒動靜的 A 被移除');
});

test('多對話：切換對話時，沒顯示過的舊通知不會突然冒出來', () => {
  const hub = createHub();
  hub.handle(ev('A', '/w/alpha', prompt('a')));
  hub.handle(ev('A', '/w/alpha', todos(['甲', D])));
  hub.handle(ev('B', '/w/beta', prompt('b')));
  hub.select('B');
  hub.handle(ev('A', '/w/alpha', prompt('加乙')));
  hub.handle(ev('A', '/w/alpha', todos(['甲', D], ['乙', P])));
  hub.select('A');
  assert.equal(hub.plan().toast, null);
});

const pre = (tool, input) => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
const post = (tool, input) => ({ hook_event_name: 'PostToolUse', tool_name: tool, tool_input: input });

test('現在在做什麼：各工具翻成白話，只用檔名', () => {
  assert.equal(activityOf('Read', { file_path: '/home/me/proj/src/index.html' }).text, '正在看 index.html');
  assert.equal(activityOf('Edit', { file_path: 'C:\\Users\\user\\proj\\style.css' }).text, '正在修改 style.css');
  assert.equal(activityOf('MultiEdit', { file_path: '/a/b.js' }).text, '正在修改 b.js');
  assert.equal(activityOf('Write', { file_path: '/a/post.md' }).text, '正在寫入 post.md');
  assert.equal(activityOf('NotebookEdit', { notebook_path: '/a/n.ipynb' }).text, '正在修改 n.ipynb');
  assert.equal(activityOf('Read', {}).text, '正在看檔案');
  assert.equal(activityOf('Grep', { pattern: 'secret' }).text, '正在搜尋檔案');
  assert.equal(activityOf('Glob', {}).text, '正在搜尋檔案');
  assert.equal(activityOf('WebFetch', { url: 'https://x' }).text, '正在上網查資料');
  assert.equal(activityOf('Task', {}).text, '請助手幫忙');
  assert.ok(activityOf('Read', { file_path: '/a/' + 'x'.repeat(80) + '.txt' }).text.length < 40, '很長的檔名會被截短');
});

test('現在在做什麼：Bash 只分類，不顯示指令內容', () => {
  const kind = cmd => activityOf('Bash', { command: cmd }).text;
  assert.equal(kind('npm test'), '正在跑測試');
  assert.equal(kind('npx vitest run'), '正在跑測試');
  assert.equal(kind('node --test'), '正在跑測試');
  assert.equal(kind('pip install requests'), '正在安裝套件');
  assert.equal(kind('npm install --save-dev electron'), '正在安裝套件');
  assert.equal(kind('git commit -m "fix"'), '正在儲存版本紀錄');
  assert.equal(kind('git push origin main'), '正在上傳到遠端');
  assert.equal(kind('npm run dev'), '正在啟動預覽');
  assert.equal(kind('npm run build'), '正在建置專案');
  assert.equal(kind('ls -la'), '正在跑指令');
  const secret = activityOf('Bash', { command: "curl -H 'Authorization: Bearer abc123SECRET' https://api.example.com/x" }).text;
  assert.equal(secret, '正在跑指令');
  assert.ok(!/abc123|SECRET|curl|api\.example/.test(secret));
});

test('現在在做什麼：清單類、技能、外部工具不更新動作', () => {
  for (const t of ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'Skill', 'mcp__plugin_quest-map_quest-map__describe_quest', 'mcp__x__y', 'Whatever']) {
    assert.equal(activityOf(t, {}), null, t);
  }
});

test('現在在做什麼：工具開始時泡泡更新，做完就恢復', () => {
  const { s } = run(prompt('把按鈕改紅色'));
  assert.equal(s.handle(pre('Read', { file_path: '/p/index.html' })), true);
  let p = s.plan();
  assert.equal(p.aiSays, '正在看 index.html…');
  assert.equal(p.activity.text, '正在看 index.html');
  assert.equal(s.handle(pre('Read', { file_path: '/p/index.html' })), false, '同一個動作不用重畫');
  s.handle(pre('Edit', { file_path: '/p/style.css' }));
  assert.equal(s.plan().aiSays, '正在修改 style.css…');
  s.handle(post('Edit', { file_path: '/p/style.css' }));
  p = s.plan();
  assert.deepEqual(p.activity, { text: '改好了 style.css', done: true });
  assert.equal(p.aiSays, '改好了 style.css，想下一步…', 'Claude 想下一步時，泡泡還看得到剛剛做了什麼');
  assert.equal(s.handle(pre('Skill', {})), false);
  assert.equal(s.handle(post('TodoWrite', { todos: [] })), true);
  assert.equal(s.plan().activity.text, '改好了 style.css', '清單類工具不會洗掉上一個動作');
  s.handle(stop('改好了。'));
  assert.equal(s.plan().activity, null, '收尾後不再顯示動作');
});

test('現在在做什麼：換到下一關時，上一關的動作不會帶過來', () => {
  const { s } = run(prompt('a'), todos(['甲', D], ['乙', P]), post('Write', { file_path: '/p/a.md' }));
  assert.equal(s.plan().aiSays, '在「甲」這關：寫好了 a.md，想下一步…');
  s.handle(todos(['甲', C], ['乙', D]));
  const p = s.plan();
  assert.equal(p.activity, null);
  assert.match(p.aiSays, /我正在打「乙」這關/);
  s.handle(pre('Read', { file_path: '/p/b.md' }));
  assert.equal(s.plan().aiSays, '在「乙」這關：正在看 b.md…');
});

test('現在在做什麼：做完的動作換成過去式', () => {
  const after = (tool, input) => { const s = createSession(); s.handle(prompt('a')); s.handle(post(tool, input)); return s.plan().activity.text; };
  assert.equal(after('Read', { file_path: '/p/index.html' }), '看完了 index.html');
  assert.equal(after('Write', { file_path: '/p/post.md' }), '寫好了 post.md');
  assert.equal(after('Grep', {}), '搜尋完了');
  assert.equal(after('Bash', { command: 'npm test' }), '測試跑完了');
  assert.equal(after('Bash', { command: 'ls' }), '指令跑完了');
  assert.equal(after('WebSearch', {}), '查完資料了');
});

test('現在在做什麼：有清單時泡泡帶著目前的關卡名稱', () => {
  const { s } = run(prompt('a'), todos(['做畫面', D], ['測試', P]));
  s.handle(pre('Edit', { file_path: '/p/style.css' }));
  assert.equal(s.plan().aiSays, '在「做畫面」這關：正在修改 style.css…');
});

test('現在在做什麼：等你的時候不會被動作蓋掉', () => {
  const { s } = run(prompt('a'), todos(['甲', D]), pre('Bash', { command: 'rm -rf x' }), permission);
  let p = s.plan();
  assert.equal(p.activity, null);
  assert.equal(p.aiSays, '這道門要你才打得開。');
  assert.match(p.waitingFor, /Bash/);
  s.handle(post('Bash', {}));
  p = s.plan();
  assert.equal(p.waitingFor, null);
  assert.equal(byTitle(p, '甲').status, 'doing');
});

test('Pre 事件不會讓清單類工具重複建關卡', () => {
  const s = createSession();
  s.handle(prompt('a'));
  assert.equal(s.handle(pre('TaskCreate', { subject: '甲' })), false);
  s.handle(post('TaskCreate', { subject: '甲' }) );
  s.handle({ ...pre('TaskCreate', { subject: '乙' }) });
  s.handle({ ...post('TaskCreate', { subject: '乙' }), tool_response: { task: { id: '2' } } });
  assert.deepEqual(s.plan().levels.map(l => l.title), ['甲', '乙']);
  const t = createSession();
  t.handle(prompt('a'));
  t.handle(pre('TodoWrite', { todos: [{ content: '甲', status: 'pending' }] }));
  t.handle(post('TodoWrite', { todos: [{ content: '甲', status: 'pending' }] }));
  assert.equal(t.plan().levels.length, 1);
  assert.equal(t.plan().toast, null);
});

test('這次動過的檔案：只記有改動的，同檔名去重，歸在單一任務', () => {
  const { s } = run(prompt('a'));
  s.handle(post('Read', { file_path: '/p/index.html' }));
  s.handle(post('Edit', { file_path: '/p/style.css' }));
  s.handle(post('Edit', { file_path: '/p/style.css' }));
  s.handle(post('Write', { file_path: '/p/post.md' }));
  s.handle(post('Bash', { command: 'ls' }));
  const l = s.plan().levels[0];
  assert.deepEqual(l.touched, [{ verb: '改了', name: 'style.css' }, { verb: '寫入', name: 'post.md' }]);
});

test('這次動過的檔案：歸在目前進行的那一關，新的一句話會清空', () => {
  const { s } = run(prompt('a'), todos(['甲', D], ['乙', P]));
  s.handle(post('Edit', { file_path: '/p/a.js' }));
  s.handle(todos(['甲', C], ['乙', D]));
  s.handle(post('Edit', { file_path: '/p/b.js' }));
  let p = s.plan();
  assert.deepEqual(byTitle(p, '甲').touched, [{ verb: '改了', name: 'a.js' }]);
  assert.deepEqual(byTitle(p, '乙').touched, [{ verb: '改了', name: 'b.js' }]);
  s.handle(prompt('再改一下'));
  p = s.plan();
  assert.ok(p.levels.every(l => !l.touched), '「這次」是你上一句話之後');
  assert.equal(p.activity, null);
});

test('收尾的一句話：去掉 markdown，只取第一句，限制長度', () => {
  assert.equal(summaryOf('## 完成\n**已經把送出按鈕改成紅色。** 檔案是 style.css'), '已經把送出按鈕改成紅色');
  assert.equal(summaryOf('- 改好了 [文件](http://x.example)，請看看'), '改好了 文件，請看看');
  assert.equal(summaryOf('Fixed the typo in README.md. Also updated the title.'), 'Fixed the typo in README.md');
  assert.equal(summaryOf('## 只有標題'), '只有標題');
  assert.ok(summaryOf('很長的一句話'.repeat(40)).length <= 60);
  assert.equal(summaryOf('兩處都改好了：\n- style.css：按鈕改成紅色\n- index.html：文字改成送出報名'), '兩處都改好了：style.css：按鈕改成紅色');
  assert.equal(summaryOf('我改好了：'), '我改好了');
  assert.equal(summaryOf('草稿寫好了，存在 /tmp/claude-0/proj/notes/post.md'), '草稿寫好了，存在 post.md');
  assert.equal(summaryOf('已存到 C:\\Users\\user\\proj\\post.md。'), '已存到 post.md');
  assert.equal(summaryOf(''), '');
  assert.equal(summaryOf(undefined), '');
});

test('單一任務：Claude 補的一句白話會成為這一關的名稱與說明', () => {
  const { s } = run(prompt('把送出按鈕改成紅色'));
  assert.equal(s.plan().levels[0].title, '處理你的要求');
  assert.equal(s.describe({ levels: [{ task: '1', title: '把按鈕改紅色', plain: '把送出按鈕的顏色改成紅色，讓人更容易看到', steps: ['找到按鈕', '改顏色'] }] }), true);
  const p = s.plan();
  assert.equal(p.levels[0].title, '把按鈕改紅色');
  assert.equal(p.levels[0].plain, '把送出按鈕的顏色改成紅色，讓人更容易看到');
  assert.deepEqual(p.levels[0].steps, [{ title: '找到按鈕', done: false }, { title: '改顏色', done: false }]);
  assert.equal(p.aiSays, '我正在處理「把按鈕改紅色」（第 1/2 步：找到按鈕）');
  assert.equal(p.round, 1);
});

test('單一任務：動作帶著白話名稱，小步驟照比例漲水位，完成後換成總結', () => {
  const { s } = run(prompt('把送出按鈕改成紅色'));
  s.describe({ levels: [{ task: '1', title: '把按鈕改紅色', plain: '把送出按鈕的顏色改成紅色', steps: ['找到按鈕', '改顏色'] }] });
  s.handle(pre('Edit', { file_path: '/p/style.css' }));
  assert.equal(s.plan().aiSays, '在「把按鈕改紅色」這關：正在修改 style.css…');
  assert.equal(s.progress({ done: 1 }), true, '沒給 task 也行');
  let p = s.plan();
  assert.equal(p.cup, 0.5);
  assert.deepEqual(p.levels[0].steps.map(x => x.done), [true, false]);
  s.progress({ task: '1', done: 2 });
  assert.ok(s.plan().cup < 1, '步驟報完但還沒收尾，不會滿');
  s.handle(stop('已經把送出按鈕改成紅色了。'));
  p = s.plan();
  assert.equal(p.levels[0].status, 'done');
  assert.equal(p.levels[0].title, '把按鈕改紅色', '名稱維持，不被總結蓋掉');
  assert.equal(p.levels[0].plain, '把送出按鈕的顏色改成紅色', '有白話說明就保留，不被技術性的總結蓋掉');
  assert.equal(p.summary, '已經把送出按鈕改成紅色了');
  assert.match(p.aiSays, /^完成：已經把送出按鈕改成紅色了/);
  assert.ok(p.levels[0].steps.every(x => x.done));
  assert.equal(p.cup, 1);
});

test('單一任務：下一件事不會沿用上一件的名稱和步驟', () => {
  const { s } = run(prompt('改按鈕'));
  s.describe({ levels: [{ task: '1', title: '把按鈕改紅色', plain: 'x', steps: ['一', '二'] }] });
  s.handle(stop('好了。'));
  s.handle(prompt('改標題'));
  const p = s.plan();
  assert.equal(p.round, 2);
  assert.equal(p.levels[0].title, '處理你的要求');
  assert.equal(p.levels[0].steps, undefined);
  assert.equal(p.levels[0].status, 'doing');
});

test('單一任務：Claude 後來才列待辦清單，就改用清單', () => {
  const { s } = run(prompt('做報名表單'));
  s.describe({ levels: [{ task: '1', title: '先給的名稱', plain: 'x' }] });
  s.handle(todos(['設計欄位', D], ['做畫面', P]));
  const p = s.plan();
  assert.deepEqual(p.levels.map(l => l.title), ['設計欄位', '做畫面']);
});

test('單一任務：多對話時依專案資料夾貼到正確的對話', () => {
  const hub = createHub();
  hub.handle(ev('A', '/w/alpha', prompt('改 A')));
  hub.handle(ev('B', '/w/beta', prompt('改 B')));
  assert.equal(hub.describe({ project_dir: '/w/alpha', levels: [{ task: '1', title: 'A 的白話', plain: 'x' }] }), true);
  hub.select('B');
  assert.equal(hub.plan().levels[0].title, '處理你的要求');
  hub.select('A');
  assert.equal(hub.plan().levels[0].title, 'A 的白話');
});

test('完成的定義：有清單時，做到一半 Stop 不算完成、不顯示總結', () => {
  const { p } = run(prompt('a'), todos(['甲', C], ['乙', D]), stop('我先做到這裡。'));
  assert.equal(p.summary, '');
  assert.match(p.aiSays, /停在這裡/);
  assert.deepEqual(shape(p), ['甲:done', '乙:doing']);
});

test('完成的定義：全部通關後的 Stop 才顯示總結', () => {
  const { p } = run(prompt('a'), todos(['甲', C], ['乙', C]), stop('兩個步驟都做完了。'));
  assert.equal(p.summary, '兩個步驟都做完了');
  assert.match(p.aiSays, /全部通關！兩個步驟都做完了/);
});

test('完成的定義：使用者中途加的分支也要做完才算', () => {
  const { s } = run(prompt('做報名表單'), todos(['甲', C], ['乙', D]), prompt('再加一個上傳頭像'), todos(['甲', C], ['乙', C], ['上傳頭像', P]));
  s.handle(stop('原本的做完了。'));
  let p = s.plan();
  assert.equal(p.summary, '', '原本的都做完了，但分支還沒做');
  assert.equal(p.round, 1, '分支算同一個世界，不會收合');
  assert.equal(byTitle(p, '上傳頭像').isNew, true);
  s.handle(todos(['甲', C], ['乙', C], ['上傳頭像', C]));
  s.handle(stop('頭像也做好了。'));
  p = s.plan();
  assert.equal(p.summary, '頭像也做好了');
  assert.equal(summarize(p).cup, 1);
});

test('完成的定義：已拆除的關卡不擋住完成', () => {
  const { s } = run(prompt('a'), todos(['甲', C], ['乙', D]), prompt('乙不要了，改做丙'), todos(['甲', C], ['丙', C]));
  s.handle(stop('改好了。'));
  const p = s.plan();
  assert.deepEqual(shape(p), ['甲:done', '乙:cancel', '丙:done']);
  assert.equal(p.summary, '改好了');
});

test('完成的定義：沒有清單的小任務，Stop 才算完成；問句結尾不算', () => {
  const { s, p } = run(prompt('把按鈕改紅色'));
  assert.equal(p.levels[0].status, 'doing');
  assert.equal(p.summary, '');
  s.handle(stop('要改成哪一種紅色？'));
  let q = s.plan();
  assert.equal(q.levels[0].status, 'wait');
  assert.equal(q.summary, '');
  s.handle(prompt('深紅色'));
  s.handle(stop('已經改成深紅色了。'));
  q = s.plan();
  assert.equal(q.levels[0].status, 'done');
  assert.equal(q.summary, '已經改成深紅色了');
  assert.equal(q.levels[0].plain, '已經改成深紅色了');
  assert.equal(q.round, 1);
});

test('完成的定義：小任務做到一半追加要求，要等之後的 Stop 才算完成', () => {
  const { s } = run(prompt('把按鈕改紅色'), pre('Edit', { file_path: '/p/style.css' }), prompt('順便把標題也放大'));
  let p = s.plan();
  assert.equal(p.round, 1, '追加的要求算同一個任務');
  assert.equal(p.levels[0].status, 'doing');
  s.handle(stop('按鈕和標題都改好了。'));
  p = s.plan();
  assert.equal(p.levels[0].status, 'done');
  assert.equal(p.summary, '按鈕和標題都改好了');
});

const cp = (steps, more) => ({ chat: true, goal: '建立打招呼檔案', steps: steps.map(([title, status]) => ({ title, status })), ...more });
const cowork = p => p.sessions.find(x => x.name.startsWith('Cowork'));

test('Cowork：沒有專案資料夾的 describe／progress 不會貼到 Claude Code 的對話上', () => {
  const hub = createHub();
  hub.handle(ev('A', '/w/alpha', prompt('改 A')));
  hub.handle(ev('A', '/w/alpha', todos(['做畫面', D], ['測試', P])));
  hub.select('A');
  assert.equal(hub.describe({ chat: true, levels: [{ task: '1', title: '建立打招呼檔案', plain: 'Cowork 的內容' }] }), true);
  assert.equal(hub.progress({ chat: true, done: 1, total: 2 }), true);
  let p = hub.plan();
  assert.equal(p.selected, 'A', '選著的 Claude Code 對話沒被搶走');
  assert.deepEqual(p.levels.map(l => l.title), ['做畫面', '測試'], 'Claude Code 的關卡沒被改到');
  assert.equal(p.sessions.length, 2);
  hub.select(cowork(p).id);
  p = hub.plan();
  assert.equal(p.source, 'chat');
  assert.equal(p.levels[0].title, '建立打招呼檔案');
  assert.equal(p.levels[0].plain, 'Cowork 的內容');
});

test('Cowork：quest_plan 把整份清單變成關卡，任務是獨立的對話，名稱是 Cowork・任務名', () => {
  const hub = createHub();
  assert.equal(hub.chatPlan(cp([['列出步驟', C], ['建立 hello.txt', D], ['確認內容', P]])), true);
  const p = hub.plan();
  assert.equal(p.source, 'chat');
  assert.equal(p.project, 'Cowork・建立打招呼檔案');
  assert.equal(p.world, '建立打招呼檔案');
  assert.equal(p.userSaid, '建立打招呼檔案');
  assert.deepEqual(shape(p), ['列出步驟:done', '建立 hello.txt:doing', '確認內容:todo']);
  assert.equal(p.toast, null, '第一次送清單不算結構改變');
  assert.equal(p.cup, 0.3, '進行中的那一步先給起點');
  assert.equal(p.sessions[0].name, 'Cowork・建立打招呼檔案');
});

test('Cowork：說明卡的技術細節寫 Cowork，不寫 Claude Code', () => {
  const hub = createHub();
  hub.chatPlan(cp([['甲', D]]));
  assert.equal(hub.plan().levels[0].tech, 'Cowork 進度清單：甲');
  const solo = createHub();
  solo.describe({ chat: true, levels: [] });
  assert.equal(solo.plan().levels[0].tech, 'Cowork 任務還沒有步驟清單');
  const code = createHub();
  code.handle(ev('A', '/w/alpha', prompt('a')));
  code.handle(ev('A', '/w/alpha', todos(['乙', D])));
  assert.equal(code.plan().levels[0].tech, 'Claude Code 待辦：乙');
});

test('Cowork：進度有變動就再送一次整份，狀態、新增、拆除都跟著變', () => {
  const hub = createHub();
  hub.chatPlan(cp([['列出步驟', C], ['建立 hello.txt', D], ['確認內容', P]]));
  hub.plan();
  hub.chatPlan(cp([['列出步驟', C], ['建立 hello.txt', C], ['確認內容', D]]));
  let p = hub.plan();
  assert.deepEqual(shape(p), ['列出步驟:done', '建立 hello.txt:done', '確認內容:doing']);
  hub.chatPlan(cp([['列出步驟', C], ['建立 hello.txt', C], ['確認內容', D], ['寄給使用者', P]]));
  p = hub.plan();
  assert.equal(byTitle(p, '寄給使用者').isNew, true);
  assert.match(byTitle(p, '寄給使用者').reason, /新關卡：Claude 調整了計畫/);
  assert.equal(p.toast, '地圖更新！新增 1 關');
  hub.chatPlan(cp([['列出步驟', C], ['建立 hello.txt', C], ['寄給使用者', D]]));
  p = hub.plan();
  assert.equal(byTitle(p, '確認內容').status, 'cancel');
  assert.match(byTitle(p, '確認內容').reason, /已拆除：Claude 調整了計畫/);
});

test('Cowork：waiting_for 讓目前那一步變成等你，下一次送清單就解除', () => {
  const hub = createHub();
  hub.chatPlan(cp([['寫信', D], ['寄出', P]], { waiting_for: '請告訴我要寄給誰' }));
  let p = hub.plan();
  assert.equal(byTitle(p, '寫信').status, 'wait');
  assert.equal(p.waitingFor, '請告訴我要寄給誰');
  const sum = summarize(p);
  assert.equal(sum.waiting, true);
  assert.equal(sum.mood, 'wait');
  hub.chatPlan(cp([['寫信', D], ['寄出', P]]));
  p = hub.plan();
  assert.equal(byTitle(p, '寫信').status, 'doing');
  assert.equal(p.waitingFor, null);
});

test('Cowork：全部步驟做完才算完成，總結只在完成時顯示', () => {
  const hub = createHub();
  hub.chatPlan(cp([['甲', C], ['乙', D]], { summary: '還沒做完的總結' }));
  let p = hub.plan();
  assert.equal(p.summary, '', '還沒做完就不顯示總結');
  hub.chatPlan(cp([['甲', C], ['乙', C]], { summary: '打招呼的檔案做好了' }));
  p = hub.plan();
  assert.equal(p.summary, '打招呼的檔案做好了');
  assert.equal(p.aiSays, '這個任務全部完成！打招呼的檔案做好了');
  assert.equal(p.cup, 1);
  assert.equal(summarize(p).mood, 'happy');
  hub.chatPlan(cp([['甲', C], ['乙', C], ['丙', P]]));
  assert.equal(hub.plan().summary, '', '使用者加了新的一步，又回到未完成');
});

test('Cowork：做完後用同一個代號開新任務，上一個收合成已通過的世界', () => {
  const hub = createHub();
  hub.chatPlan(cp([['甲', C]], { goal: '第一個任務' }));
  hub.chatPlan(cp([['乙', D]], { goal: '第二個任務' }));
  const p = hub.plan();
  assert.equal(p.round, 2);
  assert.equal(p.pastWorlds.length, 1);
  assert.deepEqual(shape(p), ['乙:doing']);
});

test('Cowork：不同代號是不同的任務，各自一份進度', () => {
  const hub = createHub();
  hub.chatPlan(cp([['甲', D]], { task_id: 'one', goal: '任務一' }));
  hub.chatPlan(cp([['乙', D], ['丙', P]], { task_id: 'two', goal: '任務二' }));
  const p = hub.plan();
  assert.deepEqual(p.sessions.map(x => x.name), ['Cowork・任務一', 'Cowork・任務二']);
  assert.equal(p.selected, p.sessions[1].id, '跟著最近有動靜的那個');
  hub.select(p.sessions[0].id);
  assert.deepEqual(shape(hub.plan()), ['甲:doing']);
});

test('Cowork：先補過白話（還沒送清單）的空任務，會被後來的 quest_plan 接手，不會變成兩個', () => {
  const hub = createHub();
  hub.describe({ chat: true, levels: [{ task: '1', title: '先給的名稱', plain: 'x' }] });
  hub.chatPlan(cp([['甲', D]], { task_id: 'hello' }));
  const p = hub.plan();
  assert.equal(p.sessions.length, 1);
  assert.equal(p.sessions[0].name, 'Cowork・建立打招呼檔案');
  assert.deepEqual(shape(p), ['甲:doing']);
});

test('Cowork：Claude Code 的對話呼叫 quest_plan 會被拒絕，不會重複建關卡', () => {
  const hub = createHub();
  hub.handle(ev('A', '/w/alpha', prompt('a')));
  hub.handle(ev('A', '/w/alpha', todos(['甲', D])));
  assert.equal(hub.chatPlan({ chat: false, goal: 'x', steps: [{ title: '乙', status: 'pending' }] }), false);
  assert.equal(hub.chatPlan(undefined), false);
  const p = hub.plan();
  assert.equal(p.sessions.length, 1);
  assert.deepEqual(shape(p), ['甲:doing']);
});

test('Cowork：沒有步驟的空清單不會壞掉；亂寫的狀態當作還沒做', () => {
  const hub = createHub();
  assert.equal(hub.chatPlan({ chat: true, goal: '只有目標', steps: [] }), true);
  assert.equal(hub.plan().levels[0].title, '處理你的要求');
  hub.chatPlan({ chat: true, goal: '只有目標', steps: [{ title: '甲', status: '亂寫' }, { title: '', status: 'completed' }, null] });
  assert.deepEqual(shape(hub.plan()), ['甲:todo']);
});

const failed = (tool, more) => ({ hook_event_name: 'PostToolUseFailure', tool_name: tool, tool_input: {}, error: 'Exit code 2', ...more });

test('工具失敗：按了同意但指令失敗，橘色解除並說「沒成功」', () => {
  const { s } = run(prompt('a'), todos(['甲', D]), pre('Bash', { command: 'ls /nope' }), permission);
  assert.equal(byTitle(s.plan(), '甲').status, 'wait');
  assert.equal(s.handle(failed('Bash')), true);
  const p = s.plan();
  assert.equal(byTitle(p, '甲').status, 'doing');
  assert.equal(p.waitingFor, null);
  assert.deepEqual(p.activity, { text: '剛剛那一步沒成功', done: true });
  assert.equal(p.aiSays, '在「甲」這關：剛剛那一步沒成功，想下一步…');
  assert.equal(summarize(p).waiting, false);
});

test('工具失敗：被你中斷的寫「被你中斷了」；失敗的修改不算動過檔案；沒下過指令或清單類工具不理它', () => {
  const { s } = run(prompt('a'), todos(['甲', D]));
  s.handle(failed('Edit', { tool_input: { file_path: '/p/a.css' } }));
  assert.equal(byTitle(s.plan(), '甲').touched, undefined, '失敗的修改不記入動過的檔案');
  s.handle(failed('Bash', { is_interrupt: true }));
  assert.equal(s.plan().activity.text, '剛剛被你中斷了');
  assert.equal(s.handle(failed('TodoWrite')), false);
  assert.equal(s.handle(failed('TaskUpdate')), false);
  assert.equal(createSession().handle(failed('Bash')), false);
  const before = s.plan().cup;
  s.handle(failed('Bash'));
  assert.equal(s.plan().cup, before, '失敗不算進水位的估算');
});

test('等了多久：開始等時記下時間，解除時清掉', () => {
  const { s } = run(prompt('a'), todos(['甲', D]));
  assert.equal(s.plan().waitSince, null);
  const t0 = Date.now();
  s.handle(permission);
  const p = s.plan();
  assert.ok(p.waitSince >= t0 && p.waitSince <= Date.now());
  s.handle(post('Bash', {}));
  assert.equal(s.plan().waitSince, null);
  s.handle(permission);
  assert.ok(s.plan().waitSince);
  s.handle(failed('Bash'));
  assert.equal(s.plan().waitSince, null, '失敗也會解除');
});

test('診斷：list() 列出地圖認得的對話，只有名稱、進度、是否在等、最後動靜，不含你說的話或指令', () => {
  const hub = createHub();
  hub.handle(ev('A', '/w/alpha', prompt('我的密碼是 hunter2')), 1_700_000_000_000);
  hub.handle(ev('A', '/w/alpha', todos(['甲', C], ['乙', D])), 1_700_000_000_000);
  hub.chatPlan(cp([['丙', D]], { goal: '聊天任務' }), 1_700_000_100_000);
  hub.handle(ev('B', '/w/beta', permission), 1_700_000_200_000);
  const list = hub.list();
  assert.deepEqual(list.map(x => x.name), ['alpha', 'Cowork・聊天任務', 'beta']);
  assert.deepEqual(list[0], { name: 'alpha', done: 1, total: 2, waiting: false, chat: false, lastAt: '2023-11-14T22:13:20.000Z' });
  assert.equal(list[1].chat, true);
  assert.equal(list[2].waiting, true, '收到要你同意的通知，就是在等');
  assert.equal(list[0].waiting, false);
  assert.ok(!/hunter2|我的密碼/.test(JSON.stringify(list)));
});

test('診斷：list() 不會用掉還沒顯示的通知', () => {
  const hub = createHub();
  hub.handle(ev('A', '/w/alpha', prompt('a')));
  hub.handle(ev('A', '/w/alpha', todos(['甲', D])));
  hub.handle(ev('A', '/w/alpha', prompt('加乙')));
  hub.handle(ev('A', '/w/alpha', todos(['甲', D], ['乙', P])));
  hub.list(); hub.list();
  assert.equal(hub.plan().toast, '地圖更新！新增 1 關');
});

test('清理使用者的話：拿掉桌面版塞的系統提示，留下使用者自己打的字', () => {
  const R = '<system-reminder>\nThe user started this session without choosing a folder. Do X.\n</system-reminder>';
  assert.equal(cleanPrompt(`${R}\n請用 Bash 執行 ls`), '請用 Bash 執行 ls');
  assert.equal(cleanPrompt(`請先看這個 ${R} 再做事`), '請先看這個 再做事');
  assert.equal(cleanPrompt(`${R}${R}\n只有後面這句`), '只有後面這句', '多個區塊都拿掉');
  assert.equal(cleanPrompt(R), '（系統訊息）', '只有系統提示時不會變成空白');
  assert.equal(cleanPrompt(''), '（系統訊息）');
  assert.equal(cleanPrompt(undefined), '（系統訊息）');
});

test('清理使用者的話：沒收尾的系統提示、編輯器標籤', () => {
  assert.equal(cleanPrompt('改一下按鈕<system-reminder> 這裡沒有結尾'), '改一下按鈕');
  assert.equal(cleanPrompt('<ide_opened_file>The user opened file.js</ide_opened_file>\n幫我修 bug'), '幫我修 bug');
  assert.equal(cleanPrompt('<ide_selection>const a = 1;</ide_selection> 這段是做什麼的'), '這段是做什麼的');
});

test('清理使用者的話：排程任務顯示任務名稱；普通的角括號文字不被誤刪', () => {
  assert.equal(cleanPrompt('<scheduled-task name="keepalive-check" file="x.md">\n每天檢查一次…'), '排程任務：keepalive-check');
  assert.equal(cleanPrompt('請把 <div class="a"> 改成 <section>'), '請把 <div class="a"> 改成 <section>');
  assert.equal(cleanPrompt('a <b> c'), 'a <b> c');
  assert.equal(cleanPrompt('  多個\n\n  空白\t壓成一個  '), '多個 空白 壓成一個');
});

test('清理使用者的話：地圖上的「你剛剛說」、世界名稱、目標都是清理後的文字', () => {
  const R = '<system-reminder>The user started this session without choosing a folder.</system-reminder>';
  const { p } = run({ hook_event_name: 'UserPromptSubmit', prompt: `${R}\n把送出按鈕改成紅色` });
  assert.equal(p.userSaid, '把送出按鈕改成紅色');
  assert.equal(p.world, '把送出按鈕改成紅色');
  assert.equal(p.goal, '把送出按鈕改成紅色');
  assert.ok(!/system-reminder/.test(JSON.stringify(p)));
  const sched = run({ hook_event_name: 'UserPromptSubmit', prompt: '<scheduled-task name="keepalive" x="1">跑一次</scheduled-task>' }).p;
  assert.equal(sched.userSaid, '排程任務：keepalive');
});

test('沒選資料夾的對話：名稱叫「未選資料夾的對話」，重複的加編號，Windows 路徑也一樣', () => {
  const hub = createHub();
  const dirA = 'C:\\Users\\user\\AppData\\Roaming\\Claude\\scratch-workspaces\\aaa\\bbb\\scratch-2026-11-18-8cd41a';
  const dirB = 'C:/Users/user/AppData/Roaming/Claude/scratch-workspaces/aaa/bbb/scratch-2026-11-18-ffffff';
  hub.handle(ev('A', dirA, prompt('a')));
  hub.handle(ev('B', dirB, prompt('b')));
  hub.handle(ev('C', 'C:\\Users\\user', prompt('c')));
  hub.handle(ev('D', '/home/me/scratch-workspaces-notes', prompt('d')));   // 名稱只是長得像，不算
  assert.deepEqual(hub.plan().sessions.map(x => x.name), ['未選資料夾的對話', '未選資料夾的對話 #2', 'user', 'scratch-workspaces-notes']);
});

test('不認得的事件不會壞掉', () => {
  const s = createSession();
  assert.equal(s.handle({ hook_event_name: 'SomethingNew' }), false);
  assert.equal(s.handle({}), false);
  s.handle({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: {} });
  s.handle({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '99', status: C } });
  assert.equal(s.plan().levels.length, 1);
});

test('同資料夾：沒說過話的舊對話，在新對話開始時被清掉', () => {
  const hub = createHub();
  hub.handle({ hook_event_name: 'SessionStart', session_id: 'old', project_dir: 'C:/Users/me/proj/footballpractice' }, 1000);
  hub.handle({ hook_event_name: 'SessionStart', session_id: 'new', project_dir: 'c:\\Users\\me\\proj\\footballpractice\\' }, 2000);
  hub.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'new', project_dir: 'C:/Users/me/proj/footballpractice', prompt: 'hi' }, 2100);
  const names = hub.list().map(x => x.name);
  assert.deepEqual(names, ['footballpractice']);
});

test('同資料夾：說過話的舊對話保留，新的叫 #2；不同資料夾互不影響', () => {
  const hub = createHub();
  hub.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'a', project_dir: '/w/proj', prompt: 'one' }, 1000);
  hub.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'b', project_dir: '/w/proj', prompt: 'two' }, 2000);
  hub.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'c', project_dir: '/w/other', prompt: 'three' }, 3000);
  assert.deepEqual(hub.list().map(x => x.name), ['proj', 'proj #2', 'other']);
});

test('同資料夾：被清掉的是使用者選的對話時，回到自動模式', () => {
  const hub = createHub();
  hub.handle({ hook_event_name: 'SessionStart', session_id: 'old', project_dir: '/w/proj' }, 1000);
  assert.ok(hub.select('old'));
  hub.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'new', project_dir: '/w/proj', prompt: 'go' }, 2000);
  assert.equal(hub.list().length, 1);
  assert.equal(hub.plan().userSaid, 'go');
});

test('還沒說過話的對話不列在清單也不當主角，第一次說話後才出現', () => {
  const hub = createHub();
  hub.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'a', project_dir: '/w/proj', prompt: 'one' }, 1000);
  hub.handle({ hook_event_name: 'SessionStart', session_id: 'b', project_dir: '/w/proj' }, 2000);
  let p = hub.plan();
  assert.equal(p.sessions.length, 1, '空殼對話不列出');
  assert.equal(p.userSaid, 'one', '畫面仍是說過話的那個');
  assert.equal(hub.list().find(x => x.fresh).fresh, true, '診斷仍看得到它，並標示 fresh');
  hub.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'b', project_dir: '/w/proj', prompt: 'two' }, 3000);
  p = hub.plan();
  assert.deepEqual(p.sessions.map(x => x.name), ['proj', 'proj #2']);
  assert.equal(p.userSaid, 'two');
});

test('只有 SessionStart 時回到待命畫面；在等你的對話就算還沒說話也要出現', () => {
  const hub = createHub();
  hub.handle({ hook_event_name: 'SessionStart', session_id: 'a', project_dir: '/w/proj' }, 1000);
  assert.equal(hub.plan().sessions.length, 0);
  assert.ok(!hub.plan().project);
  hub.handle({ hook_event_name: 'Notification', session_id: 'a', project_dir: '/w/proj', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }, 2000);
  assert.equal(hub.plan().sessions.length, 1);
  assert.equal(hub.plan().sessions[0].waiting, true);
});

test('你來做：標記的項目畫成橘色的門，並列出清單；Claude 驗證標完成才通關', () => {
  const s = createSession();
  s.handle({ hook_event_name: 'UserPromptSubmit', prompt: '更新外掛然後測試' });
  s.handle({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: [
    { content: '修好程式', status: 'completed' }, { content: '【你來做】更新外掛', status: 'in_progress' }, { content: '【你來做】測試全螢幕', status: 'pending' }] } });
  s.describe({ levels: [{ task: '【你來做】更新外掛', plain: '你的電腦要裝新版', steps: ['關掉舊地圖', '執行更新指令'] }] });
  let p = s.plan();
  assert.deepEqual(p.levels.map(l => [l.title, l.status]), [['修好程式', 'done'], ['更新外掛', 'wait'], ['測試全螢幕', 'todo']]);
  assert.deepEqual(p.levels[1].steps.map(x => x.title), ['關掉舊地圖', '執行更新指令']);
  assert.equal(p.levels[1].reason, '要你本人動手：做完回來告訴 Claude，它驗證過才算過關');
  assert.equal(p.waitKind, 'user');
  assert.match(p.waitingFor, /請你做：更新外掛/);
  assert.equal(p.waitSince, null, '不計時、不偵測');
  assert.equal(summarize(p).waiting, true, '邊緣水位和把手也變成等你');
  // 工具動靜不會把它解除；Stop 也不會讓它通關
  s.handle({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
  s.handle({ hook_event_name: 'Stop', last_assistant_message: '請你先更新外掛，做好跟我說。' });
  p = s.plan(); assert.equal(p.levels[1].status, 'wait');
  // 使用者回報（說話）、Claude 驗證後標完成，下一件才輪到
  s.handle({ hook_event_name: 'UserPromptSubmit', prompt: '做好了' });
  s.handle({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: [
    { content: '修好程式', status: 'completed' }, { content: '【你來做】更新外掛', status: 'completed' }, { content: '【你來做】測試全螢幕', status: 'in_progress' }] } });
  p = s.plan();
  assert.deepEqual(p.levels.map(l => l.status), ['done', 'done', 'wait']);
  assert.match(p.waitingFor, /測試全螢幕/);
});

test('你來做：沒有標記的項目不受影響；英文標記 [YOU] 與 quest_plan 步驟也認得', () => {
  const s = createSession();
  s.handle({ hook_event_name: 'UserPromptSubmit', prompt: 'x' });
  s.handle({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: [{ content: '一般項目', status: 'in_progress' }] } });
  assert.equal(s.plan().waitKind, null);
  assert.equal(s.plan().levels[0].status, 'doing');
  const c = createSession();
  c.startChat('任務');
  c.applyPlan({ goal: '任務', steps: [{ title: '[YOU] Update the plugin', status: 'in_progress' }, { title: 'Check it', status: 'pending' }] });
  const p = c.plan();
  assert.equal(p.levels[0].title, 'Update the plugin');
  assert.equal(p.levels[0].status, 'wait');
  assert.equal(p.waitKind, 'user');
});

test('你來做：TaskCreate 的項目也認得，權限提示優先於它', () => {
  const s = createSession();
  s.handle({ hook_event_name: 'UserPromptSubmit', prompt: 'x' });
  s.handle({ hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject: '【你來做】貼資料', description: '把設定貼回來' }, tool_response: { id: '1' } });
  s.handle({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'in_progress' } });
  let p = s.plan();
  assert.equal(p.levels[0].title, '貼資料'); assert.equal(p.levels[0].status, 'wait'); assert.equal(p.waitKind, 'user');
  s.handle({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  p = s.plan(); assert.equal(p.waitKind, 'approval');
});

test('你來做：Claude 自己標完成不算，要等使用者說過話才通關', () => {
  const s = createSession();
  s.handle({ hook_event_name: 'UserPromptSubmit', prompt: '做練習' });
  const todo = status => ({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: [{ content: '建檔', status: 'completed' }, { content: '【你來做】確認檔案', status }] } });
  s.handle(todo('in_progress'));
  s.handle(todo('completed'));   // 同一輪裡 Claude 自己標完成
  let p = s.plan();
  assert.equal(p.levels[1].status, 'wait', '使用者還沒回報，維持橘色');
  assert.equal(p.waitKind, 'user');
  s.handle({ hook_event_name: 'Stop', last_assistant_message: '全部做完了！' });
  assert.equal(s.plan().levels[1].status, 'wait', 'Stop 也不會讓它通關');
  s.handle({ hook_event_name: 'UserPromptSubmit', prompt: '我看過了，沒問題' });
  s.handle(todo('completed'));
  p = s.plan();
  assert.equal(p.levels[1].status, 'done');
  assert.equal(p.waitKind, null);
});

test('你來做：一開始就標完成（沒經過進行中）也要先等使用者；TaskUpdate 同樣', () => {
  const s = createSession();
  s.handle({ hook_event_name: 'UserPromptSubmit', prompt: 'x' });
  s.handle({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: [{ content: '【你來做】直接完成', status: 'completed' }] } });
  assert.equal(s.plan().levels[0].status, 'wait');
  const t = createSession();
  t.handle({ hook_event_name: 'UserPromptSubmit', prompt: 'x' });
  t.handle({ hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject: '【你來做】貼資料' }, tool_response: { id: '1' } });
  t.handle({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'in_progress' } });
  t.handle({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' } });
  assert.equal(t.plan().levels[0].status, 'wait');
  t.handle({ hook_event_name: 'UserPromptSubmit', prompt: '貼好了' });
  t.handle({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' } });
  assert.equal(t.plan().levels[0].status, 'done');
});

test('清理使用者的話：貼上內容的標籤拿掉，留下裡面的字', () => {
  assert.equal(cleanPrompt('<pasted_content id="e40d"> 請幫我做練習 1. 建立檔案 </pasted_content>'), '請幫我做練習 1. 建立檔案');
});

test('Claude Code 沒有待辦清單工具時，可以用 quest_plan 回報，也能標「你來做」', () => {
  const hub = createHub();
  hub.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'a', project_dir: 'C:/w/new', prompt: '做練習' });
  const plan = steps => ({ goal: '建立檔案並請我確認', world: '練習小村', steps, project_dir: 'C:\\w\\new', chat: false });
  assert.equal(hub.chatPlan(plan([{ title: '建立 hello.txt', status: 'completed' }, { title: '【你來做】確認 hello.txt', status: 'in_progress' }, { title: '收尾', status: 'pending' }])), true);
  let p = hub.plan();
  assert.equal(p.source, 'code', '仍是 Claude Code 的對話，不是 Cowork');
  assert.deepEqual(p.levels.map(l => [l.title, l.status]), [['建立 hello.txt', 'done'], ['確認 hello.txt', 'wait'], ['收尾', 'todo']]);
  assert.equal(p.waitKind, 'user');
  assert.equal(p.world, '練習小村');
  // 同一輪只認一個來源：之後用待辦清單工具的事件被忽略
  hub.handle({ hook_event_name: 'PostToolUse', session_id: 'a', project_dir: 'C:/w/new', tool_name: 'TodoWrite', tool_input: { todos: [{ content: '別的', status: 'in_progress' }] } });
  assert.equal(hub.plan().levels.length, 3);
  // Claude 自己標完成不算；使用者回報後才通關
  assert.equal(hub.chatPlan(plan([{ title: '建立 hello.txt', status: 'completed' }, { title: '【你來做】確認 hello.txt', status: 'completed' }, { title: '收尾', status: 'completed' }])), true);
  assert.equal(hub.plan().levels[1].status, 'wait');
  hub.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'a', project_dir: 'C:/w/new', prompt: '我確認好了' });
  hub.chatPlan(plan([{ title: '建立 hello.txt', status: 'completed' }, { title: '【你來做】確認 hello.txt', status: 'completed' }, { title: '收尾', status: 'completed' }]));
  assert.ok(hub.plan().levels.every(l => l.status === 'done'));
});

test('quest_plan：已經用待辦清單的對話不收；找不到對話也不收', () => {
  const hub = createHub();
  hub.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'a', project_dir: '/w/proj', prompt: 'x' });
  hub.handle({ hook_event_name: 'PostToolUse', session_id: 'a', project_dir: '/w/proj', tool_name: 'TodoWrite', tool_input: { todos: [{ content: '甲', status: 'in_progress' }] } });
  assert.equal(hub.chatPlan({ goal: 'g', steps: [{ title: '乙', status: 'pending' }], project_dir: '/w/proj', chat: false }), false);
  assert.deepEqual(hub.plan().levels.map(l => l.title), ['甲']);
  assert.equal(createHub().chatPlan({ goal: 'g', steps: [], project_dir: '/nowhere', chat: false }), false);
});

const inPlan = () => {
  const s = createSession();
  s.handle({ hook_event_name: 'UserPromptSubmit', prompt: '幫我做報名表單' });
  s.handle({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: [{ content: '欄位', status: 'completed' }, { content: '畫面', status: 'in_progress' }] } });
  return s;
};

test('你剛剛說：計畫進行中的閒聊不會蓋掉任務要求', () => {
  const s = inPlan();
  s.handle({ hook_event_name: 'UserPromptSubmit', prompt: '這個字是什麼意思？' });
  assert.equal(s.plan().userSaid, '幫我做報名表單');
  s.handle({ hook_event_name: 'Stop', last_assistant_message: '它的意思是……' });
  s.handle({ hook_event_name: 'UserPromptSubmit', prompt: '謝謝' });
  assert.equal(s.plan().userSaid, '幫我做報名表單', 'Stop 後待定的話被丟掉，不會殘留');
});

test('你剛剛說：這句話讓計畫新增關卡，就升為「你剛剛說」', () => {
  const s = inPlan();
  s.handle({ hook_event_name: 'UserPromptSubmit', prompt: '再加一個上傳大頭照' });
  assert.equal(s.plan().userSaid, '幫我做報名表單');
  s.handle({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: [{ content: '欄位', status: 'completed' }, { content: '畫面', status: 'in_progress' }, { content: '上傳大頭照', status: 'pending' }] } });
  const p = s.plan();
  assert.equal(p.userSaid, '再加一個上傳大頭照');
  assert.match(p.levels[2].reason, /再加一個上傳大頭照/);
});

test('你剛剛說：Claude 帶 said 就顯示濃縮句，帶空字串就丟掉', () => {
  const s = inPlan();
  s.handle({ hook_event_name: 'UserPromptSubmit', prompt: '好那個按鈕我覺得顏色有點醜你可以改成紅色嗎還有字體也大一點' });
  s.describe({ said: '按鈕改紅色、字體加大', levels: [] });
  assert.equal(s.plan().userSaid, '按鈕改紅色、字體加大');
  s.handle({ hook_event_name: 'UserPromptSubmit', prompt: '哈哈你好強' });
  s.describe({ said: '', levels: [] });
  assert.equal(s.plan().userSaid, '按鈕改紅色、字體加大');
});

test('你剛剛說：沒有計畫在進行時照舊覆蓋（新任務、已完成、沒清單的小任務）', () => {
  const s = createSession();
  s.handle({ hook_event_name: 'UserPromptSubmit', prompt: '第一件事' });
  s.handle({ hook_event_name: 'UserPromptSubmit', prompt: '第二件事' });
  assert.equal(s.plan().userSaid, '第二件事', '沒有清單：說什麼顯示什麼');
  const d = inPlan();
  d.handle({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: [{ content: '欄位', status: 'completed' }, { content: '畫面', status: 'completed' }] } });
  d.handle({ hook_event_name: 'UserPromptSubmit', prompt: '接著做別的' });
  assert.equal(d.plan().userSaid, '接著做別的', '全部通關後的新一句是新任務');
});

test('已完成的世界最多保留 60 個，編號靠 round 推算', () => {
  const s = createSession();
  for (let i = 0; i < 65; i++) {
    s.handle({ hook_event_name: 'UserPromptSubmit', prompt: '任務 ' + i });
    s.handle({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: [{ content: '步驟 ' + i, status: 'completed' }] } });
  }
  const p = s.plan();
  assert.equal(p.pastWorlds.length, 60);
  assert.equal(p.round, 65);
});
