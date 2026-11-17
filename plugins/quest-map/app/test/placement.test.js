'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { snapBattery, placeBattery, fitsDisplay } = require('../placement');

const WA = { x: 0, y: 25, width: 1920, height: 1055 };          // 主螢幕（上方有選單列）
const WA2 = { x: 1920, y: 0, width: 1280, height: 1024 };       // 右邊的第二個螢幕
const SIZE = { width: 92, height: 196 };

test('沒記過位置：放右緣正中間', () => {
  const b = placeBattery(undefined, WA, SIZE);
  assert.equal(b.x, 1920 - 92);
  assert.equal(b.y, Math.round(25 + (1055 - 196) / 2));
});

test('拖到左半邊放開：吸到左緣', () => {
  const s = snapBattery({ x: 300, y: 400, ...SIZE }, WA);
  assert.equal(s.side, 'left');
  assert.equal(s.x, 0);
  assert.equal(s.y, 400);
});

test('拖到右半邊放開：吸到右緣', () => {
  const s = snapBattery({ x: 1200, y: 400, ...SIZE }, WA);
  assert.equal(s.side, 'right');
  assert.equal(s.x, 1920 - 92);
});

test('拖出上下邊界：拉回工作區內', () => {
  assert.equal(snapBattery({ x: 1800, y: -300, ...SIZE }, WA).y, 25);
  assert.equal(snapBattery({ x: 1800, y: 5000, ...SIZE }, WA).y, 25 + 1055 - 196);
  assert.equal(snapBattery({ x: 1800, y: -300, ...SIZE }, WA).ratio, 0);
  assert.equal(snapBattery({ x: 1800, y: 5000, ...SIZE }, WA).ratio, 1);
});

test('在第二個螢幕上也貼那個螢幕的邊', () => {
  const s = snapBattery({ x: 3000, y: 100, ...SIZE }, WA2);
  assert.equal(s.side, 'right');
  assert.equal(s.x, 1920 + 1280 - 92);
});

test('記住的位置可以原樣還原', () => {
  const s = snapBattery({ x: 100, y: 613, ...SIZE }, WA);
  const b = placeBattery({ side: s.side, ratio: s.ratio }, WA, SIZE);
  assert.equal(b.x, 0);
  assert.equal(b.y, 613);
});

test('換了解析度：依比例落在新螢幕的同一個相對位置', () => {
  const small = { x: 0, y: 0, width: 1280, height: 720 };
  const b = placeBattery({ side: 'left', ratio: 1 }, small, SIZE);
  assert.equal(b.y, 720 - 196);
  assert.equal(placeBattery({ side: 'right', ratio: 9 }, small, SIZE).y, 720 - 196, '壞掉的比例也不會跑出畫面');
});

test('地圖視窗還在螢幕上才還原', () => {
  const areas = [WA, WA2];
  assert.equal(fitsDisplay({ x: 100, y: 100, width: 960, height: 600 }, areas), true);
  assert.equal(fitsDisplay({ x: 2000, y: 50, width: 960, height: 600 }, areas), true, '在第二個螢幕上');
  assert.equal(fitsDisplay({ x: 5000, y: 100, width: 960, height: 600 }, areas), false, '螢幕拔掉後跑到畫面外');
  assert.equal(fitsDisplay({ x: -900, y: 100, width: 960, height: 600 }, areas), false, '只露出一小條不算');
  assert.equal(fitsDisplay(undefined, areas), false);
  assert.equal(fitsDisplay({ x: 'a', y: 0, width: 1, height: 1 }, areas), false);
});
