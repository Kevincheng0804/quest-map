'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { encode, parse, text } = require('../opener');
const { spawnApp } = require('../runtime');
const { edgeBounds } = require('../placement');

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

test('edgeBounds：貼著螢幕實際邊緣，不扣工作列', () => {
  const d = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  assert.deepEqual(edgeBounds(d), d.bounds);
});
