/**
 * Conservative customer-acquisition sensitivity model for planning only.
 * All inputs are hypothetical; churn, CAC, price and costs are not observed.
 * Bps = basis points: 500 means 5% churn per month.
 * Replacement counts are rounded up to whole customers each month.
 */
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(label + 'は0以上の安全な整数で指定してください');
  }
  return BigInt(value);
}

function safeResult(value) {
  if (value < -MAX_SAFE || value > MAX_SAFE) {
    throw new RangeError('計算結果が安全な整数範囲を超えています');
  }
  return Number(value);
}

export function replacementCustomersNeeded({activeCustomers, monthlyChurnBps}) {
  const customers = nonNegativeInteger(activeCustomers, '継続顧客数');
  const churn = nonNegativeInteger(monthlyChurnBps, '月次解約率(bps)');
  if (churn > 10000n) throw new RangeError('月次解約率(bps)は10000以下にしてください');
  return safeResult((customers * churn + 9999n) / 10000n);
}

export function acquisitionBudget({newCustomers, acquisitionCostYen}) {
  const count = nonNegativeInteger(newCustomers, '新規獲得顧客数');
  const cost = nonNegativeInteger(acquisitionCostYen, '顧客獲得費');
  return safeResult(count * cost);
}

/**
 * Monthly operating profit when churned customers are replaced to hold the
 * same active customer count. CAC is paid in full in the replacement month.
 * This is NOT an actual forecast, cash flow statement, or customer LTV.
 */
export function monthlyProfitAfterReplacement({
  activeCustomers, monthlyPriceYen, variableCostYen, fixedCostYen,
  monthlyChurnBps, acquisitionCostYen
}) {
  const customers = nonNegativeInteger(activeCustomers, '継続顧客数');
  const price = nonNegativeInteger(monthlyPriceYen, '月額単価');
  const variable = nonNegativeInteger(variableCostYen, '顧客当たり変動費');
  const fixed = nonNegativeInteger(fixedCostYen, '月額固定費');
  const cost = nonNegativeInteger(acquisitionCostYen, '顧客獲得費');
  const replacement = BigInt(replacementCustomersNeeded({activeCustomers, monthlyChurnBps}));
  return safeResult(customers * (price - variable) - fixed - replacement * cost);
}
