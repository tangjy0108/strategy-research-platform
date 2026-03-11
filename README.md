# Strategy Research Platform v3.2.1

- Fix: sql.js build issue on Next.js / Vercel by switching to client-only dynamic import from `sql.js/dist/sql-wasm.js`.
- Add webpack fallbacks for browser bundle.
- Keep wrapped zip structure for deployment scripts.

# Strategy Research Platform v3.2

可部署到 Vercel 的 Next.js 策略研究平台，支援：

- Binance / OKX K 線抓取
- HTF Trend + Pullback 回測
- SNR + FVG + LQ / TC 回測
- Parameter Lab / Heatmap
- Trade Breakdown / Setup / Regime / Exit 統計
- Pine-like state tracking
- Markdown / PDF report 匯出
- 瀏覽器端 SQLite（sql.js）保存 multi-run history
- server-side in-memory K 線快取

## 本版新增

- FVG fill depth：不再只有 touch / break，改為追蹤 partial / mid / deep fill
- 多 run 歷史保存：使用 sql.js 在瀏覽器 localStorage 持久化回測摘要與報告
- PDF report：一鍵輸出 PDF
- Pine-like state tracking：SNR / FVG / LQ / TC 狀態計數
- API routes 指定 Node runtime 與 maxDuration，較貼近 Vercel 部署方式

## 本地執行

```bash
npm install
npm run dev
```

## Vercel 部署

可直接推上 GitHub 再匯入 Vercel。這版採用：

- App Router
- `app/api/**/route.ts`
- `export const runtime = 'nodejs'`
- `export const maxDuration = 60`

## 注意事項

- SQLite 為瀏覽器端 sql.js，不是伺服器端持久資料庫。
- in-memory cache 僅保證同一個 warm instance 有機會命中。
- 尚未在此環境完成 `npm install` / `next build` 實機驗證，建議你本地先跑一次再部署。
