'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const fresh = () => { delete require.cache[require.resolve('../runtime')]; return require('../runtime'); };
const withEnv = (vars, fn) => {
  const old = {};
  for (const k of Object.keys(vars)) { old[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  const restore = () => { for (const k of Object.keys(old)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } };
  let out;
  try { out = fn(); } catch (e) { restore(); throw e; }
  if (out && typeof out.then === 'function') return out.finally(restore);   // 非同步函式要等它跑完才還原
  restore();
  return out;
};
const fakeElectronAt = (dir, binary) => {
  const pkg = path.join(dir, 'node_modules', 'electron');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"electron","main":"index.js"}');
  fs.writeFileSync(path.join(pkg, 'index.js'), `module.exports = ${JSON.stringify(binary)};`);
};

test('找元件的順序：指定 → 外掛資料 → 共用資料夾 → 程式資料夾，重複的只留一個', () => {
  withEnv({ CLAUDE_PLUGIN_DATA: '/data/plugin', QUEST_PET_RUNTIME: '/home/u/.quest-map/runtime' }, () => {
    const { candidateDirs } = fresh();
    const dirs = candidateDirs('/extra');
    assert.deepEqual(dirs.slice(0, 3), ['/extra', '/data/plugin', '/home/u/.quest-map/runtime']);
    assert.equal(dirs.length, 4);
    assert.deepEqual(candidateDirs('/data/plugin').slice(0, 2), ['/data/plugin', '/home/u/.quest-map/runtime']);
  });
});

test('共用資料夾預設在使用者資料夾底下，可以用環境變數改', () => {
  withEnv({ QUEST_PET_RUNTIME: undefined }, () => {
    assert.equal(fresh().sharedDir(), path.join(os.homedir(), '.quest-map', 'runtime'));
  });
  withEnv({ QUEST_PET_RUNTIME: '/custom' }, () => assert.equal(fresh().sharedDir(), '/custom'));
});

test('找得到就回傳元件路徑；每個位置都沒有就回傳 null', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-rt-'));
  const empty = path.join(root, 'empty'), shared = path.join(root, 'shared');
  fs.mkdirSync(empty);
  fakeElectronAt(shared, '/fake/electron-binary');
  const { findElectron } = fresh();
  assert.equal(findElectron([empty]), null);
  assert.equal(findElectron([empty, shared]), '/fake/electron-binary');
  fs.rmSync(root, { recursive: true, force: true });
});

test('先找到的位置優先', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-rt-'));
  const a = path.join(root, 'a'), b = path.join(root, 'b');
  fakeElectronAt(a, '/from/a'); fakeElectronAt(b, '/from/b');
  const { findElectron } = fresh();
  assert.equal(findElectron([a, b]), '/from/a');
  assert.equal(findElectron([b, a]), '/from/b');
  fs.rmSync(root, { recursive: true, force: true });
});

test('alive：地圖沒開回傳 false', async () => {
  await withEnv({ QUEST_PET_PORT: '1' }, async () => assert.equal(await fresh().alive(300), false));
});

test('ensureApp：關閉自動啟動時什麼都不做（不會去找或啟動元件）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-rt-'));
  await withEnv({ QUEST_PET_PORT: '1', QUEST_PET_RUNTIME: root, CLAUDE_PLUGIN_DATA: root, QUEST_PET_NO_AUTOLAUNCH: '1' }, async () => {
    assert.equal(await fresh().ensureApp({ wait: 500, cooldown: 0 }), false);
  });
  fs.rmSync(root, { recursive: true, force: true });
});

// 假的地圖程式：可以指定它的版本，以及支不支援 /quit
function fakeMap(version, { quit = true } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url}${req.headers['x-quest-pet'] ? ' [標頭]' : ''}`);
    req.resume();
    if (req.method === 'GET' && req.url === '/plan') { res.writeHead(200); return res.end('{}'); }
    if (req.method === 'GET' && req.url === '/version') {
      if (version === null) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ version }));
    }
    if (req.method === 'POST' && req.url === '/quit') {
      if (!quit) { res.writeHead(404); return res.end(); }
      if (req.headers['x-quest-pet'] !== '1') { res.writeHead(403); return res.end(); }
      res.writeHead(204); res.end();
      setTimeout(() => { server.close(); server.closeAllConnections(); }, 30);
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({ server, calls, port: server.address().port })));
}
const closeFake = m => { try { m.server.close(); m.server.closeAllConnections(); } catch { /* 已經關了 */ } };

test('版本比大小', () => {
  const { cmpVer } = fresh();
  assert.ok(cmpVer('0.10.0', '0.9.1') > 0);
  assert.ok(cmpVer('0.9.1', '0.10.0') < 0);
  assert.equal(cmpVer('0.11.0', '0.11.0'), 0);
  assert.ok(cmpVer('1.0.0', '0.99.99') > 0);
  assert.ok(cmpVer(undefined, '0.0.1') < 0, '不認得的格式當作最舊');
});

test('換新版：開著的地圖版本一樣，什麼都不做', async () => {
  const m = await fakeMap('0.11.0');
  const r = await withEnv({ QUEST_PET_PORT: String(m.port) }, () => fresh().replaceIfOld({ canStart: true, version: '0.11.0' }));
  closeFake(m);
  assert.equal(r, 'same');
  assert.ok(!m.calls.some(c => c.includes('/quit')));
});

test('換新版：開著的是舊版，要它自己結束（帶自訂標頭），等連接埠放掉', async () => {
  const m = await fakeMap('0.9.0');
  const r = await withEnv({ QUEST_PET_PORT: String(m.port) }, () => fresh().replaceIfOld({ canStart: true, version: '0.11.0' }));
  closeFake(m);
  assert.equal(r, 'replaced');
  assert.ok(m.calls.includes('POST /quit [標頭]'), '送了 /quit，而且帶標頭');
});

test('換新版：開著的比這個外掛更新時不降版', async () => {
  const m = await fakeMap('0.12.0');
  const r = await withEnv({ QUEST_PET_PORT: String(m.port) }, () => fresh().replaceIfOld({ canStart: true, version: '0.11.0' }));
  closeFake(m);
  assert.equal(r, 'same');
  assert.ok(!m.calls.some(c => c.includes('/quit')));
});

test('換新版：舊版沒有 /version 也沒有 /quit（0.10.0 以前），回報沒辦法自動換', async () => {
  const m = await fakeMap(null, { quit: false });
  const r = await withEnv({ QUEST_PET_PORT: String(m.port) }, () => fresh().replaceIfOld({ canStart: true, version: '0.11.0' }));
  closeFake(m);
  assert.equal(r, 'cannot');
});

test('換新版：找不到新版的桌面元件時，不敢關掉舊的', async () => {
  const m = await fakeMap('0.9.0');
  const r = await withEnv({ QUEST_PET_PORT: String(m.port) }, () => fresh().replaceIfOld({ canStart: false, version: '0.11.0' }));
  closeFake(m);
  assert.equal(r, 'cannot-start');
  assert.ok(!m.calls.some(c => c.includes('/quit')), '沒有送 /quit');
});
