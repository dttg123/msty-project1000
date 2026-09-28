import {blankProject,blankState} from '../../modules/state.js';

export const LIFETIME_PROFILES={
  '1y':{years:1,seed:1001},
  '5y':{years:5,seed:5005},
  '10y':{years:10,seed:1010},
  '30y':{years:30,seed:3030},
  '35y':{years:35,seed:3535}
};

const rng=seed=>{let value=seed>>>0;return()=>((value=(value*1664525+1013904223)>>>0)/4294967296);};
const date=(year,month,day)=>`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
const fixed=value=>Number(value.toFixed(6));

export function generateLifetimeLedger({years,seed,startYear=1990}){
  const random=rng(seed),state=blankState();
  const specs=[
    {symbol:'WEEK',category:'highYield',frequency:'weekly',price:12},
    {symbol:'MONTH',category:'dividend',frequency:'monthly',price:30},
    {symbol:'QUARTER',category:'growth',frequency:'quarterly',price:60}
  ];
  state.schemaVersion=4;
  state.settings={...state.settings,displayCurrency:'USD',exchangeRate:1370};
  state.projects=specs.map((spec,index)=>Object.assign(blankProject(spec.symbol,`${spec.symbol} Fixture`),{
    id:`p-${spec.symbol.toLowerCase()}`,securityId:`fixture:${spec.symbol}`,symbol:spec.symbol,tag:'장기 QA',category:spec.category,
    targetUnits:10000,monthlyPlanShares:index+1,projectStart:date(startYear,1,1),currentPrice:spec.price,
    distributionFrequency:spec.frequency,distributionFrequencyMode:'manual',status:'active',corporateActions:[],brokerLinks:[],colorIndex:index
  }));
  state.trades=[];state.dividends=[];state.splits=[];state.cashAdjustments=[];
  state.meta={createdAt:`${startYear}-01-01T00:00:00.000Z`,updatedAt:`${startYear+years}-01-01T00:00:00.000Z`,qa:{generator:'lifetime-ledger-v1',seed,years,startYear}};
  const shares=new Map(state.projects.map(project=>[project.id,0]));
  let tradeId=0,dividendId=0,splitId=0;
  for(let yearOffset=0;yearOffset<years;yearOffset++){
    const year=startYear+yearOffset;
    for(let month=1;month<=12;month++){
      state.projects.forEach((project,index)=>{
        const price=fixed(specs[index].price*(0.8+random()*.5)*(1+yearOffset*.015));
        const quantity=fixed(1+index+random()*2);
        state.trades.push({id:`g-t-${tradeId++}`,projectId:project.id,symbol:project.symbol,date:date(year,month,2),type:'buy',buyType:month%4===0?'reinvest':'direct',shares:quantity,price,feeUSD:.05,taxUSD:0,createdAt:`${date(year,month,2)}T00:00:00.000Z`});
        shares.set(project.id,fixed(shares.get(project.id)+quantity));
        if(yearOffset>0&&month===12&&shares.get(project.id)>5){
          const sold=fixed(shares.get(project.id)*.08);
          state.trades.push({id:`g-t-${tradeId++}`,projectId:project.id,symbol:project.symbol,date:date(year,month,20),type:'sell',shares:sold,price:fixed(price*1.03),feeUSD:.07,taxUSD:.03,createdAt:`${date(year,month,20)}T00:00:00.000Z`});
          shares.set(project.id,fixed(shares.get(project.id)-sold));
        }
        const days=project.distributionFrequency==='weekly'?[4,11,18,25]:project.distributionFrequency==='monthly'?[15]:month%3===0?[21]:[];
        for(const day of days){
          const gross=fixed((.08+index*.05+random()*.04)*shares.get(project.id));
          const tax=fixed(gross*.15),fee=dividendId%17===0?.01:0,net=fixed(gross-tax-fee),rocPercent=dividendId%10===0?25:0;
          state.dividends.push({id:`g-d-${dividendId++}`,projectId:project.id,symbol:project.symbol,date:date(year,month,day),status:'actual',grossAmountUSD:gross,withholdingTaxUSD:tax,feeUSD:fee,amountUSD:net,rocPercent,rocStatus:rocPercent?'final':'none',sharesAtPayment:shares.get(project.id),createdAt:`${date(year,month,day)}T00:00:00.000Z`});
        }
      });
    }
    if(yearOffset===Math.min(4,years-1)){
      const project=state.projects[0];state.splits.push({id:`g-s-${splitId++}`,projectId:project.id,symbol:project.symbol,date:date(year,7,1),from:1,to:2,type:'forward',createdAt:`${date(year,7,1)}T00:00:00.000Z`});shares.set(project.id,fixed(shares.get(project.id)*2));
    }
  }
  const finalYear=startYear+years;
  state.projects[1].corporateActions=[{id:'g-ca-ticker',type:'tickerChange',effectiveDate:date(finalYear-1,6,1),fromSymbol:'MONTH',toSymbol:'MONTHX',createdAt:`${date(finalYear-1,5,1)}T00:00:00.000Z`}];
  state.projects[1].symbol='MONTHX';
  state.dividends.push({id:'g-d-confirmed',projectId:state.projects[0].id,symbol:state.projects[0].symbol,date:date(finalYear,1,8),status:'confirmed',amountUSD:100,sharesAtPayment:shares.get(state.projects[0].id)});
  state.dividends.push({id:'g-d-estimated',projectId:state.projects[2].id,symbol:state.projects[2].symbol,date:date(finalYear,3,21),status:'estimated',amountUSD:200,sharesAtPayment:shares.get(state.projects[2].id)});
  return state;
}

export function lifetimeSummary(state){
  return {
    schemaVersion:state.schemaVersion,projects:state.projects.length,trades:state.trades.length,dividends:state.dividends.length,
    splits:state.splits.length,corporateActions:state.projects.reduce((sum,project)=>sum+project.corporateActions.length,0),
    grossDividendUSD:fixed(state.dividends.filter(row=>row.status==='actual').reduce((sum,row)=>sum+Number(row.grossAmountUSD||row.amountUSD||0),0)),
    netDividendUSD:fixed(state.dividends.filter(row=>row.status==='actual').reduce((sum,row)=>sum+Number(row.amountUSD||0),0))
  };
}
