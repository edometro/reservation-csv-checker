import {customersNeeded,projectedMonthlyProfit} from '../src/unit-economics.mjs';
const assumptions={targetProfitYen:100000,variableCostYen:300,fixedCostYen:10000};
console.log('事業仮説シミュレーション（税・人件費・解約率を含まない。実績ではありません）');
console.log('月額単価(円) | 必要顧客数 | 達成時の試算利益(円)');
for(const monthlyPriceYen of [1980,2980,4980]){
  const customers=customersNeeded({...assumptions,monthlyPriceYen});
  const profit=projectedMonthlyProfit({customers,monthlyPriceYen,...assumptions});
  console.log([monthlyPriceYen,customers,profit].join(' | '));
}
