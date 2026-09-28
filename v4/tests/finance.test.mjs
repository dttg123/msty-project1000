import assert from 'node:assert/strict';
import {blankState} from '../modules/state.js';
import {createPortfolioEngine} from '../modules/portfolio.js';
import {applyRocToBasis,dividendCashBreakdown,economicTotalReturn,tradeCashBreakdown} from '../modules/finance.js';

const buy={id:'buy-1',projectId:'p-msty',date:'2026-01-01',type:'buy',buyType:'direct',shares:10,price:10,feeUSD:2,taxUSD:1};
const sell={id:'sell-1',projectId:'p-msty',date:'2026-01-03',type:'sell',shares:5,price:12,feeUSD:1,taxUSD:.5};
assert.deepEqual(tradeCashBreakdown(buy),{executionAmountUSD:100,feeUSD:2,taxUSD:1,grossBuyCostUSD:103,netSellProceedsUSD:0});
assert.deepEqual(tradeCashBreakdown(sell),{executionAmountUSD:60,feeUSD:1,taxUSD:.5,grossBuyCostUSD:0,netSellProceedsUSD:58.5});

const dividend={id:'div-1',projectId:'p-msty',date:'2026-01-02',status:'actual',amountUSD:8.5,grossAmountUSD:10,withholdingTaxUSD:1,feeUSD:.5,rocAmountUSD:4};
assert.deepEqual(dividendCashBreakdown(dividend),{grossUSD:10,withholdingTaxUSD:1,feeUSD:.5,netUSD:8.5,rocUSD:4,incomeUSD:4.5,status:'actual'});
assert.deepEqual(applyRocToBasis(3,5),{costBasisUSD:0,basisReductionUSD:3,excessRocUSD:2});
assert.equal(economicTotalReturn({marketValueUSD:55,buyCashOutUSD:103,sellCashInUSD:58.5,dividendCashInUSD:8.5}),19);

const state=blankState(),project=state.projects[0];project.id='p-msty';project.currentPrice=11;state.trades=[buy,sell];state.dividends=[dividend,{...dividend,id:'confirmed',status:'confirmed',amountUSD:100},{...dividend,id:'estimated',status:'estimated',amountUSD:100}];
const engine=createPortfolioEngine(()=>state,()=>project.id),calc=engine.computeProject(project);
assert.equal(calc.shares,5);assert.equal(calc.costBasis,49.5);assert.equal(calc.realized,9);assert.equal(calc.unrealized,5.5);assert.equal(calc.totalReturn,19);
assert.equal(calc.grossDividendsTotal,10);assert.equal(calc.dividendTaxes,1);assert.equal(calc.dividendFees,.5);assert.equal(calc.dividendsTotal,8.5);assert.equal(calc.rocDistributions,4);assert.equal(calc.incomeDividends,4.5);assert.equal(calc.rocBasisReduction,4);assert.equal(calc.excessRoc,0);
assert.equal(calc.tradeFees,3);assert.equal(calc.tradeTaxes,1.5);assert.equal(calc.postedDividends.length,1,'confirmed and estimated dividends are not actual cash');
assert.ok(Math.abs(calc.unrealized+calc.realized+calc.incomeDividends+calc.excessRoc-calc.totalReturn)<1e-10,'tax-basis reconciliation must match economic return');
console.log('Finance contract PASS: fees, taxes, ROC basis, realized P&L, economic total return, and dividend states reconciled');
