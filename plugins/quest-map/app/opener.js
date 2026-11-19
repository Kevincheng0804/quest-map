'use strict';
// 地圖是「誰」打開的：SessionStart hook（某個專案的 Claude Code）、Cowork 的 MCP、你自己輸入 /quest-map:open。
// 開啟時用環境變數 QUEST_PET_OPENED_BY 傳給桌面程式，讓它跟使用者說清楚。只傳資料夾名稱，不傳完整路徑。
const { t } = require('./i18n');
const BY = ['code', 'cowork', 'manual'];
const folderName = p => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop().slice(0, 40);

// 整理成安全的樣子：只留 by、project（資料夾名稱）、upgraded
function clean(op) {
  if (!op || !BY.includes(op.by)) return null;
  const out = { by: op.by };
  const project = folderName(op.project || op.projectDir);
  if (project) out.project = project;
  if (op.upgraded) out.upgraded = true;
  return out;
}
const encode = op => { const c = clean(op); return c ? JSON.stringify(c) : ''; };
function parse(str) { try { return clean(JSON.parse(str)); } catch { return null; } }

// 給人看的句子
function text(op, lang) {
  const c = clean(op);
  if (!c) return '';
  const base = c.by === 'code' ? (c.project ? t('open.code', { project: c.project }, lang) : t('open.codeNoName', null, lang))
    : c.by === 'cowork' ? t('open.cowork', null, lang) : t('open.manual', null, lang);
  return c.upgraded ? base + t('open.upgraded', null, lang) : base;
}
module.exports = { encode, parse, text, clean, folderName };
