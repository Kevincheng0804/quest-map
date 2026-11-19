'use strict';
// 偵測「有別的程式正在全螢幕」（例如全螢幕影片），邊緣水位的框才能跟著蓋滿整個螢幕。只在 Windows 做：
// 開一個常駐的隱藏 PowerShell，每 1.5 秒用系統的 SHQueryUserNotificationState 問一次，輸出狀態數字。
// 2＝全螢幕程式在跑、3＝全螢幕的遊戲／影片（D3D）、4＝簡報模式。任何一步失敗都安靜略過，維持原本的框大小。
const { spawn: realSpawn } = require('child_process');

const SCRIPT = [
  "Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class Q { [DllImport(\"shell32.dll\")] public static extern int SHQueryUserNotificationState(out int s); }'",
  'while ($true) { $s = 0; [void][Q]::SHQueryUserNotificationState([ref]$s); [Console]::Out.WriteLine($s); [Console]::Out.Flush(); Start-Sleep -Milliseconds 1500 }'
].join('; ');

const isFullscreenState = n => n === 2 || n === 3 || n === 4;

function createWatcher({ onChange, spawn = realSpawn, platform = process.platform, env = process.env } = {}) {
  let child = null, buf = '', fullscreen = false, lastState = null, started = false;
  const info = () => ({ running: !!child, state: lastState, fullscreen });
  function set(next) { if (next !== fullscreen) { fullscreen = next; try { onChange && onChange(fullscreen); } catch { /* 呼叫端出錯不影響偵測 */ } } }
  function start() {
    if (child || platform !== 'win32' || env.QUEST_PET_NO_FULLSCREEN_WATCH) return false;
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', SCRIPT], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { child = null; return false; }
    started = true; buf = '';
    child.on('error', () => { child = null; set(false); });
    child.on('exit', () => { child = null; set(false); });
    if (child.stdout) child.stdout.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        const n = Number(line);
        if (line !== '' && Number.isInteger(n)) { lastState = n; set(isFullscreenState(n)); }   // 看不懂的輸出直接忽略
      }
    });
    return true;
  }
  function stop() {
    const c = child; child = null;
    if (c) { try { c.kill(); } catch { /* 已經結束了 */ } }
    set(false);
  }
  return { start, stop, info, wasStarted: () => started };
}
module.exports = { createWatcher, isFullscreenState, SCRIPT };
