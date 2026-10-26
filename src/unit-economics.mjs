/**
 * Pricing assumptions calculator for business validation only.
 * All amounts are yen per month, before tax. No observed revenue is implied.
 */
function yen(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(label + 'は0以上の安全な整数（円）で指定してください');
  }
  return BigInt(value);
}
function toSafeNumber(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('計算結果が安全な整数範囲を超えています');
  return Number(value);
}

/** Profit after variable and fixed costs; ignores taxes and owner labour. */
export function projectedMonthlyProfit({customers, monthlyPriceYen, variableCostYen, fixedCostYen}) {
  const n = yen(customers, '顧客数');
  const price = yen(monthlyPriceYen, '月額単価');
  const variable = yen(variableCostYen, '顧客当たり変動費');
  const fixed = yen(fixedCostYen, '月額固定費');
  const profit = n * (price - variable) - fixed;
  if (profit < -BigInt(Number.MAX_SAFE_INTEGER) || profit > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('計算結果が安全な整数範囲を超えています');
  }
  return Number(profit);
}

/** Smallest integer customer count to reach the assumed monthly profit target. */
export function customersNeeded({targetProfitYen, monthlyPriceYen, variableCostYen, fixedCostYen}) {
  const target = yen(targetProfitYen, '目標利益');
  const price = yen(monthlyPriceYen, '月額単価');
  const variable = yen(variableCostYen, '顧客当たり変動費');
  const fixed = yen(fixedCostYen, '月額固定費');
  const margin = price - variable;
  if (margin <= 0n) return null; // No finite customer count can achieve a positive target.
  return toSafeNumber((target + fixed + margin - 1n) / margin);
}
