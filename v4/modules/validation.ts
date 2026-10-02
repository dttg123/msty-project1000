import { isDate } from './utils.js';

export function validateLedger(raw: any): any {
  const errors: any=[];
  if(!raw||!Array.isArray(raw.projects)||!raw.projects.length)return ['종목 정보가 없습니다.'];
  const finite: any=(value: any,min=0,max=1e15)=>value!==null&&value!==''&&value!==undefined&&Number.isFinite(Number(value))&&Number(value)>=min&&Number(value)<=max;
  const safeId: any=(value: any)=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,200}$/.test(value);
  if(!finite(raw.settings?.exchangeRate,.000001))errors.push('환율은 0보다 큰 유한한 값이어야 합니다.');
  for(const key of ['targetMonthlyDividend','warningKRW','thresholdKRW'])if(!finite(raw.settings?.[key]))errors.push('배당 목표·관리 기준을 확인해 주세요.');
  const ids: any=new Set();
  const securityIds: any=new Set();
  for(const p of raw.projects){
    if(!p||!safeId(p.id)||ids.has(p.id)){errors.push('종목 ID가 없거나 중복됩니다.');continue;}
    ids.add(p.id);
    if(typeof p.securityId!=='string'||!/^[A-Za-z0-9_.:-]{1,200}$/.test(p.securityId)||securityIds.has(p.securityId))errors.push('종목 장기 식별자가 없거나 중복됩니다.');else securityIds.add(p.securityId);
    if(!/^[A-Z0-9.-]{1,16}$/.test(p.symbol||''))errors.push('종목 티커를 확인해 주세요.');
    if(!finite(p.targetUnits,.000001)||!finite(p.currentPrice)||!finite(p.monthlyPlanShares)||!finite(p.initialDividendBalance))errors.push('종목 목표·가격·초기 잔액을 확인해 주세요.');
    if(p.recovery?.locked&&(!finite(p.recovery.basis,.000001)||!isDate(p.recovery.startDate)))errors.push('원금회수 기준을 확인해 주세요.');
    if(!['active','inactive','liquidated'].includes(p.status))errors.push('종목 상태를 확인해 주세요.');
    if(!Array.isArray(p.corporateActions))errors.push('기업행위 이력이 없습니다.');
    else for(const action of p.corporateActions){
      if(!action||!safeId(action.id)||!isDate(action.effectiveDate)||!['tickerChange','liquidation'].includes(action.type))errors.push('기업행위 기록을 확인해 주세요.');
      if(action.type==='tickerChange'&&(!/^[A-Z0-9.-]{1,16}$/.test(action.fromSymbol||'')||!/^[A-Z0-9.-]{1,16}$/.test(action.toSymbol||'')))errors.push('티커 변경 기록을 확인해 주세요.');
      if(action.type==='liquidation'&&['grossProceedsUSD','feeUSD','taxUSD'].some(field=>action[field]!==undefined&&!finite(action[field])))errors.push('청산 정산 금액을 확인해 주세요.');
    }
  }
  const projects: any=new Map(raw.projects.filter(Boolean).map((project: any)=>[project.id,project]));
  for(const key of ['trades','dividends','splits','cashAdjustments']){
    if(!Array.isArray(raw[key])){errors.push(`${key} 원장이 없습니다.`);continue;}
    const rowIds: any=new Set();
    for(const row of raw[key]){
      if(!row||!ids.has(row.projectId)||!isDate(row.date)||!safeId(row.id)||rowIds.has(row.id)){errors.push(`${key}: 날짜·종목·ID를 확인해 주세요.`);continue;}
      rowIds.add(row.id);
      const valid: any=(field: any,min=0)=>finite(row[field],min);
      if(key==='trades'&&(!['buy','sell'].includes(row.type)||!valid('shares',.00000001)||!valid('price')))errors.push('거래 수량·단가가 올바르지 않습니다.');
      if(key==='trades'&&((row.feeUSD!==undefined&&!valid('feeUSD'))||(row.taxUSD!==undefined&&!valid('taxUSD'))))errors.push('거래 수수료·세금을 확인해 주세요.');
      if(key==='trades'&&row.type==='buy'&&(!['direct','opening','reinvest','mixed'].includes(row.buyType)||row.buyType==='mixed'&&(!valid('reinvestAmountUSD')||Number(row.reinvestAmountUSD)>Number(row.shares)*Number(row.price))))errors.push('매수 유형·재투자액을 확인해 주세요.');
      if(key==='dividends'&&(row.currency==='KRW'?(!Number.isSafeInteger(row.amountKRW)||row.amountKRW<=0||row.amountKRW>1e12||Number(row.amountUSD)!==0):!valid('amountUSD',.00000001)))errors.push('배당 금액이 올바르지 않습니다.');
      if(key==='dividends'&&row.currency!==undefined&&!['USD','KRW'].includes(row.currency))errors.push('배당 통화를 확인해 주세요.');
      if(key==='dividends'&&row.status!==undefined&&!['actual','confirmed','estimated'].includes(row.status))errors.push('배당 상태를 확인해 주세요.');
      if(key==='dividends'&&['grossAmountUSD','withholdingTaxUSD','taxUSD','feeUSD','netAmountUSD','rocAmountUSD'].some(field=>row[field]!==undefined&&!valid(field)))errors.push('배당 총액·세금·수수료·ROC 금액을 확인해 주세요.');
      if(key==='dividends'&&row.grossAmountUSD!==undefined&&Number(row.grossAmountUSD)+1e-8<Number(row.netAmountUSD??row.amountUSD))errors.push('배당 총액은 순배당보다 작을 수 없습니다.');
      if(key==='dividends'&&row.rocPercent!==null&&row.rocPercent!==undefined&&!finite(row.rocPercent,0,100))errors.push('ROC 비율은 0~100%여야 합니다.');
      if(key==='splits'&&(!valid('from',.00000001)||!valid('to',.00000001)))errors.push('분할 비율이 올바르지 않습니다.');
      if(key==='cashAdjustments'&&!Number.isFinite(Number(row.amountUSD)))errors.push('잔액 보정액이 올바르지 않습니다.');
      if(key==='cashAdjustments'&&row.purpose==='recoveryWithdrawal'){
        const recovery: any=projects.get(row.projectId)?.recovery;
        if(Number(row.amountUSD)>=0||!recovery?.locked||row.date<recovery.startDate)errors.push('배당 인출 기록과 원금회수 시작일을 확인해 주세요.');
      }
    }
  }
  return [...new Set(errors)];
}
