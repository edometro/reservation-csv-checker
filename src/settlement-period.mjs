// STORES予約の通常（月1回）振込の「決済対象月」を検証する研究用モジュール。
// 公式FAQ: https://reserve-faq.stores.jp/hc/ja/articles/28713302057241
// アプリ画面・実CSV読込・仕訳出力・銀行入金照合には未接続。
// 振込額、返金、繰越、実際の振込日、会計上の計上日は判断しない。

function explicitUtcInstant(value) {
  // 時差なしの日時をローカル時刻として解釈しない。秒・明示的な時差を必須とする。
  const m = typeof value === 'string' &&
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!m) throw new Error('決済日時は秒と明示的なタイムゾーンを含むISO 8601形式で指定してください');

  const [_, year, month, day, hour, minute, second, millis, zone, sign, offHour, offMinute] = m;
  const base = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  const local = Date.parse(base + (millis ? '.' + millis : '') + 'Z');
  // Date.parse の日付丸めを拒否し、2月30日等を正常扱いしない。
  if (!Number.isFinite(local) || new Date(local).toISOString().slice(0, 19) !== base) {
    throw new Error('決済日時の年月日・時刻が不正です');
  }
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const h = Number(offHour), min = Number(offMinute);
    if (h > 14 || min > 59 || (h === 14 && min !== 0)) {
      throw new Error('タイムゾーンの時差が不正です');
    }
    offsetMinutes = (sign === '+' ? 1 : -1) * (h * 60 + min);
  }
  return new Date(local - offsetMinutes * 60_000);
}

/**
 * 通常の月次振込に限り、UTC決済月と名目上の翌月振込月を示す。
 *
 * 公式例: 8/1 01:00 JST -> 8/25入金対象（UTCでは7月）
 *         8/1 10:00 JST -> 9/25入金対象（UTCでは8月）
 *
 * nominalPayoutMonth は振込予定月の目安にすぎず、銀行入金日を保証しない。
 * 週次振込や切替直後は複雑な例外があるため判定しない。
 */
export function classifyMonthlySettlementPeriod({paymentTimestamp, payoutCycle}) {
  const instant = explicitUtcInstant(paymentTimestamp);
  if (payoutCycle !== 'monthly' && payoutCycle !== 'weekly') {
    throw new Error('入金サイクルをmonthlyまたはweeklyで指定してください');
  }
  if (payoutCycle === 'weekly') {
    return {status: 'REQUIRES_CONFIRMATION', settlementMonthUTC: null,
      nominalPayoutMonth: null};
  }
  const settlementMonthUTC = instant.toISOString().slice(0, 7);
  const nominalPayoutMonth = new Date(Date.UTC(
    instant.getUTCFullYear(), instant.getUTCMonth() + 1, 1
  )).toISOString().slice(0, 7);
  return {status: 'MONTHLY_PERIOD_ONLY', settlementMonthUTC, nominalPayoutMonth};
}
