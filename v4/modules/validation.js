import { isDate } from './utils.js';

export function validateLedger(raw) {
  const errors=[];
  if(!raw||!Array.isArray(raw.projects)||!raw.projects.length)return ['종목 정보가 없습니다.'];
  const ids=new Set();
  for(const p of raw.projects){if(!p.id||ids.has(p.id))errors.push('종목 ID가 없거나 중복됩니다.');ids.add(p.id);}
  for(const key of ['trades','dividends','splits','cashAdjustments']){
    if(!Array.isArray(raw[key])){errors.push(`${key} 원장이 없습니다.`);continue;}
    const rowIds=new Set();
    for(const row of raw[key]){
      if(!row||!ids.has(row.projectId)||!isDate(row.date)||!row.id||rowIds.has(row.id)){errors.push(`${key}: 날짜·종목·ID를 확인해 주세요.`);continue;}
      rowIds.add(row.id);
      const valid=(field,min=0)=>Number.isFinite(Number(row[field]))&&Number(row[field])>=min;
      if(key==='trades'&&(!['buy','sell'].includes(row.type)||!valid('shares',.00000001)||!valid('price')))errors.push('거래 수량·단가가 올바르지 않습니다.');
      if(key==='dividends'&&!valid('amountUSD',.00000001))errors.push('배당 금액이 올바르지 않습니다.');
      if(key==='splits'&&(!valid('from',.00000001)||!valid('to',.00000001)))errors.push('분할 비율이 올바르지 않습니다.');
      if(key==='cashAdjustments'&&!Number.isFinite(Number(row.amountUSD)))errors.push('잔액 보정액이 올바르지 않습니다.');
    }
  }
  return [...new Set(errors)];
}
