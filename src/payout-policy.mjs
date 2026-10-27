// STORES予約の振込手数料に関する公式FAQの条件分岐を合成例で確認するための
// 独立した研究用モジュール。画面・仕訳・実データ処理には接続していない。
// https://reserve-faq.stores.jp/hc/ja/articles/60506686975257
const CUTOFF = '2026-08-25';
const THRESHOLD = 10000;
const TRANSFER_FEE = 275;
const SMALL_TRANSFER_ADMIN_FEE = 275;

function isValidDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}

/**
 * 合成シナリオで「振込なし」「手数料275円」「手数料550円」を分類する。
 * payoutAmountYen は実際の入金対象額が確定済みと仮定した数値であり、
 * 予約売上合計・決済額・予定入金額から算出してはいけない。
 * 決済手数料、返金、繰越、入金確定状況、銀行口座への実入金は計算しない。
 */
export function classifyPayoutFeeScenario({
  transferDate,
  payoutAmountYen,
  transferUnderThreshold
}) {
  if (!isValidDate(transferDate)) throw new Error('振込日が不正です');
  if (!Number.isSafeInteger(payoutAmountYen) || payoutAmountYen < 0) {
    throw new Error('入金対象額は0以上の安全な整数で指定してください');
  }
  if (typeof transferUnderThreshold !== 'boolean') {
    throw new Error('1万円未満の振込設定を指定してください');
  }

  // 公式FAQの変更は2026年8月25日以降の実振込に適用される。
  // それ以前の事務手数料等の適用条件は、この関数では判断しない。
  if (transferDate < CUTOFF) {
    return {status: 'OUT_OF_SCOPE', transferFeeYen: null, adminFeeYen: null,
      totalFeesYen: null};
  }
  // 0円の場合の実際の振込可否はFAQの説明だけでは確定できない。
  if (payoutAmountYen === 0) {
    return {status: 'REQUIRES_CONFIRMATION', transferFeeYen: null,
      adminFeeYen: null, totalFeesYen: null};
  }
  if (payoutAmountYen < THRESHOLD && !transferUnderThreshold) {
    return {status: 'CARRIED_OVER', transferFeeYen: 0,
      adminFeeYen: 0, totalFeesYen: 0};
  }
  // FAQでは手数料を上回らない小額の振込可否・処理方法が不明。
  // 振込が成立したものとして扱わない。
  if (payoutAmountYen <= 550 && transferUnderThreshold) {
    return {status: 'REQUIRES_CONFIRMATION', transferFeeYen: null,
      adminFeeYen: null, totalFeesYen: null};
  }
  const adminFeeYen = payoutAmountYen < THRESHOLD ? SMALL_TRANSFER_ADMIN_FEE : 0;
  return {status: 'FEE_SCENARIO', transferFeeYen: TRANSFER_FEE,
    adminFeeYen, totalFeesYen: TRANSFER_FEE + adminFeeYen};
}
