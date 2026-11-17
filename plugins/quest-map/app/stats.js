'use strict';
// 記下地圖程式收到了什麼，給 GET /stats 用（排查「事件有沒有送到」）。只放在記憶體裡，不寫檔、不含指令內容。
function createStats(now = Date.now, version = null) {
  const S = { since: now(), events: {}, sessions: new Set(), recent: [], lastPing: null };
  const bump = key => { S.events[key] = (S.events[key] || 0) + 1; };
  return {
    // kind：'hook' | 'describe' | 'progress'
    record(kind, data) {
      data = data || {};
      const key = kind === 'hook'
        ? `${data.hook_event_name || '?'}${data.tool_name ? ':' + data.tool_name : ''}`
        : `mcp:${kind}`;
      bump(key);
      if (data.session_id) S.sessions.add(data.session_id);
      S.recent.push({ at: new Date(now()).toISOString(), event: key, project_dir: data.project_dir || null, cwd: data.cwd || null });
      if (S.recent.length > 8) S.recent.shift();
    },
    ping(info) {
      info = info || {};
      bump('mcp:quest_ping');
      S.lastPing = { at: new Date(now()).toISOString(), platform: info.platform || null, host: info.host || null, node: info.node || null, project_dir: info.project_dir || null, cwd: info.cwd || null };
    },
    snapshot() {
      return { version, since: new Date(S.since).toISOString(), events: { ...S.events }, sessions: S.sessions.size, lastPing: S.lastPing, recent: [...S.recent] };
    }
  };
}
module.exports = { createStats };
