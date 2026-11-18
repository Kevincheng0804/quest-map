'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../i18n');
const { createSession, setLang } = require('../state');

test('語言偵測：中文系統用繁體，其他用英文', () => {
  assert.equal(I.detect('zh-TW'), 'zh-TW');
  assert.equal(I.detect('zh-CN'), 'zh-TW');
  assert.equal(I.detect('en-US'), 'en');
  assert.equal(I.detect('ja-JP'), 'en');
  assert.equal(I.detect(''), 'en');
});

test('每個語言的鍵名一致，參數也一致', () => {
  const base = I.MESSAGES['zh-TW'];
  for (const { code } of I.LANGS) {
    const m = I.MESSAGES[code];
    assert.deepEqual(Object.keys(m).sort(), Object.keys(base).sort(), code + ' 的鍵名要跟繁中一樣');
    for (const k of Object.keys(base)) {
      const p = s => (s.match(/\{\w+\}/g) || []).sort().join();
      assert.equal(p(m[k]), p(base[k]), `${code}:${k} 的參數要一樣`);
    }
  }
});

test('缺的鍵退回繁中，不認得的語言用預設', () => {
  assert.equal(I.t('nope.key'), 'nope.key');
  assert.equal(I.t('status.done', null, 'xx'), '已通關');
  assert.equal(I.setLang('xx'), 'zh-TW');
});

test('英文介面：現在在做什麼、完成與等你都是英文', () => {
  setLang('en');
  try {
    const s = createSession();
    s.handle({ hook_event_name: 'UserPromptSubmit', prompt: 'make the button red' });
    s.handle({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/a/style.css' } });
    let p = s.plan();
    assert.equal(p.activity.text, 'Editing style.css');
    assert.match(p.aiSays, /Editing style\.css…/);
    s.handle({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/a/style.css' } });
    p = s.plan();
    assert.equal(p.activity.text, 'Edited style.css');
    assert.equal(p.levels[0].title, 'Handle your request');
    assert.equal(p.levels[0].touched[0].verb, 'Edited');
    s.handle({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
    p = s.plan();
    assert.match(p.waitingFor, /needs your approval/);
    assert.equal(p.levels[0].reason, 'Waiting for you: this step needs your own approval or answer');
  } finally { setLang('zh-TW'); }
});

test('英文介面：待命畫面也翻成英文，切回繁中又變回來', () => {
  const s = createSession();
  setLang('en');
  try {
    const p = s.plan();
    assert.equal(p.world, 'Waiting to start');
    assert.match(p.aiSays, /standby/);
    assert.equal(p.levels[0].title, 'Waiting to start');
  } finally { setLang('zh-TW'); }
  assert.equal(s.plan().world, '等待出發');
});
