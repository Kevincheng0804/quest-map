'use strict';
// 視窗擺放的純計算：電池吸附螢幕邊緣、還原上次位置、檢查視窗還在不在螢幕上。
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// 拖完放開：吸到比較近的左緣或右緣，上下不超出工作區。ratio 是上下位置的比例（0 最上、1 最下）
function snapBattery(bounds, workArea) {
  const side = bounds.x + bounds.width / 2 < workArea.x + workArea.width / 2 ? 'left' : 'right';
  const span = workArea.height - bounds.height;
  const y = clamp(bounds.y, workArea.y, workArea.y + Math.max(span, 0));
  return {
    x: side === 'left' ? workArea.x : workArea.x + workArea.width - bounds.width,
    y, side, ratio: span > 0 ? (y - workArea.y) / span : 0.5
  };
}

// 依照記住的邊與比例，算出電池在這個工作區的位置；沒記過就放右緣正中間
function placeBattery(saved, workArea, size) {
  const side = saved && saved.side === 'left' ? 'left' : 'right';
  const ratio = clamp(saved && Number.isFinite(saved.ratio) ? saved.ratio : 0.5, 0, 1);
  const span = Math.max(workArea.height - size.height, 0);
  return {
    x: side === 'left' ? workArea.x : workArea.x + workArea.width - size.width,
    y: Math.round(workArea.y + span * ratio),
    width: size.width, height: size.height
  };
}

// 記住的視窗位置還看得到嗎？（螢幕拔掉、解析度改了就可能跑到畫面外）
function fitsDisplay(bounds, workAreas, minW = 120, minH = 60) {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return false;
  return workAreas.some(wa => {
    const w = Math.min(bounds.x + bounds.width, wa.x + wa.width) - Math.max(bounds.x, wa.x);
    const h = Math.min(bounds.y + bounds.height, wa.y + wa.height) - Math.max(bounds.y, wa.y);
    return w >= minW && h >= minH;
  });
}

// 邊緣水位的框：貼著螢幕實際邊緣（不扣工作列），全螢幕影片時才不會比畫面小一圈
const edgeBounds = display => display.bounds;

module.exports = { snapBattery, placeBattery, fitsDisplay, edgeBounds };
