#!/usr/bin/env node
// 把 儲存庫根目錄的 quest-map.html（地圖本體）包成桌面程式用的 map.html
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'quest-map.html'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8');   // 內嵌進去，單獨開網頁版也有多語言
const html = `<!DOCTYPE html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<script>\n${i18n}</script>\n</head>\n<body style="margin:0">\n${src}</body>\n</html>\n`;
fs.writeFileSync(path.join(__dirname, 'map.html'), html);
fs.writeFileSync(path.join(__dirname, '..', '..', '..', 'ai-quest-map-standalone.html'), html);
console.log('map.html 已更新');
