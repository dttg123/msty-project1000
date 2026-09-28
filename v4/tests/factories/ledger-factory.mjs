export const project=(overrides={})=>({
  id:'p-fixture',securityId:'local:p-fixture',symbol:'TEST',name:'Fixture Security',tag:'QA',category:'dividend',
  targetUnits:100,monthlyPlanShares:1,projectStart:'2026-01-01',currentPrice:10,
  priceSource:'manual',priceUpdatedAt:'',distributionFrequency:'monthly',distributionFrequencyMode:'manual',
  initialDividendBalance:0,initialDividendBalanceDate:'',afterGoalMode:'cashflow',
  recovery:{locked:false,basis:0,startDate:'',targetReachedDate:'',calculatedBasisAtLock:0,confirmedAt:'',method:'withdrawnOnly'},
  brokerLinks:[],status:'active',corporateActions:[],colorIndex:0,archived:false,...overrides
});

export const ledger=(overrides={})=>({
  version:4,schemaVersion:4,
  settings:{exchangeRate:1370,exchangeRateMode:'manual',displayCurrency:'USD',targetMonthlyDividend:100,warningKRW:18000000,thresholdKRW:20000000,appearance:'system'},
  projects:[project()],trades:[],dividends:[],splits:[],cashAdjustments:[],
  integrations:{toss:{status:'not_connected',syncCursor:{ordersThrough:''},capabilities:{},sourceLedger:{orders:[],dividends:[]}}},
  meta:{createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'},
  ...overrides
});

export const buy=(overrides={})=>({id:'t-buy',projectId:'p-fixture',symbol:'TEST',date:'2026-01-02',type:'buy',buyType:'direct',shares:1,price:10,feeUSD:0,taxUSD:0,...overrides});
export const sell=(overrides={})=>({id:'t-sell',projectId:'p-fixture',symbol:'TEST',date:'2026-01-03',type:'sell',shares:1,price:10,feeUSD:0,taxUSD:0,...overrides});
export const dividend=(overrides={})=>({id:'d-actual',projectId:'p-fixture',symbol:'TEST',date:'2026-01-04',status:'actual',amountUSD:1,sharesAtPayment:1,...overrides});
