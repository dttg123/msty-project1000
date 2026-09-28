import { PROJECT_COLORS } from './constants.js';
import { n } from './utils.js';

export function createFormatters(getState: any): any {
  function displayCurrency(): any {
    return getState().settings.displayCurrency === 'KRW' ? 'KRW' : 'USD';
  }

  function fmtMoney(usd: any, digits: any =2): any {
    const state: any=getState();
    if (displayCurrency()==='KRW') return `${Math.round(n(usd)*Math.max(0,n(state.settings.exchangeRate))).toLocaleString('ko-KR')}원`;
    return `${n(usd)<0?'-':''}$${Math.abs(n(usd)).toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits})}`;
  }

  const fmtSignedMoney: any = (usd: any) => `${n(usd)>=0?'+':'-'}${fmtMoney(Math.abs(n(usd)))}`;
  const fmtShares: any = (value: any) => n(value).toLocaleString('en-US',{maximumFractionDigits:4});
  const fmtPct: any = (value: any) => `${n(value).toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})}%`;
  const fmtDate: any = (value: any) => {
    if(!value)return '-';
    const [year,month,day]=String(value).slice(0,10).split('-');
    return `${year}.${month}.${day}`;
  };
  const signClass: any = (value: any) => n(value)>0?'positive':n(value)<0?'negative':'';
  const projectColors: any = (project: any) => PROJECT_COLORS[n(project?.colorIndex)%PROJECT_COLORS.length] || PROJECT_COLORS[0];

  return { displayCurrency, fmtMoney, fmtSignedMoney, fmtShares, fmtPct, fmtDate, signClass, projectColors };
}

