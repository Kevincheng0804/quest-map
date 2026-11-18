'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const lang = ipcRenderer.sendSync('pet:lang');   // { setting: 'auto' | 語言代碼, lang: 實際使用的語言 }

contextBridge.exposeInMainWorld('questPet', {
  lang,
  setLang: v => ipcRenderer.send('pet:set-lang', v),
  onPlan: fn => ipcRenderer.on('plan', (_e, plan) => fn(plan)),
  onSummary: fn => ipcRenderer.on('summary', (_e, s) => fn(s)),
  onSide: fn => ipcRenderer.on('side', (_e, side) => fn(side)),
  ready: () => ipcRenderer.send('pet:ready'),
  select: id => ipcRenderer.send('pet:select', id),
  minimize: () => ipcRenderer.send('pet:minimize'),
  expand: () => ipcRenderer.send('pet:expand'),
  close: () => ipcRenderer.send('pet:close'),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('pet:drag-move', { dx, dy }),
  dragEnd: () => ipcRenderer.send('pet:drag-end')
});
