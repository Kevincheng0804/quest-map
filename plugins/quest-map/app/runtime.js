'use strict';
// 找到桌面視窗元件（Electron）並啟動地圖。launch.js 和 mcp-server.js 共用。
// 元件裝在使用者層級的共用資料夾，Claude Code、Cowork 都用同一份，不用各下載一次。
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const PORT = () => Number(process.env.QUEST_PET_PORT) || 47600;
const sharedDir = () => process.env.QUEST_PET_RUNTIME || path.join(os.homedir(), '.quest-map', 'runtime');

// 找元件的順序：指定的資料夾 → 外掛專用資料夾 → 共用資料夾 → 程式資料夾本身
function candidateDirs(extra) {
  const out = [];
  for (const d of [extra, process.env.CLAUDE_PLUGIN_DATA, sharedDir(), __dirname]) if (d && !out.includes(d)) out.push(d);
  return out;
}

function findElectron(dirs) {
  for (const dir of dirs || candidateDirs()) {
    try { return require(require.resolve('electron', { paths: [dir] })); } catch { /* 換下一個位置找 */ }
  }
  return null;
}

// 地圖程式有沒有在跑
function alive(timeout = 600) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: PORT(), path: '/plan', timeout }, res => { res.resume(); res.on('end', () => resolve(res.statusCode < 300)); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function spawnApp(electron, appDir) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const extra = (process.env.QUEST_PET_ELECTRON_ARGS || '').split(' ').filter(Boolean);
  const child = spawn(electron, [appDir || __dirname, ...extra], { detached: true, stdio: 'ignore', env });
  child.on('error', () => { /* 元件壞掉或不能執行：不影響呼叫它的程式 */ });
  child.unref();
}

// 版本比大小（0.10.0 > 0.9.1）。不認得的格式當作最舊
const cmpVer = (a, b) => { const n = v => String(v || '').split('.').map(x => parseInt(x, 10) || 0); const x = n(a), y = n(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
const myVersion = () => { try { return require('./package.json').version; } catch { return null; } };

// 對地圖程式送一個請求，回傳 { status, body }（連不上時 status 是 0）
function ask(method, urlPath, headers, timeout = 800) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: PORT(), path: urlPath, method, headers: headers || {}, timeout }, res => {
      let b = ''; res.on('data', c => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.end(method === 'POST' ? '{}' : undefined);
  });
}

// 開著的地圖是不是比這個外掛舊？是的話，在新版元件找得到時要它自己結束，好讓呼叫的人接著啟動新版。
// 回傳：'same' 一樣或更新 | 'replaced' 已換掉（接著要啟動新版）| 'cannot' 舊版沒有 /quit，只能請使用者手動關 | 'cannot-start' 找不到元件，不敢關舊的
async function replaceIfOld({ canStart = !!findElectron(), version = myVersion() } = {}) {
  const v = await ask('GET', '/version');
  let running = null;
  if (v.status === 200) { try { running = JSON.parse(v.body).version; } catch { /* 當作舊版 */ } }
  if (running && cmpVer(running, version) >= 0) return 'same';   // 一樣或更新：不降版，免得兩邊外掛版本不同時互相踢來踢去
  if (!canStart) return 'cannot-start';
  const q = await ask('POST', '/quit', { 'x-quest-pet': '1' });
  if (q.status !== 204) return 'cannot';
  for (const end = Date.now() + 6000; Date.now() < end;) {
    await new Promise(r => setTimeout(r, 250));
    if (!(await alive(300))) return 'replaced';
  }
  return 'cannot';
}

// 只在已經裝好元件時才啟動；不下載、不出聲。冷卻時間內不重試。
let lastTry = 0;
async function ensureApp({ cooldown = 60000, wait = 8000 } = {}) {
  if (process.env.QUEST_PET_NO_AUTOLAUNCH) return false;
  if (await alive()) {
    // 開著的是舊版：換成新版（同樣受冷卻限制，不會反覆重開）
    if (Date.now() - lastTry < cooldown) return true;
    if ((await replaceIfOld()) !== 'replaced') return true;
    lastTry = Date.now();
  } else {
    if (Date.now() - lastTry < cooldown) return false;
    lastTry = Date.now();
  }
  const electron = findElectron();
  if (!electron) return false;
  spawnApp(electron, __dirname);
  for (const end = Date.now() + wait; Date.now() < end;) {
    await new Promise(r => setTimeout(r, 400));
    if (await alive()) return true;
  }
  return false;
}

module.exports = { PORT, sharedDir, candidateDirs, findElectron, alive, spawnApp, ensureApp, replaceIfOld, ask, myVersion, cmpVer };
