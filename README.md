# 屈臣氏酒窖 分店地址 | Watsons Wine Store Finder

以 [屈臣氏酒窖官方 store finder](https://www.watsonswine.com/zh-hk/store-finder) 為藍本製作的分店地址頁，**中英雙語對照**，按地區整理，每日自動更新。

## 線上查閱

**https://balljoebiz.github.io/w-store-list/**

## 頁面特色

- **地區分組**：港島 → 九龍 → 新界 → 澳門（保留官方地區順序）
- **中英雙語欄位**：店名、地址（中文取自 zh_HK 頁、英文取自 en 頁）
- **其餘欄位**：營業時間、電話等統一採用繁體中文頁資料
- **篩選功能**：地區下拉、中英文關鍵字搜尋
- **卡片資訊**：店號、中英文店名、中英文地址、營業時間、電話、服務標籤、地圖與官方頁面連結

## 資料來源

| 項目 | 來源 |
|---|---|
| 中文資料 | `api.watsonswine.com/api/v2/wwhk/stores/watStores?...&lang=zh_HK` |
| 英文資料 | `api.watsonswine.com/api/v2/wwhk/stores/watStores?...&lang=en` |

## 本地執行

```bash
node build-ww-store-list.js .
```

會抓取官方 API 並生成 `index.html` 與 `ww-stores.json`。

## 每日自動更新

`.github/workflows/update.yml` 設定每日 **13:31（香港時間）** 執行：

1. 抓取中英文店舖資料
2. 重新生成頁面
3. **僅在資料真的變更時**才 commit + push（無變化則完全不動）

### 精準變更偵測

- HTML 內**不含任何時間戳**，「本頁載入時間」由前端 JavaScript 動態產生
- 資料檔記錄 `dataUpdated`（資料實際變更日），只在店舖資料改變時更新
- 因此即使每天檢查，資料未變就不會產生 commit，保持 git 歷史乾淨

## 注意事項

- 資料僅供參考，實際營業時間以官方為準。
- 本專案與屈臣氏集團無任何關聯，僅為公開資料的自動整理。
- 官方 API 有 WAF 保護，瀏覽器端無法直接呼叫（CORS/403），故採 GitHub Actions 於伺服器端抓取。
