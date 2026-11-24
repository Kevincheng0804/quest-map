'use strict';
// Claude Code 計畫模式的計畫（ExitPlanMode 送出的 Markdown）→ 關卡。純函式，只靠標題與清單格式猜哪一段是「要做的工作」。
const MAX_LEVELS = 12, MAX_STEPS = 5;
const STRONG = /(要改|改動|變更|實作|實施|實現|做法|implementation|changes|approach|work items)/i;
const WEAK = /(步驟|流程|steps|tasks?|todo)/i;
const VERIFY = /(驗證|verification|verify|testing|test plan)/i;
const SKIP = /(context|背景|風險|risk|限制|open questions|待確認|問題)/i;

const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
// 去掉 Markdown 符號與編號，取第一句當標題
function itemTitle(raw) {
  let t = String(raw || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').replace(/^\s*\d+(?:\.\d+)*[.)]?\s+/, '');
  const cut = t.search(/[：:。]/);
  if (cut > 0) t = t.slice(0, cut);
  const bare = t.replace(/\s*（[^）]*）\s*$/, '').replace(/\s*\((?:[^()]|\([^()]*\))*\)\s*$/, '');   // 結尾的括號多半是檔案路徑，拿掉標題比較乾淨
  if (bare.trim().length >= 2) t = bare;
  return short(t, 36);
}
const headingText = h => String(h || '').replace(/^[\s\d.)、]+/, '').replace(/[*_`#]/g, '').trim();

function parsePlan(md) {
  const text = String(md || '').slice(0, 200 * 1024);
  const sections = [];
  let title = '', cur = null, fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const h = line.match(/^(#{1,6})\s+(.*\S)\s*$/);
    if (h) {
      if (h[1].length === 1 && !title) { title = headingText(h[2]).replace(/^(?:計畫|plan)\s*[：:]\s*/i, ''); continue; }
      cur = { heading: headingText(h[2]), items: [] }; sections.push(cur); continue;
    }
    if (!cur) { const m = !title && line.match(/^\s*(?:計畫|plan)\s*[：:]\s*(.+)$/i); if (m) title = headingText(m[1]); continue; }
    const top = line.match(/^ ?(?:\d+[.)]|[-*+])\s+(?:\[[ xX]\]\s+)?(.*\S)\s*$/);
    if (top) { cur.items.push({ title: itemTitle(top[1]), steps: [] }); continue; }
    const sub = line.match(/^\s{2,}(?:\d+[.)]|[-*+])\s+(?:\[[ xX]\]\s+)?(.*\S)\s*$/);
    if (sub && cur.items.length) { const last = cur.items[cur.items.length - 1]; if (last.steps.length < MAX_STEPS) last.steps.push(itemTitle(sub[1])); }
  }
  const usable = s => s.items.length >= 2 && s.items.some(i => i.title);
  const isVerifyOnly = s => VERIFY.test(s.heading) && !STRONG.test(s.heading);
  let pick = sections.find(s => usable(s) && STRONG.test(s.heading))
    || sections.find(s => usable(s) && WEAK.test(s.heading) && !isVerifyOnly(s) && !SKIP.test(s.heading))
    || sections.filter(s => s.items.length >= 3 && !isVerifyOnly(s) && !SKIP.test(s.heading)).sort((a, b) => b.items.length - a.items.length)[0];
  const levels = pick ? pick.items.filter(i => i.title).slice(0, MAX_LEVELS).map(i => ({ title: i.title, steps: i.steps.filter(Boolean) })) : [];
  const verify = !!levels.length && sections.some(s => s !== pick && VERIFY.test(s.heading));
  return { title: short(title, 40), levels, verify };
}

// ExitPlanMode 事件帶的計畫文字；沒有時 hook.js 會從 .claude/plans/ 讀檔後放進 plan_md
const planFileOk = p => /[\\/]\.claude[\\/]plans[\\/][^\\/]+\.md$/i.test(String(p || ''));
module.exports = { parsePlan, itemTitle, planFileOk };
