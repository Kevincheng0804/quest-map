'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { encode, parse, text } = require('../opener');
const { spawnApp } = require('../runtime');
const { createWatcher, isFullscreenState } = require('../fullscreen');
const { edgeBounds } = require('../placement');
const { EventEmitter } = require('events');

test('opener：只留資料夾名稱，去掉完整路徑與不認得的欄位', () => {
  const s = encode({ by: 'code', projectDir: 'C:\\Users\\me\\proj\\footballpractice', secret: 'x', upgraded: true });
  assert.deepEqual(parse(s), { by: 'code', project: 'footballpractice', upgraded: true });
  assert.ok(!s.includes('Users') && !s.includes('secret'));
  assert.equal(parse(encode({ by: 'code', projectDir: '/a/b/' + 'x'.repeat(100) })).project.length, 40);
});

test('opener：亂格式不炸', () => {
  assert.equal(parse('not json'), null);
  assert.equal(parse(undefined), null);
  assert.equal(parse('{"by":"hacker"}'), null);
  assert.equal(encode(null), '');
});

test('opener：給人看的句子（繁中／英文）', () => {
  assert.equal(text({ by: 'code', project: 'footballpractice' }, 'zh-TW'), '由「footballpractice」的 Claude Code 自動開啟');
  assert.equal(text({ by: 'code', project: 'footballpractice' }, 'en'), 'Opened automatically by Claude Code in "footballpractice"');
  assert.equal(text({ by: 'cowork' }, 'zh-TW'), '由 Cowork 自動開啟');
  assert.equal(text({ by: 'manual' }, 'zh-TW'), '由你輸入 /quest-map:open 開啟');
  assert.equal(text({ by: 'code' }, 'zh-TW'), '由 Claude Code 自動開啟');
  assert.match(text({ by: 'cowork', upgraded: true }, 'zh-TW'), /已自動更新到新版/);
  assert.equal(text(null, 'en'), '');
});

test('runtime.spawnApp：子程序拿得到 QUEST_PET_OPENED_BY，沒帶時不會殘留舊值', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opener-'));
  const out = path.join(dir, 'env.txt');
  fs.writeFileSync(path.join(dir, 'index.js'), `require('fs').writeFileSync(${JSON.stringify(out)}, process.env.QUEST_PET_OPENED_BY || 'NONE');`);
  const wait = async () => { for (let i = 0; i < 50 && !fs.existsSync(out); i++) await new Promise(r => setTimeout(r, 100)); return fs.readFileSync(out, 'utf8'); };
  spawnApp(process.execPath, dir, { by: 'code', projectDir: '/w/proj' });
  assert.deepEqual(JSON.parse(await wait()), { by: 'code', project: 'proj' });
  fs.unlinkSync(out);
  process.env.QUEST_PET_OPENED_BY = '{"by":"cowork"}';
  try { spawnApp(process.execPath, dir); assert.equal(await wait(), 'NONE'); } finally { delete process.env.QUEST_PET_OPENED_BY; }
});

test('全螢幕：狀態 2、3、4 算全螢幕', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(isFullscreenState), [false, true, true, true, false, false, false]);
});

function fakeSpawn() {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.killed = false; child.kill = () => { child.killed = true; };
  const calls = [];
  return { child, calls, spawn: (...a) => { calls.push(a); return child; } };
}

test('全螢幕偵測：只在狀態變化時通知，看不懂的輸出忽略', () => {
  const f = fakeSpawn(), seen = [];
  const w = createWatcher({ spawn: f.spawn, platform: 'win32', env: {}, onChange: v => seen.push(v) });
  assert.equal(w.start(), true);
  assert.equal(f.calls[0][0], 'powershell.exe');
  f.child.stdout.emit('data', '5\r\n5\r\n');
  f.child.stdout.emit('data', 'garbage\n2\n');
  f.child.stdout.emit('data', '3\n');
  f.child.stdout.emit('data', '5\n');
  assert.deepEqual(seen, [true, false]);
  assert.equal(w.info().state, 5);
});

test('全螢幕偵測：輸出被切成兩段也能接起來；程序結束會回到非全螢幕；stop 會 kill', () => {
  const f = fakeSpawn(), seen = [];
  const w = createWatcher({ spawn: f.spawn, platform: 'win32', env: {}, onChange: v => seen.push(v) });
  w.start();
  f.child.stdout.emit('data', '');
  f.child.stdout.emit('data', '2'); f.child.stdout.emit('data', '\n');
  assert.deepEqual(seen, [true]);
  f.child.emit('exit');
  assert.deepEqual(seen, [true, false]);
  const g = fakeSpawn(); const w2 = createWatcher({ spawn: g.spawn, platform: 'win32', env: {}, onChange: () => {} });
  w2.start(); w2.stop(); assert.equal(g.child.killed, true);
});

test('全螢幕偵測：非 Windows、被關閉、spawn 出錯都安靜不啟動', () => {
  const f = fakeSpawn();
  assert.equal(createWatcher({ spawn: f.spawn, platform: 'linux', env: {} }).start(), false);
  assert.equal(createWatcher({ spawn: f.spawn, platform: 'win32', env: { QUEST_PET_NO_FULLSCREEN_WATCH: '1' } }).start(), false);
  assert.equal(f.calls.length, 0);
  assert.equal(createWatcher({ spawn: () => { throw new Error('no powershell'); }, platform: 'win32', env: {} }).start(), false);
  const e = fakeSpawn(), seen = [];
  const w = createWatcher({ spawn: e.spawn, platform: 'win32', env: {}, onChange: v => seen.push(v) });
  w.start(); e.child.emit('error', new Error('x'));
  assert.equal(w.info().running, false);
});

test('edgeBounds：平常蓋工作區，全螢幕時蓋滿整個螢幕', () => {
  const d = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  assert.deepEqual(edgeBounds(d, false), d.workArea);
  assert.deepEqual(edgeBounds(d, true), d.bounds);
});
