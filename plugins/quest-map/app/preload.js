'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('questPet', {
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
