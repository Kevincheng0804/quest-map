'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStats } = require('../stats');

test('統計：記下事件名稱與次數，工具事件帶上工具名稱', () => {
  const st = createStats(() => 1_700_000_000_000);
  st.record('hook', { hook_event_name: 'PreToolUse', tool_name: 'Read', session_id: 'a', project_dir: '/p/x', cwd: '/p/x' });
  st.record('hook', { hook_event_name: 'PreToolUse', tool_name: 'Read', session_id: 'a' });
  st.record('hook', { hook_event_name: 'Stop', session_id: 'b' });
  st.record('describe', { project_dir: '/p/x' });
  st.record('progress', {});
  const snap = st.snapshot();
  assert.deepEqual(snap.events, { 'PreToolUse:Read': 2, Stop: 1, 'mcp:describe': 1, 'mcp:progress': 1 });
  assert.equal(snap.sessions, 2);
  assert.equal(snap.recent.length, 5);
  assert.deepEqual(snap.recent[0], { at: '2023-11-14T22:13:20.000Z', event: 'PreToolUse:Read', project_dir: '/p/x', cwd: '/p/x' });
});

test('統計：不含指令或檔案內容，只留名稱和資料夾', () => {
  const st = createStats();
  st.record('hook', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'curl -H "Authorization: Bearer SECRET123"' }, prompt: '我的密碼是 hunter2' });
  assert.ok(!/SECRET123|hunter2|curl/.test(JSON.stringify(st.snapshot())));
});

test('統計：最近事件最多留 8 筆；連線測試另外記', () => {
  const st = createStats();
  for (let i = 0; i < 12; i++) st.record('hook', { hook_event_name: 'PostToolUse', tool_name: 'T' + i });
  assert.equal(st.snapshot().recent.length, 8);
  assert.equal(st.snapshot().recent[7].event, 'PostToolUse:T11');
  assert.equal(st.snapshot().lastPing, null);
  st.ping({ platform: 'win32', host: 'PC', node: 'v22', project_dir: '/p', cwd: '/c', extra: 'ignored' });
  const ping = st.snapshot().lastPing;
  assert.equal(ping.platform, 'win32');
  assert.equal(ping.host, 'PC');
  assert.equal(ping.extra, undefined);
  assert.equal(st.snapshot().events['mcp:quest_ping'], 1);
});

test('統計：快照是複本，改它不會影響內部', () => {
  const st = createStats();
  st.record('hook', { hook_event_name: 'Stop' });
  const a = st.snapshot(); a.events.Stop = 999; a.recent.length = 0;
  assert.equal(st.snapshot().events.Stop, 1);
  assert.equal(st.snapshot().recent.length, 1);
});

test('統計：快照帶著地圖程式的版本，讓人看得出是不是舊版', () => {
  assert.equal(createStats(Date.now, '0.9.1').snapshot().version, '0.9.1');
  assert.equal(createStats().snapshot().version, null);
});
