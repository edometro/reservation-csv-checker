import {
  replacementCustomersNeeded, acquisitionBudget, monthlyProfitAfterReplacement
} from '../src/retention-economics.mjs';

const assumptions = {
  monthlyPriceYen: 2980, variableCostYen: 300, fixedCostYen: 10000,
  monthlyChurnBps: 500, acquisitionCostYen: 5000
};
console.log('【仮説のみ】月次解約率5%、顧客獲得費5000円/人。実績・需要証明ではありません。');
console.log('継続顧客数 | 月次補充人数 | 補充獲得費(円) | 補充費控除後の月次利益(円) | 初期獲得費(円)');
for (const activeCustomers of [40, 42, 46, 47]) {
  const replacement = replacementCustomersNeeded({activeCustomers, monthlyChurnBps: assumptions.monthlyChurnBps});
  const replacementCost = acquisitionBudget({newCustomers: replacement, acquisitionCostYen: assumptions.acquisitionCostYen});
  const profit = monthlyProfitAfterReplacement({activeCustomers, ...assumptions});
  const upfront = acquisitionBudget({newCustomers: activeCustomers, acquisitionCostYen: assumptions.acquisitionCostYen});
  console.log([activeCustomers, replacement, replacementCost, profit, upfront].join(' | '));
}
