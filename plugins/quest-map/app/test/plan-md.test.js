'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const { parsePlan, planFileOk } = require('../plan-md');
const { createSession, createHub, cleanPrompt } = require('../state');

const USER_PLAN = `# 計畫：新增「main 的 args 陣列」動畫（array-args）

## Context

每個 Java 程式都寫 public static void main(String[] args)，但初學者不知道 args 是什麼。

## 流程

照專案的 Spectra 流程走：先用 /spectra-propose 建立變更提案，再用 /spectra-apply 實作。

## 動畫原始碼（預設參數 小明 3）

\`\`\`java
public class Main {
    public static void main(String[] args) {
        System.out.println(args.length);
    }
}
\`\`\`

## 步驟腳本（src/scenarios/syntax/array-args.ts）

1. intro：終端機列顯示 $ java Main 小明 3。
2. 建立 args：Java 在金庫蓋一組保險箱。
3. 印出 args.length。
4. for 迴圈：用 i 逐一印出。
5. "你好," + args[0]。
6. args[1] + 1 印出 31。
7. Integer.parseInt(args[1]) 得到 int 3。
8. n + 1 印出 4。
9. summary：說明沒給參數時的例外。

## 要改的地方

1. **直譯器**（src/lang/java/interpreter.ts）
   - compileJava 新增 args 參數
   - evalCall 新增 Integer.parseInt
2. Scenario 型別（src/core/types.ts）：加上 inputKind。
3. 窗格（src/main.ts 的 select()）
   - inputKind 為 args 時啟用
4. 保險箱能放字串
5. 終端機列：DeclVisual 新增 cmd 欄位。
6. 新動畫：src/scenarios/syntax/array-args.ts。
7. 註冊：src/scenarios/registry.ts。

## 驗證

- tests/array-args.test.ts
- npx vitest run 全部通過
`;

test('計畫模式的計畫：選到「要改的地方」，不是「步驟腳本」；子項目變小步驟；加上驗證', () => {
  const p = parsePlan(USER_PLAN);
  assert.equal(p.title, '新增「main 的 args 陣列」動畫（array-args）');
  assert.deepEqual(p.levels.map(l => l.title), ['直譯器', 'Scenario 型別', '窗格', '保險箱能放字串', '終端機列', '新動畫', '註冊']);
  assert.deepEqual(p.levels[0].steps, ['compileJava 新增 args 參數', 'evalCall 新增 Integer.parseInt']);
  assert.equal(p.verify, true);
});

test('英文計畫、只有勾選清單、沒有清單', () => {
  const en = parsePlan('# Plan: Add dark mode\n\n## Context\n- why\n- because\n\n## Implementation\n1. Add theme tokens\n2. Wire the toggle\n3. Persist the choice\n\n## Verification\n- run tests');
  assert.deepEqual(en.levels.map(l => l.title), ['Add theme tokens', 'Wire the toggle', 'Persist the choice']);
  assert.equal(en.title, 'Add dark mode'); assert.equal(en.verify, true);
  const cb = parsePlan('## 做法\n- [ ] 寫甲\n- [ ] 寫乙');
  assert.deepEqual(cb.levels.map(l => l.title), ['寫甲', '寫乙']);
  const weak = parsePlan('## 步驟\n1. 甲\n2. 乙');
  assert.equal(weak.levels.length, 2);
  assert.deepEqual(parsePlan('只是一段文字，沒有清單').levels, []);
  assert.deepEqual(parsePlan('').levels, []);
});

test('沒有關鍵字的標題：選頂層編號項目最多的段落；項目數與長度有上限', () => {
  const md = '## 想法\n1. 甲\n2. 乙\n\n## 工作內容\n' + Array.from({ length: 20 }, (_, i) => `${i + 1}. 項目${i}：${'說'.repeat(80)}`).join('\n');
  const p = parsePlan(md);
  assert.equal(p.levels.length, 12);
  assert.ok(p.levels[0].title.length <= 36);
  assert.equal(parsePlan('## 驗證\n1. 甲\n2. 乙\n3. 丙').levels.length, 0, '只有驗證段落不當作工作');
});

test('planFileOk：只接受 .claude/plans 底下的 md', () => {
  assert.ok(planFileOk('C:\\Users\\me\\.claude\\plans\\argv-lovely-thunder.md'));
  assert.ok(planFileOk('/home/me/.claude/plans/x.md'));
  assert.ok(!planFileOk('/etc/passwd'));
  assert.ok(!planFileOk('/home/me/.claude/settings.json'));
});

const prompted = () => { const s = createSession(); s.handle({ hook_event_name: 'UserPromptSubmit', prompt: '再來製作 argv 陣列介紹' }); return s; };
const exitPlan = (md = USER_PLAN) => ({ hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: md } });

test('核准的計畫：地圖出現關卡（第一關進行中）；被待辦清單取代且不殘留已拆除', () => {
  const s = prompted();
  assert.equal(s.handle(exitPlan()), true);
  let p = s.plan();
  assert.deepEqual(p.levels.map(l => l.status), ['doing', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo']);
  assert.equal(p.levels[7].title, '驗證');
  assert.equal(p.levels[0].steps.length, 2);
  assert.match(p.world, /^新增「main/);
  s.handle({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: [{ content: '改直譯器', status: 'in_progress' }, { content: '加動畫', status: 'pending' }] } });
  p = s.plan();
  assert.deepEqual(p.levels.map(l => l.title), ['改直譯器', '加動畫'], '計畫骨架被真正的待辦清單取代');
  assert.ok(p.levels.every(l => l.status !== 'cancel'));
});

test('核准的計畫：quest_plan、規格任務檔也會取代；已經用待辦清單時計畫不覆蓋', () => {
  const a = prompted(); a.handle(exitPlan());
  assert.equal(a.applyPlan({ goal: 'g', steps: [{ title: '甲', status: 'in_progress' }] }, true), true);
  assert.deepEqual(a.plan().levels.map(l => l.title), ['甲']);
  const b = prompted(); b.handle(exitPlan());
  b.handle({ hook_event_name: 'PostToolUse', tool_name: 'Read', spec_tasks: { name: 'c', groups: [{ title: '一', items: [{ text: 'x', done: false }] }] } });
  assert.deepEqual(b.plan().levels.map(l => l.title), ['一']);
  const c = prompted();
  c.handle({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: [{ content: '先有清單', status: 'in_progress' }] } });
  c.handle(exitPlan());
  assert.deepEqual(c.plan().levels.map(l => l.title), ['先有清單']);
});

test('核准的計畫：沒有可用清單的計畫不動地圖；plan_md 欄位也能用', () => {
  const s = prompted();
  s.handle(exitPlan('只是一段文字'));
  assert.equal(s.plan().levels[0].title, '處理你的要求');
  const t = prompted();
  t.handle({ hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode', tool_input: {}, plan_md: USER_PLAN });
  assert.equal(t.plan().levels.length, 8);
});

test('背景通知（task-notification）不會開新世界，也不會變成世界名稱', () => {
  const s = prompted();
  s.handle({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: [{ content: '甲', status: 'in_progress' }] } });
  const before = s.plan();
  s.handle({ hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>' });
  const after = s.plan();
  assert.equal(after.round, before.round);
  assert.equal(after.userSaid, before.userSaid);
  assert.equal(after.levels.length, 1);
  assert.equal(cleanPrompt('<task-notification><x>1</x></task-notification>'), '（系統訊息）');
  assert.equal(cleanPrompt('請看 <task-notification><x>1</x></task-notification> 這個'), '請看 這個');
  const done = prompted();
  done.handle({ hook_event_name: 'PostToolUse', tool_name: 'TodoWrite', tool_input: { todos: [{ content: '甲', status: 'completed' }] } });
  done.handle({ hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>done</task-notification>' });
  assert.equal(done.plan().round, 1, '完成後只有背景通知，不開新一輪');
});

test('hook.js：ExitPlanMode 只有檔案路徑時，從 .claude/plans 讀檔；其他目錄不讀', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-'));
  const plans = path.join(dir, '.claude', 'plans'); fs.mkdirSync(plans, { recursive: true });
  const f = path.join(plans, 'argv-lovely-thunder.md'); fs.writeFileSync(f, USER_PLAN);
  const other = path.join(dir, 'other.md'); fs.writeFileSync(other, '祕密 SECRET-TEXT');
  const got = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { got.push(JSON.parse(b)); res.statusCode = 204; res.end(); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const run = ev => new Promise(resolve => {
    const c = spawn(process.execPath, [path.join(__dirname, '..', 'hook.js')], { env: { ...process.env, QUEST_PET_PORT: String(srv.address().port), QUEST_PET_REMOTE: '0', CLAUDE_CODE_REMOTE: '' } });
    c.on('close', resolve); c.stdin.end(JSON.stringify(ev));
  });
  await run({ hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode', tool_input: {}, tool_response: { filePath: f } });
  await run({ hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode', tool_input: {}, tool_response: { filePath: other } });
  await run({ hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: USER_PLAN } });
  srv.close();
  assert.ok(got[0].plan_md.includes('要改的地方'));
  assert.equal(got[1].plan_md, undefined);
  assert.ok(!JSON.stringify(got[1]).includes('SECRET-TEXT'));
  assert.equal(got[2].plan_md, undefined, 'tool_input.plan 本來就在事件裡，不重送');
});

test('Claude Code 塞進來的各種系統訊息（agent-message 等）不會開新世界或變成名稱', () => {
  for (const tag of ['agent-message', 'teammate-message', 'system-notification', 'subagent-result']) {
    const raw = `<${tag} from="x">做完了</${tag}>`;
    assert.equal(cleanPrompt(raw), '（系統訊息）', tag);
    const s = createSession();
    s.handle({ hook_event_name: 'UserPromptSubmit', prompt: '我的事' });
    s.handle({ hook_event_name: 'UserPromptSubmit', prompt: raw });
    assert.equal(s.plan().userSaid, '我的事', tag);
    assert.equal(s.plan().round, 1, tag);
  }
  assert.equal(cleanPrompt('<agent-message from="x">沒收尾'), '（系統訊息）');
  assert.equal(cleanPrompt('請寫一個 <my-widget> 元件'), '請寫一個 <my-widget> 元件', '使用者自己寫的標籤不動');
});
