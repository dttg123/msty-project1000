import type {CorporateAction,Project,SecurityStatus} from '../types/domain.js';

const ticker=(value:unknown):string=>String(value??'').trim().toUpperCase();
const amount=(value:unknown):number=>{const parsed=Number(value);return Number.isFinite(parsed)&&parsed>0?parsed:0;};

export function tickerChange(project:Project,toSymbol:string,effectiveDate:string,id:string,createdAt=new Date().toISOString()):CorporateAction|null {
  const fromSymbol=ticker(project.symbol),next=ticker(toSymbol);
  if(!next||next===fromSymbol)return null;
  const action:CorporateAction={id,type:'tickerChange',effectiveDate,fromSymbol,toSymbol:next,createdAt};
  project.corporateActions=[...(project.corporateActions||[]),action];
  project.symbol=next;
  return action;
}

export function liquidationCashBreakdown(action:Pick<CorporateAction,'grossProceedsUSD'|'feeUSD'|'taxUSD'>):{grossUSD:number;feeUSD:number;taxUSD:number;netUSD:number} {
  const grossUSD=amount(action.grossProceedsUSD),feeUSD=amount(action.feeUSD),taxUSD=amount(action.taxUSD);
  return {grossUSD,feeUSD,taxUSD,netUSD:Math.max(0,grossUSD-feeUSD-taxUSD)};
}

export function recordLiquidation(project:Project,input:{id:string;effectiveDate:string;grossProceedsUSD?:number;feeUSD?:number;taxUSD?:number;createdAt?:string}):CorporateAction {
  const cash=liquidationCashBreakdown(input);
  const action:CorporateAction={id:input.id,type:'liquidation',effectiveDate:input.effectiveDate,grossProceedsUSD:cash.grossUSD,feeUSD:cash.feeUSD,taxUSD:cash.taxUSD,createdAt:input.createdAt||new Date().toISOString()};
  project.corporateActions=[...(project.corporateActions||[]),action];
  project.status='liquidated';
  return action;
}

export function securityStateAt(project:Project,asOf:string):{symbol:string;status:SecurityStatus;liquidationNetUSD:number} {
  let symbol=ticker(project.symbol),status:SecurityStatus='active',liquidationNetUSD=0;
  const actions=[...(project.corporateActions||[])].filter(action=>action.effectiveDate<=asOf).sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  const firstTicker=actions.find(action=>action.type==='tickerChange')?.fromSymbol;
  if(firstTicker)symbol=firstTicker;
  for(const action of actions){
    if(action.type==='tickerChange'&&action.toSymbol)symbol=action.toSymbol;
    if(action.type==='liquidation'){status='liquidated';liquidationNetUSD+=liquidationCashBreakdown(action).netUSD;}
  }
  if(!(project.corporateActions||[]).length)status=project.status||'active';
  return {symbol,status,liquidationNetUSD};
}
