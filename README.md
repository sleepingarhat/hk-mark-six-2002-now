# 2002-07-04 至今 香港六合彩攪珠結果

[![每日更新](https://github.com/sleepingarhat/hk-mark-six-2002-now/actions/workflows/update.yml/badge.svg)](https://github.com/sleepingarhat/hk-mark-six-2002-now/actions/workflows/update.yml)
[![資料監控](https://github.com/sleepingarhat/hk-mark-six-2002-now/actions/workflows/audit.yml/badge.svg)](https://github.com/sleepingarhat/hk-mark-six-2002-now/actions/workflows/audit.yml)

自動抓取並儲存由 **2002 年 7 月 4 日** 至今每一期香港賽馬會（HKJC）六合彩攪珠結果。
每期包括 **6 個攪出號碼** 及 **1 個特別號碼**，合共 7 個號碼。資料每日自動更新並監控。

## 資料來源

香港賽馬會官方六合彩攪珠結果 API（`info.cld.hkjc.com`，即官網攪珠結果頁面背後的資料來源）。

## 檔案

| 檔案 | 說明 |
| --- | --- |
| `data/mark-six.csv` | 主檔，每行一期：`draw,date,weekday,no1..no6,special` |
| `data/mark-six.json` | 完整資料（含期數、攪珠日期、星期、號碼、特別號碼、金多寶名稱、總投注額、頭獎基金、頭獎派彩） |

## 欄位說明

- `draw` — 期數（年份後兩位 / 期號），例如 `02/053`
- `date` — 攪珠日期（`YYYY-MM-DD`）
- `weekday` — 星期（英文縮寫）
- `no1` … `no6` — 攪出號碼（1–49，已由細至大排序）
- `special` — 特別號碼（1–49）

## 自動更新

GitHub Actions 每日（香港時間約 22:30 及 23:30，接住遲出嘅成績）自動執行 `scripts/scrape.mjs`，
抓取最新攪珠結果，若有新一期資料便會自動提交。亦可於 Actions 頁面手動觸發（`workflow_dispatch`）。

## 資料監控（Data integrity audit）

GitHub Actions 每日（香港時間約 01:00，更新跑完之後）及每次 push 時執行 `scripts/audit.mjs`，
狀態見上方 **資料監控** 徽章。檢查分兩層，並刻意避免誤報：

**硬性檢查**（不通過 → 徽章變紅）

- 每期結構合法：6 個攪出號碼 + 1 個特別號碼，全部 1–49 且 7 個不重複
- 期數 `id` 無重複、按日期由舊到新排序
- `CSV` 與 `JSON` 期數及首末行一致
- **新鮮度**：直接向 HKJC 查詢最近結果，若某期已公佈 **超過 1 日** 但本倉庫仍欠缺 → 判定漏收

**軟性提示**（只記錄於執行摘要，徽章維持綠色）

- 停辦期（如 2020 年 COVID 停攪，source 與本倉庫同樣停在舊日期）
- 臨場遲出、未夠一日的最新一期（寬限窗內）
- HKJC 暫時無法連線（跳過新鮮度檢查）
- 每年期號出現非連續（HKJC 偶有跳號的可能）

## 本地執行

```bash
node scripts/scrape.mjs          # 更新（資料為空則由 2002 年完整回補）
node scripts/scrape.mjs --full   # 強制由 2002 年重建
node scripts/audit.mjs           # 執行資料監控
```

需要 Node.js 18 或以上（使用內建 `fetch`）。

- 若 `data/mark-six.json` 不存在或為空 → 由 2002 年起完整回補。
- 若已有資料 → 由最新一期的年份起抓取並合併更新（以期數編號去重），斷更後可自動補回缺口。

## 免責聲明

本倉庫僅供資料記錄與研究用途。所有六合彩攪珠結果版權屬香港賽馬會所有。
