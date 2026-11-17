'use strict';
const { app, BrowserWindow, ipcMain, screen, Notification } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { createHub, summarize } = require('./state');
const { snapBattery, placeBattery, fitsDisplay } = require('./placement');
const { createStats } = require('./stats');

if (process.env.QUEST_PET_USERDATA) app.setPath('userData', process.env.QUEST_PET_USERDATA);

const PORT = Number(process.env.QUEST_PET_PORT) || 47600;
const BAT = { width: 150, height: 46 };   // 邊緣水位的小把手（等你時會多顯示專案名，所以比較寬）
const MAP = { width: 960, height: 600 };
const hub = createHub();
const VERSION = require('./package.json').version;
const stats = createStats(Date.now, VERSION);
const startedAt = new Date().toISOString();
let mapWin = null, batWin = null, edgeWin = null, lastPlan = hub.plan(), override = false, waitingIds = new Set();
let dragFrom = null, saveTimer = 0;

if (!app.requestSingleInstanceLock()) app.quit();

/* ---------- 記住視窗大小與位置 ---------- */
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
let saved = {};
function loadSaved() {
  try { saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) || {}; } catch { saved = {}; }
}
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
function saveNow() {
  clearTimeout(saveTimer);
  try { fs.mkdirSync(path.dirname(stateFile()), { recursive: true }); fs.writeFileSync(stateFile(), JSON.stringify(saved, null, 2)); } catch { /* 存不了就算了，下次用預設位置 */ }
}
const workAreas = () => screen.getAllDisplays().map(d => d.workArea);

// hook 事件很密（每個工具前後各一筆），合併成最多每 120 毫秒畫一次；通知留在狀態裡，不會遺失
let bcTimer = 0;
function scheduleBroadcast() {
  if (bcTimer) return;
  bcTimer = setTimeout(() => { bcTimer = 0; if (!override) broadcast(hub.plan()); }, 120);
}

function broadcast(plan) {
  lastPlan = plan;
  const s = summarize(plan);
  if (mapWin) mapWin.webContents.send('plan', plan);
  if (batWin) batWin.webContents.send('summary', s);
  if (edgeWin) edgeWin.webContents.send('summary', s);
  // 逐個對話追蹤：哪個專案剛進入「等你」，地圖又收起來時，就跳通知說是哪個專案
  const list = plan.sessions && plan.sessions.length ? plan.sessions : [{ id: '_', name: '', waiting: s.waiting, waitingFor: plan.waitingFor }];
  const now = new Set(list.filter(x => x.waiting).map(x => x.id));
  for (const x of list) {
    if (!now.has(x.id) || waitingIds.has(x.id) || !mapWin || mapWin.isVisible() || !Notification.isSupported()) continue;
    const many = list.length > 1;
    const n = new Notification({
      title: many ? `Claude Code 在等你・${x.name}` : 'Claude Code 在等你',
      body: x.waitingFor || '有一關需要你出手'
    });
    n.on('click', () => { if (x.id !== '_' && hub.select(x.id) && !override) broadcast(hub.plan()); expand(); });
    n.show();
  }
  waitingIds = now;
}

/* ---------- 電池：貼邊、拖曳 ---------- */
function batteryDisplay() {
  const all = screen.getAllDisplays();
  return all.find(d => saved.battery && d.id === saved.battery.displayId) || screen.getPrimaryDisplay();
}
// 邊緣水位：蓋住把手所在螢幕的整個工作區，滑鼠點擊會穿透過去
function placeEdge(display) { edgeWin.setBounds((display || batteryDisplay()).workArea); }
function dockBattery() {
  const display = batteryDisplay();
  placeEdge(display);
  batWin.setBounds(placeBattery(saved.battery, display.workArea, BAT));
  batWin.webContents.send('side', (saved.battery && saved.battery.side) || 'right');
}
function dragStart() { dragFrom = batWin.getBounds(); }
function dragMove(dx, dy) {
  if (!dragFrom) return;
  batWin.setBounds({ x: Math.round(dragFrom.x + dx), y: Math.round(dragFrom.y + dy), width: BAT.width, height: BAT.height });
}
function dragEnd() {
  if (!dragFrom) return;
  dragFrom = null;
  const b = batWin.getBounds();
  const display = screen.getDisplayMatching(b);
  const snap = snapBattery(b, display.workArea);
  saved.battery = { side: snap.side, ratio: snap.ratio, displayId: display.id };
  batWin.setBounds({ x: snap.x, y: Math.round(snap.y), width: BAT.width, height: BAT.height });
  batWin.webContents.send('side', snap.side);
  placeEdge(display);
  saveSoon();
}

function minimize() { dockBattery(); edgeWin.showInactive(); batWin.showInactive(); batWin.moveTop(); mapWin.hide(); saved.mode = 'battery'; saveSoon(); }
function expand() { mapWin.show(); batWin.hide(); edgeWin.hide(); saved.mode = 'map'; saveSoon(); }

function createWindows() {
  const common = { frame: false, alwaysOnTop: true, show: false, webPreferences: { preload: path.join(__dirname, 'preload.js') } };
  const mapBounds = fitsDisplay(saved.map, workAreas()) ? saved.map : MAP;
  mapWin = new BrowserWindow({ ...common, ...mapBounds, minWidth: 480, minHeight: 300, backgroundColor: '#cfe6ec', title: 'AI 任務闖關地圖' });
  mapWin.setAspectRatio(1440 / 900);
  mapWin.loadFile(path.join(__dirname, 'map.html'));
  const remember = () => { if (mapWin.isVisible() && !mapWin.isMinimized()) { saved.map = mapWin.getBounds(); saveSoon(); } };
  mapWin.on('resized', remember);
  mapWin.on('moved', remember);
  mapWin.on('close', () => { remember(); saveNow(); });
  mapWin.on('closed', () => app.quit());

  batWin = new BrowserWindow({ ...common, ...BAT, transparent: true, resizable: false, skipTaskbar: true, hasShadow: false, title: '闖關進度' });
  edgeWin = new BrowserWindow({ ...common, width: 800, height: 600, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true, hasShadow: false, title: '邊緣水位' });
  edgeWin.setIgnoreMouseEvents(true);
  edgeWin.setAlwaysOnTop(true, 'screen-saver');
  edgeWin.loadFile(path.join(__dirname, 'edge.html'));

  batWin.setAlwaysOnTop(true, 'screen-saver');
  batWin.loadFile(path.join(__dirname, 'battery.html'));

  // 上次縮成電池，這次就從電池開始，不打擾你
  if (saved.mode === 'battery') batWin.once('ready-to-show', minimize);
  else mapWin.once('ready-to-show', () => mapWin.show());
}

function startServer() {
  const server = http.createServer((req, res) => {
    const done = (code, body = '') => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(body); };
    if (req.method === 'GET' && req.url === '/plan') return done(200, JSON.stringify(lastPlan));
    // 排查用：收到了哪些事件、有沒有收到連線測試（只有次數與名稱，沒有指令內容）
    if (req.method === 'GET' && req.url === '/version') return done(200, JSON.stringify({ version: VERSION, startedAt }));
    if (req.method === 'GET' && req.url === '/stats') return done(200, JSON.stringify(stats.snapshot(), null, 2));
    if (req.method !== 'POST') return done(404);
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4e6) req.destroy(); });
    req.on('end', () => {
      let data;
      try { data = JSON.parse(body); } catch { return done(400); }
      if (process.env.QUEST_PET_DEBUG) fs.appendFileSync(path.join(app.getPath('userData'), 'events.log'), body + '\n');
      if (req.url === '/hook') {
        stats.record('hook', data);
        // 新的一句話會讓地圖回到自動模式
        if (data.hook_event_name === 'UserPromptSubmit') override = false;
        if (hub.handle(data) && !override) scheduleBroadcast();
      } else if (req.url === '/ping') {
        stats.ping(data);
        if (Notification.isSupported()) new Notification({ title: '闖關地圖：收到連線測試', body: `來自 ${data.host || '未知'}（${data.platform || '?'}）` }).show();
      } else if (req.url === '/describe') {
        stats.record('describe', data);
        // Claude 用 MCP 工具補上白話的世界名與關卡說明
        hub.describe(data);
        if (!override) scheduleBroadcast();
      } else if (req.url === '/quit') {
        // 換新版時，新的 launch.js 會要舊地圖自己結束。要帶自訂標頭：瀏覽器裡別的網頁不能對本機送帶自訂標頭的請求（會先被擋）
        if (req.headers['x-quest-pet'] !== '1') return done(403);
        setTimeout(() => app.quit(), 150);
      } else if (req.url === '/chatplan') {
        stats.record('chatplan', data);
        if (!hub.chatPlan(data)) return done(409);   // Claude Code 的對話不收 quest_plan
        if (!override) scheduleBroadcast();
      } else if (req.url === '/progress') {
        stats.record('progress', data);
        // Claude 回報目前任務的小步驟做完幾步，邊緣水位照著漲
        if (hub.progress(data) && !override) scheduleBroadcast();
      } else if (req.url === '/show') {
        expand();
      } else if (req.url === '/plan' && Array.isArray(data.levels) && data.levels.length) {
        // AI 直接給完整的白話計畫 JSON 時，以它為準
        override = true; broadcast(data);
      } else return done(404);
      done(204);
    });
  });
  server.on('error', err => console.error(`闖關地圖無法使用連接埠 ${PORT}：${err.message}`));
  server.listen(PORT, '127.0.0.1');
}

app.whenReady().then(() => {
  loadSaved();
  createWindows();
  startServer();
  ipcMain.on('pet:ready', e => {
    if (mapWin && e.sender === mapWin.webContents) e.sender.send('plan', { ...lastPlan, toast: null });
    else { e.sender.send('summary', summarize(lastPlan)); e.sender.send('side', (saved.battery && saved.battery.side) || 'right'); }
  });
  ipcMain.on('pet:select', (_e, id) => { if (hub.select(String(id))) broadcast(hub.plan()); });
  ipcMain.on('pet:minimize', minimize);
  ipcMain.on('pet:expand', expand);
  ipcMain.on('pet:close', () => app.quit());
  ipcMain.on('pet:drag-start', dragStart);
  ipcMain.on('pet:drag-move', (_e, d) => dragMove(Number(d && d.dx) || 0, Number(d && d.dy) || 0));
  ipcMain.on('pet:drag-end', dragEnd);
  app.on('second-instance', expand);
  // 螢幕配置變了，電池重新貼邊
  screen.on('display-metrics-changed', () => { if (batWin.isVisible()) dockBattery(); });
  screen.on('display-removed', () => { if (batWin.isVisible()) dockBattery(); });

  // 開發用：QUEST_PET_SHOT=資料夾 時自動截圖後結束；QUEST_PET_SHOT_DRAG="dx,dy" 會先模擬把電池拖過去
  if (process.env.QUEST_PET_SHOT) {
    const dir = process.env.QUEST_PET_SHOT, tag = process.env.QUEST_PET_SHOT_TAG || 'pet';
    setTimeout(async () => {
      if (process.env.QUEST_PET_SHOT_SELECT) { hub.select(process.env.QUEST_PET_SHOT_SELECT); broadcast(hub.plan()); await new Promise(r => setTimeout(r, 1300)); }
      if (mapWin.isVisible()) fs.writeFileSync(path.join(dir, `${tag}-map.png`), (await mapWin.webContents.capturePage()).toPNG());
      if (!batWin.isVisible()) minimize();
      if (process.env.QUEST_PET_SHOT_DRAG) {
        const [dx, dy] = process.env.QUEST_PET_SHOT_DRAG.split(',').map(Number);
        dragStart(); dragMove(dx, dy); dragEnd();
      }
      setTimeout(async () => {
        fs.writeFileSync(path.join(dir, `${tag}-battery.png`), (await batWin.webContents.capturePage()).toPNG());
        fs.writeFileSync(path.join(dir, `${tag}-edge.png`), (await edgeWin.webContents.capturePage()).toPNG());
        console.log('EDGE', JSON.stringify(edgeWin.getBounds()), edgeWin.isVisible());
        console.log('BATTERY', JSON.stringify(batWin.getBounds()), 'MAP', JSON.stringify(mapWin.getBounds()));
        saveNow();
        app.quit();
      }, 1500);
    }, Number(process.env.QUEST_PET_SHOT_DELAY) || 6000);
  }
});
app.on('before-quit', saveNow);
app.on('window-all-closed', () => app.quit());
