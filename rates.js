/* 費率資料表 — 唯一需要維護的檔案
 *
 * 車主端每度電費 = 台電時間電價 + 台電超額電費 + 社區充電管理費
 *
 * 台電費率來源：台灣電力公司「電價表」表燈（住商）／時間電價／簡易型時間電價（二段式）
 *   https://www.taipower.com.tw/2289/2290/46940/
 *   PDF：https://www.taipower.com.tw/media/xtofy2yw/詳細電價表.pdf
 *   中華民國114年11月17日經濟部經授能字第11400334600號函同意備查
 *   自 114 年 10 月 1 日 0 時起實施（台電 114/9/30 電業字第1148130809號公告）
 *   115 年第 1 次電價費率審議會決議 115 年 4～9 月電價不調整，故上表為現行有效費率。
 *
 * 台電下次電價檢討通常在每年 4 月 1 日與 10 月 1 日；調價後請更新 taipower 與
 * effectiveLabel，其餘計算與畫面會自動跟著變。
 */
window.RATE_DATA = {
  source: {
    label: '台電 表燈（住商）簡易型時間電價・二段式',
    effectiveLabel: '114/10/1 起實施（115 年 4～9 月凍漲）',
    url: 'https://www.taipower.com.tw/2289/2290/46940/',
  },

  // 台電流動電費（元/度）。夏月為 6/1–9/30。
  taipower: {
    summer: { peak: 5.16, offpeak: 2.06 },
    nonSummer: { peak: 4.93, offpeak: 1.99 },
  },

  // 社區在台電電價之上逐度加收的項目，順序即畫面顯示順序。
  surcharges: [
    { key: 'over2000', label: '台電超額電費（每月總度數超過 2,000 度之部分）', short: '超額', amount: 1.04 },
    { key: 'management', label: '社區充電管理費', short: '管理費', amount: 0.5 },
  ],
};
