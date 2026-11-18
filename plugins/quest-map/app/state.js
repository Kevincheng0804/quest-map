'use strict';
// 把 Claude Code 的 hook 事件，翻成闖關地圖要的計畫 JSON。
const path = require('path');

const short = (s, n) => {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
// 兩個標題像不像（用相鄰兩字的重疊比例），用來分辨「改措辭」和「換成別件事」
const grams = t => { const g = new Set(); t = t.toLowerCase().replace(/\s+/g, ''); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };
const alike = (a, b) => { const x = grams(a), y = grams(b); let n = 0; x.forEach(g => { if (y.has(g)) n++; }); return n / Math.max(Math.min(x.size, y.size), 1) >= 0.5; };
// 使用者送出的文字常被桌面版或編輯器塞了一些不是使用者打的內容（系統提示、編輯器狀態、排程任務標籤），
// 顯示前先拿掉，地圖上才會是使用者自己的話。其他原樣保留，不猜別的標籤。
function cleanPrompt(text) {
  let t = String(text == null ? '' : text);
  const sched = t.match(/^\s*<scheduled-task\s+name="([^"]*)"/);
  if (sched) return `排程任務：${sched[1]}`;
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ');
  const open = t.indexOf('<system-reminder>');
  if (open >= 0) t = t.slice(0, open);   // 沒收尾的：從那裡切到結尾
  t = t.replace(/<(ide_[a-z_]+)>[\s\S]*?<\/\1>/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t || '（系統訊息）';
}
const baseName = p => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();

// Bash 指令只分類、不顯示內容（指令裡可能有密碼或金鑰）
const BASH_KINDS = [
  [/\b(jest|vitest|pytest|mocha|rspec|phpunit)\b|\b(npm|yarn|pnpm|bun)\s+(run\s+)?test\b|\b(go|cargo)\s+test\b|\bnode\s+--test\b/i, '正在跑測試'],
  [/\b(npm|yarn|pnpm|bun|pip3?|poetry|brew|apt(-get)?|cargo|gem|composer)\s+(install|add|i)\b/i, '正在安裝套件'],
  [/\bgit\s+commit\b/i, '正在儲存版本紀錄'],
  [/\bgit\s+push\b/i, '正在上傳到遠端'],
  [/\b(npm|yarn|pnpm|bun)\s+(run\s+)?(start|dev|serve|preview)\b|\bhttp\.server\b|\bserve\b/i, '正在啟動預覽'],
  [/\b(tsc|webpack)\b|\bvite\s+build\b|\b(next|cargo)\s+build\b|\b(npm|yarn|pnpm|bun)\s+(run\s+)?build\b/i, '正在建置專案']
];
// 工具 → 一句白話的「現在在做什麼」。只用檔名，不用完整路徑；不認得的工具回傳 null（不更新）。
function activityOf(tool, input) {
  input = input || {};
  const f = short(baseName(input.file_path || input.path || input.notebook_path), 28);
  switch (tool) {
    case 'Read': return { text: f ? `正在看 ${f}` : '正在看檔案' };
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return { text: f ? `正在修改 ${f}` : '正在修改檔案' };
    case 'Write': return { text: f ? `正在寫入 ${f}` : '正在寫入檔案' };
    case 'Grep': case 'Glob': return { text: '正在搜尋檔案' };
    case 'WebFetch': case 'WebSearch': return { text: '正在上網查資料' };
    case 'Task': case 'Agent': return { text: '請助手幫忙' };
    case 'Bash': { const cmd = String(input.command || ''); const hit = BASH_KINDS.find(([re]) => re.test(cmd)); return { text: hit ? hit[1] : '正在跑指令' }; }
    default: return null;
  }
}
// 工具跑完後改成過去式，留到下一個動作開始：Claude 想下一步的那幾秒，泡泡還看得到剛剛做了什麼
const PAST = [
  [/^正在看 (.+)$/, '看完了 $1'], [/^正在看檔案$/, '看完了檔案'],
  [/^正在修改 (.+)$/, '改好了 $1'], [/^正在修改檔案$/, '改好了檔案'],
  [/^正在寫入 (.+)$/, '寫好了 $1'], [/^正在寫入檔案$/, '寫好了檔案'],
  [/^正在搜尋檔案$/, '搜尋完了'], [/^正在上網查資料$/, '查完資料了'], [/^請助手幫忙$/, '助手回報了'],
  [/^正在跑測試$/, '測試跑完了'], [/^正在安裝套件$/, '套件裝好了'], [/^正在儲存版本紀錄$/, '版本紀錄存好了'],
  [/^正在上傳到遠端$/, '上傳完了'], [/^正在啟動預覽$/, '預覽啟動了'], [/^正在建置專案$/, '建置完了'], [/^正在跑指令$/, '指令跑完了']
];
const pastOf = text => { for (const [re, to] of PAST) if (re.test(text)) return text.replace(re, to); return text; };
// 動過哪個檔案（只記有改動的工具）
function touchedOf(tool, input) {
  input = input || {};
  const name = short(baseName(input.file_path || input.path || input.notebook_path), 28);
  if (!name) return null;
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return { verb: '改了', name };
  if (tool === 'Write') return { verb: '寫入', name };
  return null;
}
// Claude 收尾訊息的第一句白話：去掉 markdown 符號、標題、清單符號
function summaryOf(msg) {
  const raw = String(msg || '').replace(/(?:[A-Za-z]:)?(?:[\\/][^\s,，。；;:：()（）「」`]+){2,}/g, m => baseName(m)).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const body = raw.filter(l => !/^#{1,6}\s/.test(l));   // 標題不當總結，除非整段只有標題
  const lines = (body.length ? body : raw).map(l => l
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^(#{1,6}|[-*+>]|\d+[.)])\s+/, '')
    .replace(/[*_`~]/g, '').trim()).filter(Boolean);
  const line = /[:：]$/.test(lines[0] || '') && lines[1] ? lines[0] + lines[1] : (lines[0] || '');
  const m = line.match(/^(.{6,}?)(?:[。！？!?]|\.(?=\s|$))/);
  return short(m ? m[1] : line.replace(/[。！？!?.:：]+$/, ''), 60);
}
const MAP = { pending: 'todo', in_progress: 'doing', completed: 'done', deleted: 'cancel' };

function createSession() {
  const S = {
    round: 1, world: '等待出發', goal: '等 Claude Code 或 Cowork 開始工作', pastWorlds: [], finalGoal: '任務完成',
    userSaid: '', aiSays: '我在待命。你電腦上的 Claude Code 有動靜，或 Cowork 開始多步驟的工作，我就會動。一般聊天和雲端的對話我看不到。',
    levels: [], solo: 'todo', prompted: false, waitingFor: null, waitId: null, waitPrev: null,
    project: '', seq: 0, taskSeq: 0, toast: null, labels: new Map(), prog: new Map(),
    waitSince: null,   // 從什麼時候開始在等使用者（毫秒時間）
    chat: false,   // 來自 Cowork／聊天（沒有 hooks），進度全靠 Claude 回報
    activity: null, touched: new Map(), summary: ''   // 現在在做什麼、這次動過的檔案（依關卡）、收尾的一句話
  };
  // Claude 透過 MCP 工具補上的白話名稱：用待辦原文或任務編號對應
  const norm = t => String(t || '').trim().toLowerCase();
  const disp = l => {
    const b = S.labels.get(norm(l.title)) || S.labels.get(l.id);
    const out = b ? { ...l, title: b.title || l.title, plain: b.plain || l.plain, tech: b.tech || l.tech } : { ...l };
    const st = stepsOf(l);
    if (st) out.steps = st.names.map((title, i) => ({ title, done: l.status === 'done' || i < st.done }));
    return out;
  };
  // 一個任務裡的小步驟：名稱來自 describe_quest，做完幾步來自 quest_progress
  const stepsOf = l => {
    const b = S.labels.get(norm(l.title)) || S.labels.get(l.id);
    const p = S.prog.get(l.id);
    const total = Math.max((b && b.steps ? b.steps.length : 0), (p && p.total) || 0);
    if (!total) return null;
    const names = Array.from({ length: total }, (_, i) => (b && b.steps && b.steps[i]) || `第 ${i + 1} 步`);
    return { names, total, done: Math.min((p && p.done) || 0, total) };
  };
  const real = () => S.levels.filter(l => l.status !== 'cancel');
  // 沒有待辦清單的小任務也當成一關，Claude 補的白話名稱和小步驟就掛在它身上
  const soloLv = () => ({ id: 'solo' + S.round, title: '處理你的要求', status: S.solo });
  const quote = () => S.chat ? 'Claude 調整了計畫' : (S.userSaid ? `因為你說「${S.userSaid}」` : '計畫調整');
  const working = () => S.levels.find(l => l.status === 'doing') || S.levels.find(l => l.status === 'adjust');

  function clearWait() {
    if (!S.waitingFor) return false;
    const l = S.levels.find(x => x.id === S.waitId);
    if (l && l.status === 'wait') { l.status = S.waitPrev || 'doing'; delete l.reason; if (l.keepReason) l.reason = l.keepReason; }
    if (S.solo === 'wait') S.solo = 'doing';
    S.waitingFor = null; S.waitId = null; S.waitPrev = null; S.waitSince = null;
    return true;
  }
  function setWait(text) {
    clearWait();
    const l = working() || S.levels.find(x => x.status === 'todo');
    if (l) {
      S.waitId = l.id; S.waitPrev = l.status === 'todo' ? 'doing' : l.status;
      l.keepReason = l.reason; l.status = 'wait'; l.reason = '等你開門：這一步要你本人同意或回答';
    } else { S.solo = 'wait'; }
    S.waitingFor = text; S.waitSince = Date.now();
    S.aiSays = '這道門要你才打得開。';
  }
  function archive() {
    const r = real();
    S.pastWorlds.push({ name: S.world, summary: r.length ? r.map(l => disp(l).title).join('、') : S.goal });
    S.round++; S.levels = []; S.solo = 'doing';
    S.world = short(S.userSaid, 9) || `第 ${S.round} 輪`; S.goal = short(S.userSaid, 36) || S.world;
  }
  const allDone = () => { const r = real(); return r.length > 0 && r.every(l => l.status === 'done'); };
  function say() {
    const cur = working();
    const name = cur && disp(cur).title;
    const st = cur && stepsOf(cur);
    const at = st && st.done < st.total ? `（第 ${st.done + 1}/${st.total} 步：${st.names[st.done]}）` : '';
    if (cur) S.aiSays = cur.status === 'adjust' ? `我走回「${name}」這關重新修一下。${at}` : `我正在打「${name}」這關${at}，打完就往下一關！`;
    else if (!S.levels.length && S.prompted && S.solo === 'doing' && S.labels.has(soloLv().id)) {
      const sl = disp(soloLv()), sst = stepsOf(sl);
      const sat = sst && sst.done < sst.total ? `（第 ${sst.done + 1}/${sst.total} 步：${sst.names[sst.done]}）` : '';
      S.aiSays = `我正在處理「${sl.title}」${sat}`;
    }
    else if (allDone()) S.aiSays = '這個世界的關卡全部通關！';
  }
  function setToast(added, cancelled, rework) {
    const parts = [added && `新增 ${added} 關`, cancelled && `拆掉 ${cancelled} 關`, rework && `${rework} 關要回頭修`].filter(Boolean);
    if (parts.length) S.toast = '地圖更新！' + parts.join('，');
  }
  const nextStatus = (old, raw) => {
    const st = MAP[raw] || 'todo';
    if (old && (old.status === 'done' || old.status === 'adjust') && st !== 'done' && st !== 'cancel') return 'adjust';
    return st;
  };

  function onPrompt(raw) {
    const text = cleanPrompt(raw);
    clearWait();
    S.activity = null; S.touched.clear(); S.summary = '';
    S.userSaid = short(text, 60);
    S.levels.forEach(l => { delete l.isNew; });
    const fresh = !S.prompted;
    const finished = allDone() || (S.levels.length === 0 && S.prompted && S.solo === 'done');
    if (finished) archive();
    else if (fresh) { S.world = short(text, 9); S.goal = short(text, 36); S.solo = 'doing'; }
    S.prompted = true;
    S.aiSays = (fresh || finished) ? '收到！我先看看這趟要怎麼走。' : '聽到了！我看看路線要不要改。';
  }

  // TodoWrite：每次都給整份清單，用內容比對前後差異
  function onTodos(list) {
    if (!Array.isArray(list)) return;
    clearWait();
    if (allDone() && list.length && !list.some(t => S.levels.some(l => l.title === (t.content || t.subject)))) archive();
    const old = S.levels, oldActive = real(), hadPlan = oldActive.length > 0;
    const byTitle = new Map(oldActive.map(l => [l.title, l]));
    const newTitles = new Set(list.map(t => t.content || t.subject || ''));
    const used = new Set();
    let added = 0, rework = 0, cancelled = 0;
    const next = list.map((t, i) => {
      const title = t.content || t.subject || `步驟 ${i + 1}`;
      let o = byTitle.get(title);
      // 只是改措辭：同一個位置、清單一樣長，就當同一關，安靜更新
      if (!o && oldActive.length === list.length && oldActive[i] && !newTitles.has(oldActive[i].title) && alike(oldActive[i].title, title)) o = oldActive[i];
      if (o) used.add(o.id);
      const status = nextStatus(o, t.status);
      const lv = { id: o ? o.id : 't' + (++S.seq), title, status, plain: t.description || t.activeForm || title, tech: `${S.chat ? 'Cowork 進度清單' : 'Claude Code 待辦'}：${title}` };
      if (o && o.isNew) lv.isNew = true;
      if (o && o.reason && status !== 'done') lv.reason = o.reason;
      if (!o && hadPlan) { lv.isNew = true; lv.reason = `新關卡：${quote()}`; added++; }
      if (status === 'adjust' && (!o || o.status !== 'adjust')) { lv.reason = `回頭修：${quote()}`; rework++; }
      return lv;
    });
    // 從清單消失的：做完的留著，沒做完的算「已拆除」，放回原本的位置附近
    old.forEach((o, i) => {
      if (used.has(o.id)) return;
      if (o.status !== 'cancel' && o.status !== 'done') { o.status = 'cancel'; o.reason = `已拆除：${quote()}`; delete o.isNew; cancelled++; }
      const before = old.slice(0, i).reverse().find(x => next.some(n => n.id === x.id));
      next.splice(before ? next.findIndex(n => n.id === before.id) + 1 : 0, 0, o);
    });
    S.levels = next;
    setToast(added, cancelled, rework);
    say();
  }

  // TaskCreate / TaskUpdate：一次一筆
  function findId(resp) {
    if (resp == null) return null;
    const s = typeof resp === 'string' ? resp : JSON.stringify(resp);
    const m = s.match(/"(?:id|taskId|task_id)"\s*:\s*"?([\w-]+)/) || s.match(/[Tt]ask #?(\d+)/);
    return m ? m[1] : null;
  }
  function onTaskCreate(input, resp) {
    clearWait();
    if (allDone()) archive();
    const started = S.levels.some(l => l.status !== 'todo');
    let id = findId(resp);
    if (id && /^\d+$/.test(id)) S.taskSeq = Math.max(S.taskSeq, +id); else if (!id) id = String(++S.taskSeq);
    if (S.levels.some(l => l.id === 'k' + id)) return;
    const title = input.subject || input.content || `步驟 ${id}`;
    const lv = { id: 'k' + id, title, status: 'todo', plain: input.description || input.activeForm || title, tech: `Claude Code 任務 #${id}：${title}` };
    if (started) { lv.isNew = true; lv.reason = `新關卡：${quote()}`; setToast(1, 0, 0); }
    S.levels.push(lv);
  }
  function onTaskUpdate(input) {
    clearWait();
    const l = S.levels.find(x => x.id === 'k' + (input.taskId ?? input.id));
    if (!l) return;
    if (input.subject) l.title = input.subject;
    if (input.description) l.plain = input.description;
    if (!input.status) return;
    const st = nextStatus(l, input.status);
    if (st === 'cancel' && l.status !== 'cancel') { l.reason = `已拆除：${quote()}`; delete l.isNew; setToast(0, 1, 0); }
    else if (st === 'adjust' && l.status !== 'adjust') { l.reason = `回頭修：${quote()}`; setToast(0, 0, 1); }
    else if (st === 'done') delete l.reason;
    l.status = st;
    say();
  }

  function onNotification(e) {
    const type = e.notification_type || '', msg = String(e.message || '');
    const needsUser = type === 'permission_prompt' || type === 'elicitation_dialog' || (!type && /permission|needs your|waiting for your/i.test(msg));
    if (needsUser) {
      const tool = (msg.match(/permission to use (.+?)\.?$/i) || [])[1];
      setWait(tool ? `Claude 想使用「${tool}」，需要你按同意。請回到 Claude Code 視窗。` : `請回到 Claude Code 視窗回覆：${short(msg, 60)}`);
    } else if (type === 'idle_prompt' && !S.waitingFor) {
      S.aiSays = '我在等你的下一句話。';
    }
  }
  function onStop(e) {
    clearWait();
    S.activity = null;
    const asked = /[?？]\s*$/.test(String(e.last_assistant_message || '').trim());
    if (asked) { setWait('Claude 問了你一個問題，請回到 Claude Code 視窗回覆。'); return; }
    // 完成以計畫為準：Stop 只代表 Claude 停下來。有清單就要所有關卡（含使用者中途加的分支）都通關；沒有清單才用 Stop 當完成。
    S.summary = summaryOf(e.last_assistant_message);
    if (S.levels.length === 0) { if (S.prompted) S.solo = 'done'; S.aiSays = S.summary ? `完成：${S.summary}` : '做完了！等你的下一個指令。'; }
    else if (allDone()) S.aiSays = S.summary ? `這個世界全部通關！${S.summary}` : '這個世界全部通關！等你的下一個指令。';
    else S.aiSays = '我先停在這裡，回 Claude Code 看看我說了什麼。';
  }

  // 一杯水 = 一個任務。Claude Code 不會說一個任務做到幾成，所以用「這個任務已經動了幾次工具」估水位：
  // 越做越接近九成，真正完成才倒滿。
  const cupId = () => { const w = working() || S.levels.find(l => l.id === S.waitId); return w ? w.id : (S.levels.length ? null : 'solo'); };
  function tick() {
    const id = cupId();
    if (!id || (id === 'solo' && S.solo === 'todo')) return false;
    if (S.tickId !== id) { S.tickId = id; S.ticks = 0; }
    S.ticks++;
    return true;
  }
  function cupFill() {
    if (S.levels.length ? allDone() : S.solo === 'done') return 1;
    const id = cupId();
    if (!id) return 0;
    const ticks = id === S.tickId ? S.ticks : 0;
    const lv = id === 'solo' ? soloLv() : S.levels.find(l => l.id === id);
    const st = lv && stepsOf(lv);
    // 有回報小步驟：水位照「做完幾步」精確地漲，目前這一步裡面再用工具次數慢慢補一點（最多補到這一步的八成）
    if (st) return Math.min(0.96, (st.done + Math.min(0.8, 1 - Math.exp(-ticks / 8))) / st.total);
    // 沒回報：退回用工具次數估，最多九成
    const est = Math.min(0.9, 1 - Math.exp(-ticks / 10));
    return S.chat ? Math.max(0.3, est) : est;   // 聊天沒有工具事件可以估，進行中的那一步固定從 0.3 起跳
  }

  // 把 Claude 給的 task（任務編號、清單第幾項、或項目原文）對到關卡；沒給就是目前這一關
  function resolve(task) {
    if (!S.levels.length) return soloLv();   // 沒有清單：只有單一任務，不管 task 寫什麼都是它
    const key = norm(task);
    if (!key) return working() || S.levels.find(l => l.id === S.waitId) || null;
    if (/^\d+$/.test(key)) return S.levels.find(l => l.id === 'k' + key) || real()[Number(key) - 1] || null;
    return S.levels.find(l => norm(l.title) === key || norm(disp(l).title) === key) || null;
  }

  function describe(d) {
    if (d.world) S.world = short(d.world, 12);
    if (d.goal) S.goal = short(d.goal, 40);
    if (d.finalGoal) S.finalGoal = short(d.finalGoal, 12);
    (Array.isArray(d.levels) ? d.levels : []).forEach(x => {
      const key = norm(x.task);
      if (!key && S.levels.length) return;
      const steps = Array.isArray(x.steps) ? x.steps.map(t => short(t, 24)).filter(Boolean).slice(0, 8) : undefined;
      const lv = resolve(x.task);
      // 還沒看到這個項目（工具比清單早到）：先用它給的編號或原文記著
      const at = lv ? (lv.id.startsWith('k') || lv.id.startsWith('solo') ? lv.id : norm(lv.title)) : (/^\d+$/.test(key) ? 'k' + key : key);
      const old = S.labels.get(at) || {};
      S.labels.set(at, { title: (x.title && short(x.title, 16)) || old.title, plain: x.plain || old.plain, tech: x.tech || old.tech, steps: steps && steps.length ? steps : old.steps });
    });
    say();
    return true;
  }

  // quest_progress：這個任務的小步驟做完了幾步
  function progress(d) {
    const lv = resolve(d.task);
    if (!lv) return false;
    const done = Math.max(0, Math.floor(Number(d.done) || 0));
    const total = Math.max(0, Math.floor(Number(d.total) || 0));
    const before = S.prog.get(lv.id) || { done: 0, total: 0 };
    S.prog.set(lv.id, { done, total: total || before.total });
    // 進到下一步：這一步裡的估算歸零重來
    if (done !== before.done && lv.id === cupId()) { S.tickId = lv.id; S.ticks = 0; }
    say();
    return true;
  }

  // 記下動過的檔案，歸在目前進行的關卡；沒有清單就歸在單一任務
  function recordTouched(tool, input) {
    const t = touchedOf(tool, input);
    if (!t) return false;
    const key = (S.levels.length ? cupId() : 'solo') || '_';
    const list = S.touched.get(key) || [];
    if (list.some(x => x.name === t.name)) return false;
    list.push(t); S.touched.set(key, list);
    return true;
  }

  function handle(e) {
    if (e.cwd && !S.project) S.project = path.basename(e.cwd);
    const tool = e.tool_name, input = e.tool_input || {};
    switch (e.hook_event_name) {
      case 'SessionStart': return true;
      case 'UserPromptSubmit': onPrompt(e.prompt || ''); return true;
      case 'PreToolUse': {
        // 工具要開始跑：只更新「現在在做什麼」。清單類工具（TodoWrite、Task*）等 PostToolUse 才處理，不然會重複建關卡
        const a = S.prompted ? activityOf(tool, input) : null;   // 還沒下過指令時不顯示動作
        if (!a || (S.activity && S.activity.text === a.text)) return false;
        S.activity = a;
        return true;
      }
      case 'PostToolUse': {
        if (tool === 'TodoWrite' || tool === 'TaskCreate' || tool === 'TaskUpdate') {
          const was = cupId();
          if (tool === 'TodoWrite') onTodos(input.todos);
          else if (tool === 'TaskCreate') onTaskCreate(input, e.tool_response);
          else onTaskUpdate(input);
          if (cupId() !== was) S.activity = null;   // 換到另一關了，上一關的動作不要帶過來
          return true;
        }
        const a = S.prompted ? activityOf(tool, input) : null, before = S.activity && S.activity.text;
        const rec = S.prompted && recordTouched(tool, input);
        if (a) S.activity = { text: pastOf(a.text), done: true };   // 清單類工具回傳 null，維持上一個動作
        const cleared = clearWait();
        return tick() || cleared || rec || (!!a && before !== S.activity.text);
      }
      case 'PostToolUseFailure': {
        // 工具失敗時 Claude Code 只發這個、不發 PostToolUse。沒處理的話，按了同意但工具失敗，橘色會一直卡著
        if (tool === 'TodoWrite' || tool === 'TaskCreate' || tool === 'TaskUpdate' || !S.prompted) return false;
        const before = S.activity && S.activity.text;
        const cleared = clearWait();
        S.activity = { text: e.is_interrupt ? '剛剛被你中斷了' : '剛剛那一步沒成功', done: true };
        return cleared || before !== S.activity.text;
      }
      case 'Notification': onNotification(e); return true;
      case 'Stop': onStop(e); return true;
      default: return false;
    }
  }

  function build() {
    const levels = S.levels.length ? S.levels.map(({ keepReason, ...l }) => disp(l)) : [disp({
      id: 'solo' + S.round, title: S.prompted ? '處理你的要求' : '等你出發', status: S.solo,
      plain: S.prompted ? 'Claude 這次沒有列出步驟清單，整件事算成一關。' : '在你電腦上的 Claude Code 輸入指令，地圖就會開始動。',
      tech: S.chat ? 'Cowork 任務還沒有步驟清單' : 'Claude Code 尚未建立待辦清單',
      ...(S.solo === 'wait' ? { reason: '等你開門：這一步要你本人同意或回答' } : {})
    })];
    const complete = S.levels.length ? allDone() : S.solo === 'done';
    // 沒有白話說明時，才用 Claude 收尾的那句話當說明；有的話保留白話，總結只放在泡泡
    if (complete && S.summary && !S.levels.length && !S.labels.has('solo' + S.round)) levels[0].plain = S.summary;
    // 這次動過的檔案：掛在對應的關卡上；沒有對應關卡的掛在第一個還沒開始的關卡，再沒有就掛最後一關
    const act = levels.filter(l => l.status !== 'cancel');
    for (const [key, list] of S.touched) {
      const target = key === 'solo' ? levels[0] : (levels.find(l => l.id === key) || act.find(l => l.status === 'todo') || act[act.length - 1]);
      if (target && list.length) target.touched = [...(target.touched || []), ...list.map(x => ({ ...x }))];
    }
    const waiting = !!S.waitingFor;
    const cur = working(), curName = cur && disp(cur).title;
    const now = S.activity ? (S.activity.done ? `${S.activity.text}，想下一步…` : `${S.activity.text}…`) : '';
    const label = curName || (!S.levels.length && S.prompted && S.labels.has('solo' + S.round) ? levels[0].title : '');
    const aiSays = now && !waiting
      ? (label ? `在「${label}」這關：${now}` : now)
      : S.aiSays;
    const p = {
      round: S.round, world: S.world, goal: S.goal, pastWorlds: S.pastWorlds, finalGoal: S.finalGoal,
      source: S.chat ? 'chat' : 'code',
      userSaid: S.userSaid || '（還沒說話）', aiSays, activity: waiting ? null : S.activity,
      summary: complete ? S.summary : '', levels,
      waitingFor: S.waitingFor, waitSince: S.waitingFor ? S.waitSince : null, choice: null, toast: S.toast, project: S.project, cup: cupFill()
    };
    return p;
  }
  // plan() 會把通知「用掉」，只給畫面顯示的那個對話用；peek() 只看不動，給清單和提醒用
  function plan() { const p = build(); S.toast = null; return p; }
  const peek = () => build();
  // ---------- Cowork／聊天：Claude 自己回報整份計畫 ----------
  const STEP_STATUS = { pending: 'pending', todo: 'pending', in_progress: 'in_progress', doing: 'in_progress', completed: 'completed', done: 'completed', deleted: 'deleted' };
  function startChat(goal) {
    S.chat = true;
    if (!S.prompted) { S.prompted = true; if (S.solo === 'todo') S.solo = 'doing'; }
    if (goal) {
      S.userSaid = short(goal, 60); S.goal = short(goal, 36);
      if (S.world === '等待出發') S.world = short(goal, 9);
    }
  }
  // 每次都收到整份清單，沿用 TodoWrite 的比對邏輯：新增、拆除、回頭修、完成判定都不用另外寫
  function applyPlan(d) {
    startChat(d.goal);
    const steps = Array.isArray(d.steps) ? d.steps : [];
    const todos = steps.filter(x => x && x.title).map(x => ({ content: short(x.title, 24), status: STEP_STATUS[x.status] || 'pending', description: x.plain }));
    if (todos.length) onTodos(todos); else clearWait();
    if (d.world) S.world = short(d.world, 12);
    if (d.waiting_for) setWait(short(d.waiting_for, 120));
    if (d.summary) S.summary = short(d.summary, 60);
    if (S.levels.length && allDone()) S.aiSays = S.summary ? `這個任務全部完成！${S.summary}` : '這個任務全部完成！';
    return true;
  }
  return { handle, plan, peek, describe, progress, startChat, applyPlan };
}

// ---------- 多個 Claude Code 視窗 ----------
const STALE_MS = 6 * 3600e3;   // 這麼久沒動靜的對話從清單移除
// 比對資料夾：統一斜線、去掉結尾斜線；Windows 路徑不分大小寫
const dirKey = p => { p = String(p || '').replace(/\\/g, '/').replace(/\/+$/, ''); return /^[a-z]:/i.test(p) ? p.toLowerCase() : p; };

// 每個對話各記一份進度。畫面顯示「使用者選的那個」，沒選過就跟著最近有動靜的。
function createHub() {
  const entries = new Map();   // session_id → { id, s, dir, last, seq }
  let seq = 0, lastActive = null, selected = null;
  const idle = createSession();
  const ordered = () => [...entries.values()].sort((a, b) => a.seq - b.seq);

  function drop(id) {
    entries.delete(id);
    if (selected === id) selected = null;
    if (lastActive === id) {
      const next = [...entries.values()].sort((a, b) => b.last - a.last)[0];
      lastActive = next ? next.id : null;
    }
  }
  const make = (id, now) => { const en = { id, s: createSession(), dir: '', last: now, seq: ++seq }; entries.set(id, en); return en; };
  // 沒有專案資料夾的 MCP 呼叫（Cowork、聊天）：歸到最近的聊天任務。絕對不能貼到 Claude Code 的對話上
  function chatEntry(now) {
    let en = [...entries.values()].filter(e => e.chat).sort((a, b) => b.last - a.last)[0];
    if (!en) { en = make('chat:main', now); en.chat = true; en.s.startChat(''); }
    return en;
  }
  const shown = () => entries.get(selected) || entries.get(lastActive) || ordered()[0] || null;

  // 顯示名稱：資料夾名稱，重複的加編號（club-signup、club-signup #2）
  function names() {
    const used = new Map(), out = new Map();
    for (const en of ordered()) {
      const base = en.chat ? (en.title ? `Cowork・${short(en.title, 10)}` : 'Cowork')
        : /scratch-workspaces[\\/]/.test(en.dir) ? '未選資料夾的對話'   // 桌面版沒選資料夾時建的暫存資料夾，名稱看不懂
        : (baseName(en.dir) || '對話');
      const n = (used.get(base) || 0) + 1;
      used.set(base, n);
      out.set(en.id, n > 1 ? `${base} #${n}` : base);
    }
    return out;
  }

  // MCP 工具沒有對話編號，用專案資料夾對起來；同資料夾有好幾個就取最近有動靜的；對不到就用目前顯示的
  function pick(d) {
    const key = dirKey(d && (d.project_dir || d.cwd));
    if (key) {
      const same = ordered().filter(en => dirKey(en.dir) === key).sort((a, b) => b.last - a.last);
      if (same.length) return same[0];
    }
    return shown();
  }

  return {
    handle(e, now = Date.now()) {
      const id = e.session_id || 'default';
      if (e.hook_event_name === 'SessionEnd') {
        if (!entries.has(id)) return false;
        drop(id);
        return true;
      }
      for (const en of ordered()) if (now - en.last > STALE_MS && en.id !== id) drop(en.id);
      let en = entries.get(id), isNew = false;
      if (!en) { en = make(id, now); isNew = true; }
      const dir = e.project_dir || (en.dir ? '' : e.cwd);
      if (dir) en.dir = dir;
      const changed = en.s.handle(e);
      if (changed) { en.last = now; lastActive = id; }
      return changed || isNew;
    },
    describe(d, now = Date.now()) {
      if (d && d.chat) { const en = chatEntry(now); const ok = en.s.describe(d); en.last = now; lastActive = en.id; return ok; }
      const en = pick(d); return en ? en.s.describe(d) : false;
    },
    progress(d, now = Date.now()) {
      if (d && d.chat) { const en = chatEntry(now); const ok = en.s.progress(d); en.last = now; lastActive = en.id; return ok; }
      const en = pick(d); return en ? en.s.progress(d) : false;
    },
    // Cowork／聊天用 quest_plan 回報整份計畫。Claude Code 裡的狀態由 hooks 同步，不收這個，免得重複建關卡
    chatPlan(d, now = Date.now()) {
      if (!d || !d.chat) return false;
      for (const x of ordered()) if (now - x.last > STALE_MS) drop(x.id);
      const id = 'chat:' + String(d.task_id || 'main').slice(0, 40);
      let en = entries.get(id);
      const ph = entries.get('chat:main');
      if (!en && ph && ph.chat && !ph.planned) { entries.delete('chat:main'); ph.id = id; entries.set(id, ph); en = ph; }   // 先前只補過白話的空任務，接手過來
      if (!en) { en = make(id, now); en.chat = true; }
      en.planned = true;
      if (d.goal) en.title = String(d.goal);
      const ok = en.s.applyPlan(d);
      en.last = now; lastActive = id;
      return ok;
    },
    // 使用者在清單點選；之後畫面固定顯示它，直到它結束
    // 診斷用：地圖目前認得哪些對話（不含指令、檔案或你說的話）。peek 不會用掉通知
    list() {
      const nm = names();
      return ordered().map(x => { const s = summarize(x.s.peek()); return { name: nm.get(x.id), done: s.done, total: s.total, waiting: s.waiting, chat: !!x.chat, lastAt: new Date(x.last).toISOString() }; });
    },
    select(id) {
      if (id === null) { selected = null; return true; }
      const en = entries.get(id);
      if (!en) return false;
      selected = id;
      en.s.plan();   // 丟掉它還沒顯示過的舊通知
      return true;
    },
    plan() {
      const en = shown(), nm = names();
      const p = (en ? en.s : idle).plan();
      if (en) p.project = nm.get(en.id);
      p.sessions = ordered().map(x => ({ id: x.id, name: nm.get(x.id), ...summarize(x.s.peek()) }));
      p.selected = en ? en.id : null;
      p.pinned = !!(selected && entries.has(selected));
      return p;
    }
  };
}

// 邊緣水位和小把手要用的摘要：進度、是不是在等你（任何一個對話在等都算）、水位
function summarize(plan) {
  const act = plan.levels.filter(l => l.status !== 'cancel');
  const done = act.filter(l => l.status === 'done').length;
  let waiting = act.some(l => l.status === 'wait');
  const mood = waiting ? 'wait'
    : act.length && done === act.length ? 'happy'
    : act.some(l => l.status === 'doing' || l.status === 'adjust') ? 'work' : 'sleep';
  const cup = Number.isFinite(plan.cup) ? plan.cup : (act.length && done === act.length ? 1 : 0);
  const list = plan.sessions || [];
  const me = list.find(x => x.id === plan.selected);
  const other = list.find(x => x.waiting && x.id !== plan.selected);
  let waitingFor = plan.waitingFor || null, waitingName = null;
  if (waiting) {
    if (list.length > 1 && me) { waitingName = me.name; if (waitingFor) waitingFor = `${me.name}：${waitingFor}`; }
  } else if (other) {
    waiting = true; waitingName = other.name;
    waitingFor = `${other.name}：${other.waitingFor || '需要你回覆'}`;
  }
  return { done, total: act.length, waiting, waitingFor, waitingName, mood, cup, others: Math.max(list.length - 1, 0) };
}

module.exports = { createHub, createSession, summarize, activityOf, summaryOf, cleanPrompt };
