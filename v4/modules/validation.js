import { isDate } from './utils.js?v=0.12.0-r57';

export function validateLedger(raw) {
  const errors=[];
  if(!raw||!Array.isArray(raw.projects)||!raw.projects.length)return ['종목 정보가 없습니다.'];
  const finite=(value,min=0,max=1e15)=>value!==null&&value!==''&&value!==undefined&&Number.isFinite(Number(value))&&Number(value)>=min&&Number(value)<=max;
  const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,200}$/.test(value);
  if(!finite(raw.settings?.exchangeRate,.000001))errors.push('환율은 0보다 큰 유한한 값이어야 합니다.');
  for(const key of ['targetMonthlyDividend','warningKRW','thresholdKRW'])if(!finite(raw.settings?.[key]))errors.push('배당 목표·관리 기준을 확인해 주세요.');
  const ids=new Set();
  for(const p of raw.projects){
    if(!p||!safeId(p.id)||ids.has(p.id)){errors.push('종목 ID가 없거나 중복됩니다.');continue;}
    ids.add(p.id);
    if(!/^[A-Z0-9.-]{1,16}$/.test(p.symbol||''))errors.push('종목 티커를 확인해 주세요.');
    if(!finite(p.targetUnits,.000001)||!finite(p.currentPrice)||!finite(p.monthlyPlanShares)||!finite(p.initialDividendBalance))errors.push('종목 목표·가격·초기 잔액을 확인해 주세요.');
    if(p.recovery?.locked&&(!finite(p.recovery.basis,.000001)||!isDate(p.recovery.startDate)))errors.push('원금회수 기준을 확인해 주세요.');
  }
  for(const key of ['trades','dividends','splits','cashAdjustments']){
    if(!Array.isArray(raw[key])){errors.push(`${key} 원장이 없습니다.`);continue;}
    const rowIds=new Set();
    for(const row of raw[key]){
      if(!row||!ids.has(row.projectId)||!isDate(row.date)||!safeId(row.id)||rowIds.has(row.id)){errors.push(`${key}: 날짜·종목·ID를 확인해 주세요.`);continue;}
      rowIds.add(row.id);
      const valid=(field,min=0)=>finite(row[field],min);
      if(key==='trades'&&(!['buy','sell'].includes(row.type)||!valid('shares',.00000001)||!valid('price')))errors.push('거래 수량·단가가 올바르지 않습니다.');
      if(key==='trades'&&row.type==='buy'&&(!['direct','opening','reinvest','mixed'].includes(row.buyType)||row.buyType==='mixed'&&(!valid('reinvestAmountUSD')||Number(row.reinvestAmountUSD)>Number(row.shares)*Number(row.price))))errors.push('매수 유형·재투자액을 확인해 주세요.');
      if(key==='dividends'&&!valid('amountUSD',.00000001))errors.push('배당 금액이 올바르지 않습니다.');
      if(key==='dividends'&&row.rocPercent!==null&&row.rocPercent!==undefined&&!finite(row.rocPercent,0,100))errors.push('ROC 비율은 0~100%여야 합니다.');
      if(key==='splits'&&(!valid('from',.00000001)||!valid('to',.00000001)))errors.push('분할 비율이 올바르지 않습니다.');
      if(key==='cashAdjustments'&&!Number.isFinite(Number(row.amountUSD)))errors.push('잔액 보정액이 올바르지 않습니다.');
    }
  }
  return [...new Set(errors)];
}
