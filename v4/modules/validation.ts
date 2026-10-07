import { isDate } from './utils.js';

type RawRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is RawRecord => value!==null && typeof value==='object' && !Array.isArray(value);
const object = (value: unknown): RawRecord => isRecord(value)?value:{};

export function validateLedger(raw: unknown): string[] {
  const errors: string[]=[];
  if(!isRecord(raw)||!Array.isArray(raw.projects)||!raw.projects.length)return ['종목 정보가 없습니다.'];
  const finite=(value: unknown,min=0,max=1e15)=>value!==null&&value!==''&&value!==undefined&&Number.isFinite(Number(value))&&Number(value)>=min&&Number(value)<=max;
  const safeId=(value: unknown)=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,200}$/.test(value);
  if(!finite(object(raw.settings).exchangeRate,.000001))errors.push('환율은 0보다 큰 유한한 값이어야 합니다.');
  for(const key of ['targetMonthlyDividend','warningKRW','thresholdKRW'])if(!finite(object(raw.settings)[key]))errors.push('배당 목표·관리 기준을 확인해 주세요.');
  const ids=new Set();
  const securityIds=new Set();
  for(const value of raw.projects as unknown[]){
    const p=object(value);
    if(!p||!safeId(p.id)||ids.has(p.id)){errors.push('종목 ID가 없거나 중복됩니다.');continue;}
    ids.add(p.id);
    if(typeof p.securityId!=='string'||!/^[A-Za-z0-9_.:-]{1,200}$/.test(p.securityId)||securityIds.has(p.securityId))errors.push('종목 장기 식별자가 없거나 중복됩니다.');else securityIds.add(p.securityId);
    if(!/^[A-Z0-9.-]{1,16}$/.test(String(p.symbol||'')))errors.push('종목 티커를 확인해 주세요.');
    if(!finite(p.targetUnits,.000001)||!finite(p.currentPrice)||!finite(p.monthlyPlanShares)||!finite(p.initialDividendBalance))errors.push('종목 목표·가격·초기 잔액을 확인해 주세요.');
    if(p.dividendPlan!==undefined){const plan=object(p.dividendPlan);if(!['reinvest','outside'].includes(String(plan.mode))||!Array.isArray(plan.history)||plan.history.some(value=>{const row=object(value);return !['reinvest','outside'].includes(String(row.mode))||typeof row.confirmedAt!=='string'||!Number.isFinite(Date.parse(row.confirmedAt));}))errors.push('배당 사용 방향 이력을 확인해 주세요.');}
    if(object(p.recovery).locked&&(!finite(object(p.recovery).basis,.000001)||!isDate(object(p.recovery).startDate)))errors.push('원금회수 기준을 확인해 주세요.');
    if(!['active','inactive','liquidated'].includes(String(p.status)))errors.push('종목 상태를 확인해 주세요.');
    if(!Array.isArray(p.corporateActions))errors.push('기업행위 이력이 없습니다.');
    else for(const value of p.corporateActions as unknown[]){
      const action=object(value);
      if(!action||!safeId(action.id)||!isDate(action.effectiveDate)||!['tickerChange','liquidation'].includes(String(action.type)))errors.push('기업행위 기록을 확인해 주세요.');
      if(action.type==='tickerChange'&&(!/^[A-Z0-9.-]{1,16}$/.test(String(action.fromSymbol||''))||!/^[A-Z0-9.-]{1,16}$/.test(String(action.toSymbol||''))))errors.push('티커 변경 기록을 확인해 주세요.');
      if(action.type==='liquidation'&&['grossProceedsUSD','feeUSD','taxUSD'].some(field=>action[field]!==undefined&&!finite(action[field])))errors.push('청산 정산 금액을 확인해 주세요.');
    }
  }
  const projects=new Map(raw.projects.filter(isRecord).map(project=>[project.id,project]));
  for(const key of ['trades','dividends','splits','cashAdjustments']){
    if(!Array.isArray(raw[key])){errors.push(`${key} 원장이 없습니다.`);continue;}
    const rowIds=new Set();
    for(const value of raw[key] as unknown[]){
      const row=object(value);
      if(!row||!ids.has(row.projectId)||!isDate(row.date)||!safeId(row.id)||rowIds.has(row.id)){errors.push(`${key}: 날짜·종목·ID를 확인해 주세요.`);continue;}
      rowIds.add(row.id);
      const valid=(field: string,min=0)=>finite(row[field],min);
      if(key==='trades'&&(!['buy','sell'].includes(String(row.type))||!valid('shares',.00000001)||!valid('price')))errors.push('거래 수량·단가가 올바르지 않습니다.');
      if(key==='trades'&&((row.feeUSD!==undefined&&!valid('feeUSD'))||(row.taxUSD!==undefined&&!valid('taxUSD'))))errors.push('거래 수수료·세금을 확인해 주세요.');
      if(key==='trades'&&row.type==='buy'&&(!['direct','opening','reinvest','mixed'].includes(String(row.buyType))||row.buyType==='mixed'&&(!valid('reinvestAmountUSD')||Number(row.reinvestAmountUSD)>Number(row.shares)*Number(row.price))))errors.push('매수 유형·재투자액을 확인해 주세요.');
      if(key==='trades'&&row.dividendFunding!==undefined){const funding=object(row.dividendFunding);if(row.type!=='buy'||object(row.source).provider!=='toss'||typeof funding.sourceFingerprint!=='string'||!funding.sourceFingerprint||!finite(funding.amountUSD)||funding.sourceFingerprint===object(row.source).sourceFingerprint&&Number(funding.amountUSD)>Number(row.shares)*Number(row.price)+Number(row.feeUSD||0)+Number(row.taxUSD||0))errors.push('매수 자금 출처를 확인해 주세요.');}
      if(key==='cashAdjustments'&&row.purpose==='dividendUse'&&(Number(row.amountUSD)>=0||!['isa','otherDividend','living','other'].includes(String(row.destination))))errors.push('배당 사용액과 사용처를 확인해 주세요.');
      if(key==='dividends'&&(row.currency==='KRW'?(!Number.isSafeInteger(row.amountKRW)||Number(row.amountKRW)<=0||Number(row.amountKRW)>1e12||Number(row.amountUSD)!==0):!valid('amountUSD',.00000001)))errors.push('배당 금액이 올바르지 않습니다.');
      if(key==='dividends'&&row.currency!==undefined&&!['USD','KRW'].includes(String(row.currency)))errors.push('배당 통화를 확인해 주세요.');
      if(key==='dividends'&&row.status!==undefined&&!['actual','confirmed','estimated'].includes(String(row.status)))errors.push('배당 상태를 확인해 주세요.');
      if(key==='dividends'&&['grossAmountUSD','withholdingTaxUSD','taxUSD','feeUSD','netAmountUSD','rocAmountUSD'].some(field=>row[field]!==undefined&&!valid(field)))errors.push('배당 총액·세금·수수료·ROC 금액을 확인해 주세요.');
      if(key==='dividends'&&row.grossAmountUSD!==undefined&&Number(row.grossAmountUSD)+1e-8<Number(row.netAmountUSD??row.amountUSD))errors.push('배당 총액은 순배당보다 작을 수 없습니다.');
      if(key==='dividends'&&row.rocPercent!==null&&row.rocPercent!==undefined&&!finite(row.rocPercent,0,100))errors.push('ROC 비율은 0~100%여야 합니다.');
      if(key==='splits'&&(!valid('from',.00000001)||!valid('to',.00000001)))errors.push('분할 비율이 올바르지 않습니다.');
      if(key==='cashAdjustments'&&!Number.isFinite(Number(row.amountUSD)))errors.push('잔액 보정액이 올바르지 않습니다.');
      if(key==='cashAdjustments'&&row.purpose==='recoveryWithdrawal'){
        const recovery=object(projects.get(row.projectId)?.recovery);
        if(Number(row.amountUSD)>=0||!recovery?.locked||String(row.date)<String(recovery.startDate))errors.push('배당 인출 기록과 원금회수 시작일을 확인해 주세요.');
      }
    }
  }
  return [...new Set(errors)];
}
