'use strict';
// 介面文字的多語言。Node（state.js、main.js）和瀏覽器（地圖、小把手）共用同一份。
// 加新語言：在 MESSAGES 加一份同樣鍵名的物件，再把語言代碼放進 LANGS 就好；缺的鍵會退回繁體中文。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuestI18n = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LANGS = [{ code: 'zh-TW', label: '繁體中文' }, { code: 'en', label: 'English' }];
  const DEFAULT = 'zh-TW';

  const MESSAGES = {
    'zh-TW': {
      // ---- 狀態與通用 ----
      'status.todo': '未開始', 'status.doing': '進行中', 'status.wait': '等你開門', 'status.done': '已通關', 'status.adjust': '施工中', 'status.cancel': '已拆除',
      'sep': '、', 'sep.toast': '，',
      'prompt.sched': '排程任務：{name}', 'prompt.system': '（系統訊息）', 'said.none': '（還沒說話）',
      // ---- 現在在做什麼 ----
      'act.test': '正在跑測試', 'act.test.done': '測試跑完了',
      'act.install': '正在安裝套件', 'act.install.done': '套件裝好了',
      'act.commit': '正在儲存版本紀錄', 'act.commit.done': '版本紀錄存好了',
      'act.push': '正在上傳到遠端', 'act.push.done': '上傳完了',
      'act.serve': '正在啟動預覽', 'act.serve.done': '預覽啟動了',
      'act.build': '正在建置專案', 'act.build.done': '建置完了',
      'act.cmd': '正在跑指令', 'act.cmd.done': '指令跑完了',
      'act.read': '正在看 {f}', 'act.read.done': '看完了 {f}', 'act.read0': '正在看檔案', 'act.read0.done': '看完了檔案',
      'act.edit': '正在修改 {f}', 'act.edit.done': '改好了 {f}', 'act.edit0': '正在修改檔案', 'act.edit0.done': '改好了檔案',
      'act.write': '正在寫入 {f}', 'act.write.done': '寫好了 {f}', 'act.write0': '正在寫入檔案', 'act.write0.done': '寫好了檔案',
      'act.search': '正在搜尋檔案', 'act.search.done': '搜尋完了',
      'act.web': '正在上網查資料', 'act.web.done': '查完資料了',
      'act.agent': '請助手幫忙', 'act.agent.done': '助手回報了',
      'act.interrupted': '剛剛被你中斷了', 'act.failed': '剛剛那一步沒成功',
      'touch.edit': '改了', 'touch.write': '寫入',
      'now.doing': '{text}…', 'now.done': '{text}，想下一步…', 'says.inLevel': '在「{label}」這關：{now}',
      // ---- 世界與關卡 ----
      'world.idle': '等待出發', 'goal.idle': '等 Claude Code 或 Cowork 開始工作', 'final.default': '任務完成',
      'says.idle': '我在待命。你電腦上的 Claude Code 有動靜，或 Cowork 開始多步驟的工作，我就會動。一般聊天和雲端的對話我看不到。',
      'world.round': '第 {n} 輪', 'step.n': '第 {n} 步', 'step.item': '步驟 {n}',
      'step.at': '（第 {i}/{n} 步：{name}）',
      'level.solo': '處理你的要求', 'level.start': '等你出發',
      'solo.plain': 'Claude 這次沒有列出步驟清單，整件事算成一關。', 'solo.plain0': '在你電腦上的 Claude Code 輸入指令，地圖就會開始動。',
      'tech.chat0': 'Cowork 任務還沒有步驟清單', 'tech.code0': 'Claude Code 尚未建立待辦清單',
      'tech.chat': 'Cowork 進度清單：{title}', 'tech.spec': '規格任務：{title}', 'tech.code': 'Claude Code 待辦：{title}', 'tech.task': 'Claude Code 任務 #{id}：{title}',
      'quote.chat': 'Claude 調整了計畫', 'quote.said': '因為你說「{said}」', 'quote.plain': '計畫調整',
      'reason.wait': '等你開門：這一步要你本人同意或回答',
      'reason.new': '新關卡：{quote}', 'reason.rework': '回頭修：{quote}', 'reason.cancel': '已拆除：{quote}',
      'says.door': '這道門要你才打得開。',
      'says.rework': '我走回「{name}」這關重新修一下。{at}', 'says.fight': '我正在打「{name}」這關{at}，打完就往下一關！',
      'says.working': '我正在處理「{name}」{at}', 'says.worldDone': '這個世界的關卡全部通關！',
      'says.heard': '聽到了！我看看路線要不要改。', 'says.received': '收到！我先看看這趟要怎麼走。',
      'says.waitNext': '我在等你的下一句話。',
      'says.doneSolo': '完成：{summary}', 'says.doneSolo0': '做完了！等你的下一個指令。',
      'says.worldAll': '這個世界全部通關！{summary}', 'says.worldAll0': '這個世界全部通關！等你的下一個指令。',
      'says.stopped': '我先停在這裡，回 Claude Code 看看我說了什麼。',
      'says.taskDone': '這個任務全部完成！{summary}', 'says.taskDone0': '這個任務全部完成！',
      'toast.prefix': '地圖更新！', 'toast.added': '新增 {n} 關', 'toast.cancelled': '拆掉 {n} 關', 'toast.rework': '{n} 關要回頭修',
      // ---- 等你 ----
      'wait.tool': 'Claude 想使用「{tool}」，需要你按同意。請回到 Claude Code 視窗。', 'wait.msg': '請回到 Claude Code 視窗回覆：{msg}',
      'wait.asked': 'Claude 問了你一個問題，請回到 Claude Code 視窗回覆。', 'wait.default': '需要你回覆',
      // ---- 對話名稱 ----
      'name.scratch': '未選資料夾的對話', 'name.chat': '對話',
      // ---- 地圖畫面 ----
      'ui.title': 'AI 任務闖關地圖', 'ui.close': '關閉闖關地圖', 'ui.mini': '縮到旁邊', 'ui.lang': '語言', 'ui.langAuto': '自動（跟系統）',
      'ui.where': '目前位置', 'ui.progress': '本世界進度', 'ui.levelCount': '關卡', 'ui.doneCount': '已通關 {n} 關',
      'ui.said': '你剛剛說', 'ui.task': '這次的任務', 'ui.quote': '「{s}」', 'ui.goal': '這一輪的目標：{goal}',
      'ui.world': '世界 {n}・{name}', 'ui.worldLabel': '世界 {n}：{name}，已通過。看這一輪做了什麼', 'ui.worldPassed': '世界 {n}・{name}　已通過',
      'ui.before': '前面 {n} 關已走過', 'ui.after': '後面還有 {n} 關',
      'ui.levelAria': '關卡 {num}：{title}，狀態：{status}', 'ui.levelAria0': '{title}，狀態：{status}',
      'ui.tagNew': '新關卡', 'ui.tagSign': '回頭修', 'ui.tagPause': '暫停',
      'ui.locked': '未解鎖', 'ui.finished': '已完成',
      'ui.waitHead': '等你開門', 'ui.waitJust': '剛剛開始等', 'ui.waitMin': '已等 {m} 分鐘',
      'ui.waitLong': '{base}。如果你已經按過同意，這一步做完地圖才會更新',
      'ui.nowJust': '剛剛', 'ui.nowNow': '現在', 'ui.nowLine': '{when}：{text}', 'ui.touched': '這次動過的檔案', 'ui.moreFiles': '還有 {n} 個', 'ui.fileLine': '{verb} {name}',
      'ui.cardNum': '關卡 {n}', 'ui.offRoad': '已移出主路', 'ui.whyWait': '要請你做的事', 'ui.whyChanged': '為什麼變了', 'ui.tech': '技術細節',
      'ui.sessions': '對話（{n}）', 'ui.sWaiting': '等你', 'ui.sAriaWait': '在等你', 'ui.sAriaProg': '已通關 {done} / {total}', 'ui.sAria': '{name}，{state}，點一下切換',
      'ui.connecting': '等待連線（Claude Code 或 Cowork）',
      // ---- 小把手與通知 ----
      'bat.open': '展開闖關地圖', 'bat.waitName': '等你 · {name}', 'bat.wait': '等你',
      'bat.ariaWaitName': '{name} 的 Claude 在等你。', 'bat.ariaWait': 'Claude 在等你。', 'bat.ariaProg': '已倒滿 {done} 杯，共 {total} 個任務。點一下展開闖關地圖，按住可以拖到別的位置',
      'bat.title': '已完成 {done} / {total} 個任務', 'bat.titleWait': 'Claude 在等你',
      'notif.title': 'Claude Code 在等你', 'notif.titleName': 'Claude Code 在等你・{name}', 'notif.body': '有一關需要你出手',
      'notif.ping': '闖關地圖：收到連線測試', 'notif.pingBody': '來自 {host}（{platform}）', 'notif.unknown': '未知',
      'open.code': '由「{project}」的 Claude Code 自動開啟', 'open.codeNoName': '由 Claude Code 自動開啟', 'open.cowork': '由 Cowork 自動開啟', 'open.manual': '由你輸入 /quest-map:open 開啟', 'open.upgraded': '（已自動更新到新版）', 'open.hint': '不想自動開啟：設定環境變數 QUEST_PET_NO_AUTOLAUNCH=1', 'open.notifTitle': '闖關地圖已開啟', 'ui.dismiss': '關閉',
      'status.user': '要你動手', 'reason.user': '要你本人動手：做完回來告訴 Claude，它驗證過才算過關', 'wait.user': '請你做：{title}（做完回來告訴 Claude）', 'ui.userHead': '要你動手', 'ui.userHint': '做完回到對話告訴 Claude，它驗證通過這一關才會過',
      'ui.histTitle': '已完成的世界（第 {a}–{b} 個）', 'ui.older': '看更早的世界', 'ui.newer': '看較新的世界', 'ui.histBack': '回到目前', 'ui.histPage': '{p} / {m}',
      'plan.verify': '驗證', 'solo.ambiguous': 'Spectra 有 {n} 個進行中的變更，我還不確定你在做哪一個。Claude 開始改檔後我會自動對上。',
      'win.map': 'AI 任務闖關地圖', 'win.bat': '闖關進度', 'win.edge': '邊緣水位'
    },
    en: {
      'status.todo': 'Not started', 'status.doing': 'In progress', 'status.wait': 'Waiting for you', 'status.done': 'Cleared', 'status.adjust': 'Reworking', 'status.cancel': 'Removed',
      'sep': ', ', 'sep.toast': ', ',
      'prompt.sched': 'Scheduled task: {name}', 'prompt.system': '(system message)', 'said.none': '(nothing said yet)',
      'act.test': 'Running tests', 'act.test.done': 'Tests finished',
      'act.install': 'Installing packages', 'act.install.done': 'Packages installed',
      'act.commit': 'Saving a version', 'act.commit.done': 'Version saved',
      'act.push': 'Uploading to remote', 'act.push.done': 'Upload finished',
      'act.serve': 'Starting a preview', 'act.serve.done': 'Preview started',
      'act.build': 'Building the project', 'act.build.done': 'Build finished',
      'act.cmd': 'Running a command', 'act.cmd.done': 'Command finished',
      'act.read': 'Reading {f}', 'act.read.done': 'Read {f}', 'act.read0': 'Reading a file', 'act.read0.done': 'Read a file',
      'act.edit': 'Editing {f}', 'act.edit.done': 'Edited {f}', 'act.edit0': 'Editing a file', 'act.edit0.done': 'Edited a file',
      'act.write': 'Writing {f}', 'act.write.done': 'Wrote {f}', 'act.write0': 'Writing a file', 'act.write0.done': 'Wrote a file',
      'act.search': 'Searching files', 'act.search.done': 'Search finished',
      'act.web': 'Looking things up online', 'act.web.done': 'Finished looking things up',
      'act.agent': 'Asking a helper', 'act.agent.done': 'Helper reported back',
      'act.interrupted': 'You interrupted that step', 'act.failed': 'That step did not succeed',
      'touch.edit': 'Edited', 'touch.write': 'Wrote',
      'now.doing': '{text}…', 'now.done': '{text}, thinking about the next step…', 'says.inLevel': 'On "{label}": {now}',
      'world.idle': 'Waiting to start', 'goal.idle': 'Waiting for Claude Code or Cowork to start working', 'final.default': 'Task complete',
      'says.idle': "I'm on standby. I'll move when Claude Code on your computer does something, or when Cowork starts a multi-step job. I can't see regular chats or cloud conversations.",
      'world.round': 'Round {n}', 'step.n': 'Step {n}', 'step.item': 'Step {n}',
      'step.at': ' (step {i}/{n}: {name})',
      'level.solo': 'Handle your request', 'level.start': 'Waiting to start',
      'solo.plain': "Claude didn't list steps this time, so the whole job counts as one level.", 'solo.plain0': 'Type a command in Claude Code on your computer and the map will start moving.',
      'tech.chat0': 'This Cowork task has no step list yet', 'tech.code0': 'Claude Code has not created a to-do list yet',
      'tech.chat': 'Cowork progress list: {title}', 'tech.spec': 'Spec task: {title}', 'tech.code': 'Claude Code to-do: {title}', 'tech.task': 'Claude Code task #{id}: {title}',
      'quote.chat': 'Claude adjusted the plan', 'quote.said': 'Because you said "{said}"', 'quote.plain': 'Plan adjusted',
      'reason.wait': 'Waiting for you: this step needs your own approval or answer',
      'reason.new': 'New level: {quote}', 'reason.rework': 'Reworking: {quote}', 'reason.cancel': 'Removed: {quote}',
      'says.door': 'Only you can open this door.',
      'says.rework': 'Going back to "{name}" to fix it up.{at}', 'says.fight': 'Working on "{name}"{at}, then on to the next level!',
      'says.working': 'Working on "{name}"{at}', 'says.worldDone': 'Every level in this world is cleared!',
      'says.heard': 'Got it! Let me see if the route needs to change.', 'says.received': "Got it! I'll look at how to get there first.",
      'says.waitNext': "I'm waiting for your next message.",
      'says.doneSolo': 'Done: {summary}', 'says.doneSolo0': "All done! Waiting for your next instruction.",
      'says.worldAll': 'Every level in this world is cleared! {summary}', 'says.worldAll0': 'Every level in this world is cleared! Waiting for your next instruction.',
      'says.stopped': "I've paused here. Go back to Claude Code to see what I said.",
      'says.taskDone': 'This task is complete! {summary}', 'says.taskDone0': 'This task is complete!',
      'toast.prefix': 'Map updated! ', 'toast.added': '{n} new', 'toast.cancelled': '{n} removed', 'toast.rework': '{n} to rework',
      'wait.tool': 'Claude wants to use "{tool}" and needs your approval. Please go back to the Claude Code window.', 'wait.msg': 'Please go back to the Claude Code window and reply: {msg}',
      'wait.asked': 'Claude asked you a question. Please go back to the Claude Code window and reply.', 'wait.default': 'Needs your reply',
      'name.scratch': 'Chat without a folder', 'name.chat': 'Chat',
      'ui.title': 'AI Quest Map', 'ui.close': 'Close the quest map', 'ui.mini': 'Dock to edge', 'ui.lang': 'Language', 'ui.langAuto': 'Auto (system)',
      'ui.where': 'Current location', 'ui.progress': 'Progress in this world', 'ui.levelCount': 'Level', 'ui.doneCount': '{n} cleared',
      'ui.said': 'You just said', 'ui.task': 'This task', 'ui.quote': '"{s}"', 'ui.goal': "This round's goal: {goal}",
      'ui.world': 'World {n} · {name}', 'ui.worldLabel': 'World {n}: {name}, cleared. See what was done in this round', 'ui.worldPassed': 'World {n} · {name}  cleared',
      'ui.before': '{n} earlier cleared', 'ui.after': '{n} more ahead',
      'ui.levelAria': 'Level {num}: {title}, status: {status}', 'ui.levelAria0': '{title}, status: {status}',
      'ui.tagNew': 'New', 'ui.tagSign': 'Rework', 'ui.tagPause': 'Paused',
      'ui.locked': 'Locked', 'ui.finished': 'Complete',
      'ui.waitHead': 'Waiting for you', 'ui.waitJust': 'Just started waiting', 'ui.waitMin': 'Waiting {m} min',
      'ui.waitLong': "{base}. If you've already approved, the map will update once this step finishes",
      'ui.nowJust': 'Just now', 'ui.nowNow': 'Now', 'ui.nowLine': '{when}: {text}', 'ui.touched': 'Files touched this time', 'ui.moreFiles': '{n} more', 'ui.fileLine': '{verb} {name}',
      'ui.cardNum': 'Level {n}', 'ui.offRoad': 'Off the main road', 'ui.whyWait': 'What you need to do', 'ui.whyChanged': 'Why it changed', 'ui.tech': 'Technical details',
      'ui.sessions': 'Chats ({n})', 'ui.sWaiting': 'Waiting', 'ui.sAriaWait': 'waiting for you', 'ui.sAriaProg': '{done} / {total} cleared', 'ui.sAria': '{name}, {state}, click to switch',
      'ui.connecting': 'Waiting to connect (Claude Code or Cowork)',
      'bat.open': 'Open the quest map', 'bat.waitName': 'Waiting · {name}', 'bat.wait': 'Waiting',
      'bat.ariaWaitName': "Claude in {name} is waiting for you. ", 'bat.ariaWait': 'Claude is waiting for you. ', 'bat.ariaProg': '{done} of {total} tasks filled. Click to open the quest map, hold to drag it elsewhere.',
      'bat.title': '{done} / {total} tasks done', 'bat.titleWait': 'Claude is waiting for you',
      'notif.title': 'Claude Code is waiting for you', 'notif.titleName': 'Claude Code is waiting for you · {name}', 'notif.body': 'A level needs your attention',
      'notif.ping': 'Quest Map: connection test received', 'notif.pingBody': 'From {host} ({platform})', 'notif.unknown': 'unknown',
      'open.code': 'Opened automatically by Claude Code in "{project}"', 'open.codeNoName': 'Opened automatically by Claude Code', 'open.cowork': 'Opened automatically by Cowork', 'open.manual': 'Opened by you with /quest-map:open', 'open.upgraded': ' (updated to the new version)', 'open.hint': 'To stop auto-opening: set the environment variable QUEST_PET_NO_AUTOLAUNCH=1', 'open.notifTitle': 'Quest Map opened', 'ui.dismiss': 'Dismiss',
      'status.user': 'Your turn', 'reason.user': 'This one is for you: tell Claude when it is done, and it counts once Claude has checked it', 'wait.user': 'Please do: {title} (then tell Claude)', 'ui.userHead': 'Your turn', 'ui.userHint': 'When done, tell Claude in the chat. This level clears once Claude has checked it',
      'ui.histTitle': 'Completed worlds ({a}–{b})', 'ui.older': 'Older worlds', 'ui.newer': 'Newer worlds', 'ui.histBack': 'Back to now', 'ui.histPage': '{p} / {m}',
      'plan.verify': 'Verify', 'solo.ambiguous': 'Spectra has {n} changes in progress and I am not sure which one you are working on. I will match it once Claude starts editing files.',
      'win.map': 'AI Quest Map', 'win.bat': 'Quest progress', 'win.edge': 'Edge water level'
    }
  };

  let current = DEFAULT;
  // 系統語言 → 支援的語言。中文一律用繁體，其他一律英文
  function detect(locale) {
    const l = String(locale || '').toLowerCase();
    return l.startsWith('zh') ? 'zh-TW' : 'en';
  }
  const valid = code => LANGS.some(x => x.code === code);
  function setLang(code) { current = valid(code) ? code : DEFAULT; return current; }
  const getLang = () => current;
  // 取文字：缺的鍵退回繁體中文；{name} 換成參數
  function t(key, params, lang) {
    const dict = MESSAGES[lang || current] || {};
    let s = dict[key];
    if (s == null) s = MESSAGES[DEFAULT][key];
    if (s == null) return key;
    return params ? s.replace(/\{(\w+)\}/g, (m, k) => (params[k] == null ? m : params[k])) : s;
  }
  // 同一個鍵在所有語言的樣子（比對「這是不是預設文字」用，不受語言切換影響）
  const all = key => Object.keys(MESSAGES).map(l => MESSAGES[l][key]).filter(x => x != null);
  return { LANGS, DEFAULT, MESSAGES, detect, valid, setLang, getLang, t, all };
});
