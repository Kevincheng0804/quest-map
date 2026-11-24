#!/usr/bin/env node
// 闖關地圖的 MCP 伺服器（stdio，零相依）。給 Claude 一個工具：把待辦清單翻成白話，送到桌面上的地圖。
'use strict';
const http = require('http');
const readline = require('readline');
const os = require('os');
const { ensureApp, isRemote } = require('./runtime');

const PORT = Number(process.env.QUEST_PET_PORT) || 47600;
const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');

const REMOTE = isRemote();
const REMOTE_MSG = '這個對話跑在雲端，闖關地圖在使用者的電腦上，這裡連不到。要用地圖，請在桌面版的 Claude Code 選在電腦上執行（不是雲端）。這不影響工作，請繼續，也不用再呼叫地圖的工具。';
const REMOTE_INSTRUCTIONS = '使用者桌面上有一張「闖關地圖」，但這個工作階段跑在雲端，地圖連不到。請不要呼叫 describe_quest、quest_progress、quest_plan、quest_ping，直接做事就好。';

const INSTRUCTIONS = [
  '先看這條：排程任務（提示開頭是 <scheduled-task、或由排程／定時啟動）、自動化、CI、claude -p 無頭模式、子代理、背景或例行工作、單純問答聊天翻譯、一兩步就做完的小事，都不要呼叫這些地圖工具，也不要為了地圖多列待辦，直接做事。地圖是給坐在電腦前看著對話的人用的；判斷不出來有沒有人在看時，寧可不用。',
  '使用者桌面上有一張「闖關地圖」和螢幕邊緣的水位，把你的工作畫成關卡，給不懂程式的人看進度。每個任務是一杯水，任務裡的小步驟每做完一步，水就漲一格。',
  '先判斷你在哪裡：在 Claude Code 裡，狀態由 hooks 自動同步，照下面 1 到 3 做；如果你沒有待辦清單工具（TodoWrite、TaskCreate），就改用 quest_plan 送出整份步驟，之後每次有變動再送完整清單（要請使用者動手的步驟，標題開頭加「【你來做】」）。在 Cowork（有「進度」面板）或一般聊天裡沒有自動同步，請改用 quest_plan：任務一開始就送出整份步驟清單，之後每次進度有變動（開始某一步、做完某一步、新增或拿掉步驟）都再送一次完整清單，內容跟你的進度面板一樣；做完時在 summary 寫一句白話結果；需要使用者動手時填 waiting_for。在 Cowork／聊天裡不要用 describe_quest。在 Cowork 裡，使用者在場、工作會持續一陣子且超過一個步驟（例如下載、整理檔案、寫程式、研究後產出檔案）時，主動這樣做，不用等使用者要求；單純問答、聊天、翻譯、解釋、排程任務不用。',
  '在 Claude Code 裡，任務的狀態（未開始、進行中、完成）會自動同步，你不用回報。你要做的是替它補上白話文字：',
  '1. 有待辦清單時：每次建立清單，或清單新增、改寫項目之後，呼叫一次 describe_quest，替每個項目補上白話名稱，並把它拆成 2 到 5 個小步驟（steps）。',
  '2. 沒有待辦清單的小修改也要補：開始動手前，先呼叫一次 describe_quest（task 填 "1"，不要為此另外建立待辦清單），用一句白話說明你要改的是什麼功能，例如 title「把按鈕改紅色」、plain「把送出按鈕的顏色改成紅色，讓人更容易看到」。小到一兩步的修改不用給 steps。如果使用者只是在問問題、不需要你動手改東西，就不用呼叫。',
  '3. 做任務的過程中，每做完一個小步驟就呼叫一次 quest_progress，回報這個任務目前做完幾步。這同時幫你自己記住做到哪裡。',
  '4. 需要使用者自己動手的事（更新外掛、實際操作測試、貼資料、做決定、到別的網站設定），不要只在文字裡條列，也要放進待辦清單，項目開頭加「【你來做】」，輪到他時標成進行中，並用 describe_quest 的 steps 列出他要做的具體動作。然後停下來把結果交給他，不要自己標完成；他回來說做好了，你先驗證確實完成，才把那項標成完成。地圖不會偵測使用者做到哪。',
  '5. 任務進行中使用者又說了話：跟任務有關（改需求、補充、回報做好了）就在下一次呼叫 describe_quest 或 quest_plan 時帶 said，把這句話跟任務有關的部分濃縮成一句白話；只是閒聊或問別的事，不用為此呼叫工具（地圖會保持原來的「你剛剛說」），要呼叫時帶空字串。',
  '6. 使用者在計畫模式核准計畫之後，請馬上用待辦清單（沒有就用 quest_plan）把計畫的步驟列出來並隨進度更新，地圖才跟得上；地圖只會先用計畫裡「要做的工作」那一段畫出不會前進的路線圖。',
  '白話的意思是讓沒寫過程式的人看得懂：寫「做出表單畫面」，不要寫「建立 form.html」；寫「把按鈕改紅色」，不要寫「修改 .send 的 background」。技術細節放在 tech 欄位。使用者用什麼語言，你就用什麼語言。',
  '工具失敗或地圖沒開都不影響你的工作，不用向使用者提起，繼續做事即可。'
].join('\n');

const TASK_REF = '對應哪個待辦項目：TaskCreate 的任務編號（例如 "3"），或 TodoWrite 項目的原文（一字不差），或它在清單中的第幾項（例如 "2"）。沒有待辦清單的單一任務填 "1"。';

const SAID = { type: 'string', description: '使用者最新這句話裡跟任務有關的部分，濃縮成一句白話（30 字內），會顯示在地圖的「你剛剛說」。他這句只是閒聊或跟任務無關，就填空字串 ""，地圖會保持原樣。沒有新的話就省略。' };

const TOOLS = [{
  name: 'describe_quest',
  description: '替闖關地圖上的關卡補上白話名稱、說明與小步驟。建立待辦清單後呼叫一次；沒有待辦清單的小修改，開始動手前也呼叫一次（task 填 "1"）。之後只在清單新增或改寫項目時再呼叫，只需傳有變動的項目。不用回報完成狀態，狀態會自動同步。',
  inputSchema: {
    type: 'object',
    properties: {
      world: { type: 'string', description: '這一輪工作的世界名稱，有點遊戲感、8 個字以內，例如「報名表單森林」。第一次呼叫時提供。' },
      goal: { type: 'string', description: '這一輪要完成什麼，一句白話，例如「做出報名表單」。' },
      said: SAID,
      finalGoal: { type: 'string', description: '整個任務的最終目標，6 個字以內，例如「上線城堡」。知道時才提供。' },
      levels: {
        type: 'array',
        description: '要補上白話說明的關卡。',
        items: {
          type: 'object',
          properties: {
            task: { type: 'string', description: TASK_REF },
            title: { type: 'string', description: '白話關卡標題，8 個字以內，例如「做出表單畫面」。' },
            plain: { type: 'string', description: '一句白話說明這關在做什麼、對使用者有什麼用。' },
            tech: { type: 'string', description: '技術細節，一行，例如「建立 form.html 與 form.css」。' },
            steps: { type: 'array', items: { type: 'string' }, description: '這個任務你打算怎麼做，拆成 2 到 5 個小步驟，每個 10 個字以內的白話，照執行順序排，例如 ["排好欄位", "加上送出按鈕", "調整手機版面"]。很小的任務可以只有 1 到 2 步。' }
          },
          required: ['task', 'title', 'plain']
        }
      }
    },
    required: ['levels']
  }
}, {
  name: 'quest_plan',
  description: '回報這個任務的整份步驟清單和每一步的狀態，闖關地圖會畫成關卡。在 Cowork／一般聊天裡用它（沒有自動同步）；在 Claude Code 裡，只有在你沒有待辦清單工具（TodoWrite、TaskCreate）時才用它，有的話用待辦清單。要請使用者動手的步驟，標題開頭加「【你來做】」。任務一開始就呼叫一次，之後每次進度有變動（開始某一步、做完某一步、新增或拿掉步驟）就再呼叫一次，每次都送完整清單。',
  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: '這個任務要完成什麼，一句白話，例如「建立一個打招呼的檔案」。' },
      said: SAID,
      task_id: { type: 'string', description: '同一個任務每次都填同樣的短代號（英文小寫，例如 "hello"），不同任務用不同代號。省略時用 "main"。' },
      world: { type: 'string', description: '這個任務的世界名稱，有點遊戲感、8 個字以內，例如「打招呼小村」。第一次呼叫時提供。' },
      steps: {
        type: 'array',
        description: '完整的步驟清單，照順序，包含已經做完的。同一時間只有一步是 in_progress。',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '白話步驟名稱，12 個字以內，例如「建立打招呼檔案」。' },
            plain: { type: 'string', description: '一句白話說明這一步在做什麼。' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: '還沒做、進行中、做完了。' }
          },
          required: ['title', 'status']
        }
      },
      waiting_for: { type: 'string', description: '需要使用者動手或回答時，寫出要他做的具體事情；不需要就省略。' },
      summary: { type: 'string', description: '全部做完時，一句白話說明結果；還沒做完就省略。' }
    },
    required: ['goal', 'steps']
  }
}, {
  name: 'quest_ping',
  description: '測試闖關地圖有沒有連上，給使用者排查問題用，平常不需要呼叫。回傳這個外掛的 MCP 伺服器跑在哪裡、連不連得到地圖。使用者要求測試連線時才呼叫，並把結果原樣告訴使用者。',
  inputSchema: { type: 'object', properties: {} }
}, {
  name: 'quest_progress',
  description: '回報一個任務裡的小步驟做完了幾步，螢幕邊緣的水位會跟著漲。每做完一個小步驟呼叫一次。任務整個完成時不用呼叫，照常把待辦標成完成即可。',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: TASK_REF + '省略時代表目前進行中的任務。' },
      done: { type: 'integer', minimum: 0, description: '這個任務到目前為止做完了幾個小步驟。' },
      total: { type: 'integer', minimum: 1, description: '這個任務總共幾個小步驟。只有當你沒在 describe_quest 給過 steps，或步驟數改變時才需要。' }
    },
    required: ['done']
  }
}];

// 沒有專案資料夾（CLAUDE_PROJECT_DIR）就是 Cowork／聊天來源：它們沒有 hooks，也對不到任何 Claude Code 對話。QUEST_PET_CHAT=1／0 可強制
// 地圖是被誰打開的（顯示給使用者看）：Cowork／聊天，或某個專案的 Claude Code
const opener = () => (isChat() ? { by: 'cowork' } : { by: 'code', projectDir: process.env.CLAUDE_PROJECT_DIR });
const isChat = () => (process.env.QUEST_PET_CHAT ? process.env.QUEST_PET_CHAT !== '0' : !process.env.CLAUDE_PROJECT_DIR);

// 對地圖程式送一個請求。回傳 { ok, status, error }：
// status 是對方回的 HTTP 狀態碼；error 是連不上時的原因（ECONNREFUSED、timeout…），兩者只會有一個
function request(method, path, data) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method, headers: { 'content-type': 'application/json' }, timeout: 1500 },
      res => { res.resume(); res.on('end', () => resolve({ ok: res.statusCode < 300, status: res.statusCode })); });
    req.on('error', err => resolve({ ok: false, error: err.code || 'error' }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.end(method === 'POST' ? JSON.stringify({ ...data, project_dir: process.env.CLAUDE_PROJECT_DIR || undefined, chat: isChat() }) : undefined);
  });
}
const post = async (path, data) => (await request('POST', path, data)).ok;

async function onRequest(msg) {
  const { id, method, params = {} } = msg;
  const reply = result => send({ jsonrpc: '2.0', id, result });
  switch (method) {
    case 'initialize':
      if (!REMOTE) ensureApp({ opener: opener() }).catch(() => {});   // 地圖沒開、元件也裝好了，就在背景打開；不下載、不出聲
      return reply({
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'quest-map', version: '0.20.1' },
        instructions: REMOTE ? REMOTE_INSTRUCTIONS : INSTRUCTIONS
      });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      const args = params.arguments || {};
      const text = t => reply({ content: [{ type: 'text', text: t }] });
      if (REMOTE) return text(params.name === 'quest_ping' ? `連線測試：失敗，這個對話跑在雲端（CLAUDE_CODE_REMOTE）。${REMOTE_MSG}` : REMOTE_MSG);   // 雲端：完全不對 47600 連線
      const closed = '闖關地圖目前沒有開啟（使用者可以用 /quest-map:open 打開）。這不影響工作，請繼續。';
      const send2 = async path => (await post(path, args)) || ((await ensureApp({ opener: opener() })) && (await post(path, args)));
      if (params.name === 'quest_plan') {
        if (!args.goal || !Array.isArray(args.steps)) return reply({ content: [{ type: 'text', text: 'goal 和 steps 都要填，steps 必須是陣列。' }], isError: true });
        let r = await request('POST', '/chatplan', args);
        if (!r.ok && r.error && await ensureApp({ opener: opener() })) r = await request('POST', '/chatplan', args);
        if (r.status === 409) return text('這個對話已經用待辦清單（或規格任務檔）同步進度，不需要 quest_plan。請改照 describe_quest 與 quest_progress 的說明做，不要再呼叫 quest_plan。');
        return text(r.ok ? `地圖已同步 ${args.steps.length} 個步驟。之後進度有變動，請再送一次完整清單。` : closed);
      }
      if (params.name === 'quest_ping') {
        const info = { platform: process.platform, host: os.hostname(), node: process.version, cwd: process.cwd() };
        let r = await request('POST', '/ping', info);
        if (!r.ok && r.error && await ensureApp({ opener: opener() })) r = await request('POST', '/ping', info);   // 連不上：試著把地圖打開再測一次
        const where = `伺服器位置：${info.platform}／${info.host}\n專案資料夾（CLAUDE_PROJECT_DIR）：${process.env.CLAUDE_PROJECT_DIR || '沒有'}`;
        let verdict;
        if (r.ok) verdict = '成功，闖關地圖有收到';
        else if (r.status === 404) verdict = '地圖有開，但是舊版（沒有連線測試功能，對方回 404）。請完全關掉地圖再重新打開';
        else if (r.status) verdict = `地圖有開，但回報了錯誤（HTTP ${r.status}）`;
        else verdict = `失敗，連不到闖關地圖（${r.error}）。可能沒有開，或這個環境連不到使用者電腦上的地圖`;
        return text(`連線測試：${verdict}\n${where}`);
      }
      if (params.name === 'describe_quest') {
        if (!Array.isArray(args.levels)) return reply({ content: [{ type: 'text', text: 'levels 必須是陣列。' }], isError: true });
        return text(await send2('/describe') ? `地圖已更新 ${args.levels.length} 關的說明。之後每做完一個小步驟，請呼叫 quest_progress。` : closed);
      }
      if (params.name === 'quest_progress') {
        if (!Number.isFinite(Number(args.done))) return reply({ content: [{ type: 'text', text: 'done 必須是數字。' }], isError: true });
        return text(await send2('/progress') ? `已記錄：做完 ${args.done} 步。` : closed);
      }
      return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${params.name}` } });
    }
    default:
      if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

readline.createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method) onRequest(msg).catch(err => { if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(err.message || err) } }); });
}).on('close', () => process.exit(0));
