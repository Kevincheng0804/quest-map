'use strict';
// 把 MCP 伺服器當成真的子程序跑，從外面用 JSON-RPC 對它說話。
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SERVER = path.join(__dirname, '..', 'mcp-server.js');
delete process.env.CLAUDE_PROJECT_DIR; delete process.env.QUEST_PET_CHAT; delete process.env.CLAUDE_CODE_REMOTE; delete process.env.CLAUDE_CODE_ENTRYPOINT; delete process.env.QUEST_PET_REMOTE;

function fakeMap() {
  const got = [];
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => { got.push({ url: req.url, body: b ? JSON.parse(b) : null }); res.writeHead(req.url === '/plan' ? 200 : 204); res.end('{}'); });
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({ server, got, port: server.address().port })));
}

// 啟動伺服器、送出請求，收齊回覆後關掉
function talk(env, requests, waitMs = 1500) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [SERVER], { env: { ...process.env, CLAUDE_CODE_REMOTE: '', CLAUDE_CODE_ENTRYPOINT: '', QUEST_PET_REMOTE: '', ...env }, stdio: ['pipe', 'pipe', 'ignore'] });
    const replies = []; let buf = '';
    child.stdout.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { replies.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    for (const r of requests) child.stdin.write(JSON.stringify(r) + '\n');
    setTimeout(() => { child.stdin.end(); child.kill(); resolve(replies); }, waitMs);
  });
}
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args || {} } });
const textOf = r => r.result.content[0].text;

test('MCP：工具清單有四個，包含 quest_plan 與 quest_ping', async () => {
  const replies = await talk({ QUEST_PET_NO_AUTOLAUNCH: '1', QUEST_PET_PORT: '1' }, [init, { jsonrpc: '2.0', id: 2, method: 'tools/list' }], 800);
  const names = replies.find(r => r.id === 2).result.tools.map(t => t.name).sort();
  assert.deepEqual(names, ['describe_quest', 'quest_ping', 'quest_plan', 'quest_progress']);
  assert.match(replies.find(r => r.id === 1).result.instructions, /沒有待辦清單的小修改也要補/);
});

test('MCP：quest_ping 連得到地圖時回報成功，並帶上這個伺服器跑在哪裡', async () => {
  const map = await fakeMap();
  const replies = await talk({ QUEST_PET_NO_AUTOLAUNCH: '1', QUEST_PET_PORT: String(map.port), CLAUDE_PROJECT_DIR: '/demo/proj' }, [init, call(2, 'quest_ping')]);
  map.server.close();
  assert.match(textOf(replies.find(r => r.id === 2)), /連線測試：成功/);
  assert.match(textOf(replies.find(r => r.id === 2)), /專案資料夾（CLAUDE_PROJECT_DIR）：\/demo\/proj/);
  const ping = map.got.find(g => g.url === '/ping');
  assert.ok(ping, '地圖收到了 /ping');
  assert.equal(ping.body.platform, process.platform);
  assert.equal(ping.body.host, os.hostname());
  assert.equal(ping.body.project_dir, '/demo/proj');
});

test('MCP：quest_ping 連不到地圖時回報失敗，不會當掉', async () => {
  const replies = await talk({ QUEST_PET_NO_AUTOLAUNCH: '1', QUEST_PET_PORT: '1' }, [init, call(2, 'quest_ping')]);
  const t = textOf(replies.find(r => r.id === 2));
  assert.match(t, /連線測試：失敗/);
  assert.match(t, /專案資料夾（CLAUDE_PROJECT_DIR）：沒有/);
});

// 一個固定回傳指定狀態碼的假伺服器
function fixedStatus(code) {
  const server = http.createServer((req, res) => { req.resume(); res.writeHead(code); res.end(); });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

test('MCP：quest_ping 遇到舊版地圖（回 404）時，說的是「舊版」，不是「沒開」', async () => {
  const old = await fixedStatus(404);
  const replies = await talk({ QUEST_PET_NO_AUTOLAUNCH: '1', QUEST_PET_PORT: String(old.port) }, [init, call(2, 'quest_ping')]);
  old.server.close();
  const t = textOf(replies.find(r => r.id === 2));
  assert.match(t, /地圖有開，但是舊版/);
  assert.match(t, /404/);
  assert.match(t, /完全關掉地圖再重新打開/);
  assert.doesNotMatch(t, /連不到/);
});

test('MCP：quest_ping 遇到其他錯誤碼時，照實寫出狀態碼', async () => {
  const bad = await fixedStatus(500);
  const replies = await talk({ QUEST_PET_NO_AUTOLAUNCH: '1', QUEST_PET_PORT: String(bad.port) }, [init, call(2, 'quest_ping')]);
  bad.server.close();
  const t = textOf(replies.find(r => r.id === 2));
  assert.match(t, /地圖有開，但回報了錯誤（HTTP 500）/);
});

test('MCP：quest_ping 連不上時，說明原因（連線被拒絕），並提示可能沒開', async () => {
  const replies = await talk({ QUEST_PET_NO_AUTOLAUNCH: '1', QUEST_PET_PORT: '1' }, [init, call(2, 'quest_ping')]);
  const t = textOf(replies.find(r => r.id === 2));
  assert.match(t, /失敗，連不到闖關地圖（ECONNREFUSED）/);
  assert.match(t, /可能沒有開/);
});

test('MCP：describe_quest 與 quest_progress 會帶上專案資料夾送給地圖', async () => {
  const map = await fakeMap();
  const replies = await talk({ QUEST_PET_NO_AUTOLAUNCH: '1', QUEST_PET_PORT: String(map.port), CLAUDE_PROJECT_DIR: '/demo/proj' }, [
    init,
    call(2, 'describe_quest', { levels: [{ task: '1', title: '把按鈕改紅色', plain: 'x' }] }),
    call(3, 'quest_progress', { done: 1 })
  ]);
  map.server.close();
  assert.match(textOf(replies.find(r => r.id === 2)), /地圖已更新/);
  assert.match(textOf(replies.find(r => r.id === 3)), /已記錄/);
  assert.equal(map.got.find(g => g.url === '/describe').body.project_dir, '/demo/proj');
  assert.equal(map.got.find(g => g.url === '/progress').body.done, 1);
});

test('MCP：沒有專案資料夾（Cowork）時，送出去的內容標記為聊天，而且沒有專案資料夾', async () => {
  const map = await fakeMap();
  const env = { QUEST_PET_NO_AUTOLAUNCH: '1', QUEST_PET_PORT: String(map.port), CLAUDE_PROJECT_DIR: '' };
  const replies = await talk(env, [init, call(2, 'describe_quest', { levels: [{ task: '1', title: 'x', plain: 'y' }] }),
    call(3, 'quest_plan', { goal: '建立檔案', steps: [{ title: '甲', status: 'in_progress' }] })]);
  map.server.close();
  assert.match(textOf(replies.find(r => r.id === 3)), /地圖已同步 1 個步驟/);
  const d = map.got.find(g => g.url === '/describe').body, c = map.got.find(g => g.url === '/chatplan').body;
  assert.equal(d.chat, true); assert.equal(d.project_dir, undefined);
  assert.equal(c.chat, true); assert.equal(c.goal, '建立檔案'); assert.equal(c.steps[0].status, 'in_progress');
});

test('MCP：有專案資料夾（Claude Code）時不是聊天；QUEST_PET_CHAT 可以強制', async () => {
  const map = await fakeMap();
  await talk({ QUEST_PET_NO_AUTOLAUNCH: '1', QUEST_PET_PORT: String(map.port), CLAUDE_PROJECT_DIR: '/demo/proj' }, [init, call(2, 'progress_dummy'), call(3, 'quest_progress', { done: 1 })]);
  await talk({ QUEST_PET_NO_AUTOLAUNCH: '1', QUEST_PET_PORT: String(map.port), CLAUDE_PROJECT_DIR: '/demo/proj', QUEST_PET_CHAT: '1' }, [init, call(4, 'quest_progress', { done: 2 })]);
  await talk({ QUEST_PET_NO_AUTOLAUNCH: '1', QUEST_PET_PORT: String(map.port), CLAUDE_PROJECT_DIR: '', QUEST_PET_CHAT: '0' }, [init, call(5, 'quest_progress', { done: 3 })]);
  map.server.close();
  const byDone = n => map.got.find(g => g.url === '/progress' && g.body.done === n).body;
  assert.equal(byDone(1).chat, false); assert.equal(byDone(1).project_dir, '/demo/proj');
  assert.equal(byDone(2).chat, true, 'QUEST_PET_CHAT=1 強制聊天');
  assert.equal(byDone(3).chat, false, 'QUEST_PET_CHAT=0 強制不是聊天');
});

test('MCP：地圖拒絕 quest_plan（409，已用待辦清單）時，回覆告訴 Claude 改用 describe_quest', async () => {
  const refuse = await fixedStatus(409);
  const replies = await talk({ QUEST_PET_NO_AUTOLAUNCH: '1', QUEST_PET_PORT: String(refuse.port), CLAUDE_PROJECT_DIR: '/demo/proj' },
    [init, call(2, 'quest_plan', { goal: 'x', steps: [] })]);
  refuse.server.close();
  const t = textOf(replies.find(r => r.id === 2));
  assert.match(t, /不需要 quest_plan/);
  assert.match(t, /不要再呼叫/);
});

test('MCP：quest_plan 缺少 goal 或 steps 時回報錯誤', async () => {
  const replies = await talk({ QUEST_PET_NO_AUTOLAUNCH: '1', QUEST_PET_PORT: '1' }, [init, call(2, 'quest_plan', { goal: 'x' }), call(3, 'quest_plan', { steps: [] })]);
  assert.equal(replies.find(r => r.id === 2).result.isError, true);
  assert.equal(replies.find(r => r.id === 3).result.isError, true);
});

const HOOK = path.join(__dirname, '..', 'hook.js');
const REMOTE_ENVS = [{ CLAUDE_CODE_REMOTE: 'true' }, { CLAUDE_CODE_ENTRYPOINT: 'remote' }];

test('雲端：說明改成短版，叫 Claude 不要呼叫地圖的工具', async () => {
  for (const remote of REMOTE_ENVS) {
    const replies = await talk({ QUEST_PET_PORT: '1', ...remote }, [init], 700);
    const ins = replies.find(r => r.id === 1).result.instructions;
    assert.match(ins, /跑在雲端/);
    assert.match(ins, /請不要呼叫/);
    assert.doesNotMatch(ins, /沒有待辦清單的小修改也要補/);
  }
});

test('雲端：四個工具都只回「在雲端」，完全不對地圖連線（也不會去啟動地圖）', async () => {
  const map = await fakeMap();
  const replies = await talk({ QUEST_PET_PORT: String(map.port), CLAUDE_CODE_REMOTE: 'true', CLAUDE_PROJECT_DIR: '/cloud/proj' }, [
    init,
    call(2, 'describe_quest', { levels: [{ task: '1', title: 'x', plain: 'y' }] }),
    call(3, 'quest_progress', { done: 1 }),
    call(4, 'quest_plan', { goal: 'g', steps: [{ title: '甲', status: 'pending' }] }),
    call(5, 'quest_ping')
  ]);
  map.server.close();
  for (const id of [2, 3, 4]) {
    const r = replies.find(x => x.id === id).result;
    assert.ok(!r.isError);
    assert.match(textOf({ result: r }), /這個對話跑在雲端.*不用再呼叫/s);
  }
  assert.match(textOf(replies.find(x => x.id === 5)), /連線測試：失敗，這個對話跑在雲端/);
  assert.equal(map.got.length, 0, '假地圖沒有收到任何請求');
});

test('雲端：QUEST_PET_REMOTE=0 可以強制當成本機（測試或特殊環境）', async () => {
  const map = await fakeMap();
  const replies = await talk({ QUEST_PET_NO_AUTOLAUNCH: '1', QUEST_PET_PORT: String(map.port), CLAUDE_CODE_REMOTE: 'true', QUEST_PET_REMOTE: '0' }, [init, call(2, 'quest_ping')]);
  map.server.close();
  assert.match(textOf(replies.find(r => r.id === 2)), /連線測試：成功/);
  assert.doesNotMatch(replies.find(r => r.id === 1).result.instructions, /跑在雲端/);
});

// 把 hook 當成真的子程序跑：stdin 給它一筆事件，看假地圖有沒有收到
function runHook(env, ms = 700) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [HOOK], { env: { ...process.env, CLAUDE_CODE_REMOTE: '', CLAUDE_CODE_ENTRYPOINT: '', QUEST_PET_REMOTE: '', ...env }, stdio: ['pipe', 'ignore', 'ignore'] });
    const t0 = Date.now();
    child.on('exit', code => resolve({ code, ms: Date.now() - t0 }));
    child.stdin.write(JSON.stringify({ session_id: 's', hook_event_name: 'Stop' }));
    child.stdin.end();
    setTimeout(() => { child.kill(); }, ms + 1500);
  });
}

test('hook：本機會把事件送給地圖；雲端立刻結束、不連線', async () => {
  const map = await fakeMap();
  const local = await runHook({ QUEST_PET_PORT: String(map.port), CLAUDE_PROJECT_DIR: '/p' });
  assert.equal(local.code, 0);
  const sent = map.got.find(g => g.url === '/hook');
  assert.ok(sent, '本機送出了 /hook');
  assert.equal(sent.body.hook_event_name, 'Stop');
  assert.equal(sent.body.project_dir, '/p');
  const before = map.got.length;
  const cloud = await runHook({ QUEST_PET_PORT: String(map.port), CLAUDE_CODE_REMOTE: 'true' });
  await new Promise(r => setTimeout(r, 200));
  map.server.close();
  assert.equal(cloud.code, 0);
  assert.equal(map.got.length, before, '雲端沒有送任何請求');
});

test('MCP：地圖沒開時，描述工具回報「沒開」但不是錯誤', async () => {
  const replies = await talk({ QUEST_PET_NO_AUTOLAUNCH: '1', QUEST_PET_PORT: '1' }, [init, call(2, 'describe_quest', { levels: [] })]);
  const r = replies.find(x => x.id === 2);
  assert.ok(!r.result.isError);
  assert.match(textOf(r), /目前沒有開啟/);
});

test('MCP：地圖沒開、元件已安裝時，伺服器啟動會自動把它打開', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-auto-'));
  const marker = path.join(root, 'started.txt');
  const fake = path.join(root, 'fake-electron.sh');
  fs.writeFileSync(fake, `#!/bin/sh\necho "$@" > "${marker}"\n`, { mode: 0o755 });
  const pkg = path.join(root, 'node_modules', 'electron');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"electron","main":"index.js"}');
  fs.writeFileSync(path.join(pkg, 'index.js'), `module.exports = ${JSON.stringify(fake)};`);
  await talk({ QUEST_PET_PORT: '1', QUEST_PET_RUNTIME: root, CLAUDE_PLUGIN_DATA: root, QUEST_PET_NO_AUTOLAUNCH: '' }, [init], 1500);
  const started = fs.existsSync(marker);
  const args = started ? fs.readFileSync(marker, 'utf8').trim() : '';
  fs.rmSync(root, { recursive: true, force: true });
  assert.ok(started, '假的 electron 被啟動了');
  assert.match(args, /app$/, '啟動參數是程式資料夾');
});

test('MCP：設定 QUEST_PET_NO_AUTOLAUNCH 就不會自動打開', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-auto-'));
  const marker = path.join(root, 'started.txt');
  const fake = path.join(root, 'fake-electron.sh');
  fs.writeFileSync(fake, `#!/bin/sh\necho x > "${marker}"\n`, { mode: 0o755 });
  const pkg = path.join(root, 'node_modules', 'electron');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"electron","main":"index.js"}');
  fs.writeFileSync(path.join(pkg, 'index.js'), `module.exports = ${JSON.stringify(fake)};`);
  await talk({ QUEST_PET_PORT: '1', QUEST_PET_RUNTIME: root, CLAUDE_PLUGIN_DATA: root, QUEST_PET_NO_AUTOLAUNCH: '1' }, [init], 1200);
  const started = fs.existsSync(marker);
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(started, false);
});

test('MCP：describe_quest 與 quest_plan 的 schema 有 said，說明閒聊填空字串', async () => {
  const replies = await talk({ QUEST_PET_NO_AUTOLAUNCH: '1', QUEST_PET_PORT: '1' }, [init, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  const tools = replies.find(r => r.id === 2).result.tools;
  for (const name of ['describe_quest', 'quest_plan']) {
    const said = tools.find(t => t.name === name).inputSchema.properties.said;
    assert.ok(said, name + ' 有 said');
    assert.match(said.description, /閒聊/);
  }
});
