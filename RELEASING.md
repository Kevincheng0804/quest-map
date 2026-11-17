# 發新版的步驟

1. 改程式，在 `plugins/quest-map/app` 跑測試：

   ```bash
   npm test
   ```

2. 如果改了 `quest-map.html`（地圖畫面），重新產生 `app/map.html`，**一定要一起提交**，因為外掛安裝時不會執行建置：

   ```bash
   npm run build
   ```

3. 改版本號，兩個地方要一致：
   - `plugins/quest-map/.claude-plugin/plugin.json` 的 `version`
   - `plugins/quest-map/app/package.json` 的 `version`

   版本號有設定時，使用者會停在那個版本，直到你改它，所以每次發版都要改。

4. 驗證外掛結構：

   ```bash
   claude plugin validate .
   ```

5. 確認沒有個人資訊（帳號、信箱、專案名稱）：

   ```bash
   git grep -i -E "你的帳號名稱|你的信箱"
   ```

6. 提交並推送：

   ```bash
   git add -A
   git commit -m "0.x.y：改了什麼"
   git push
   ```

7. 使用者更新：
   - Claude Code：`claude plugin marketplace update ai-quest-map`，再 `claude plugin update quest-map@ai-quest-map`，開新對話輸入 `/quest-map:open`
   - Cowork：Plugins 頁按 **Check for updates**（或開啟 **Sync automatically**），開新任務

不要提交：`node_modules/`、`*.zip`、`*.plugin`、截圖（已列在 `.gitignore`）。
