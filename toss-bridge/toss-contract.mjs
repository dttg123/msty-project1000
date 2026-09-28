const SYMBOL=/^[A-Za-z0-9.-]{1,16}$/;
const CURRENCIES=new Set(['USD','KRW']);
const SIDES=new Set(['BUY','SELL']);

function object(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:null;}
function text(value,max=256){const result=String(value??'').trim();return result&&result.length<=max?result:'';}
function decimal(value,{nullable=false,min=0,max=1e15}={}){
  if(nullable&&(value===null||value===undefined||value===''))return null;
  const number=Number(value);return Number.isFinite(number)&&number>=min&&number<=max?String(value):null;
}
function symbol(value){const result=text(value,16).toUpperCase();return SYMBOL.test(result)?result:'';}
function dateTime(value){const result=text(value,64);return result&&!Number.isNaN(Date.parse(result))?result:'';}

export function parseAccounts(value){
  if(!Array.isArray(value)||value.length>20)throw Object.assign(new Error('Invalid accounts response'),{status:502,code:'upstream-schema'});
  return value.map(row=>object(row)).filter(Boolean).map(row=>({
    accountSeq:Number(row.accountSeq),accountNo:text(row.accountNo,64),accountType:text(row.accountType,32)
  })).filter(row=>Number.isSafeInteger(row.accountSeq)&&row.accountSeq>=0&&row.accountNo);
}

export function parseHoldings(value,account){
  const root=object(value);if(!root||!Array.isArray(root.items)||root.items.length>5000)throw Object.assign(new Error('Invalid holdings response'),{status:502,code:'upstream-schema'});
  return root.items.map(row=>object(row)).filter(Boolean).map(row=>{
    const marketValue=object(row.marketValue);
    const item={
      accountId:String(account.accountSeq),accountLabel:account.accountLabel,symbol:symbol(row.symbol),name:text(row.name,128),
      market:text(row.marketCountry??row.market,32).toUpperCase(),currency:text(row.currency,3).toUpperCase(),
      quantity:decimal(row.quantity,{max:1e12}),averagePurchasePrice:decimal(row.averagePurchasePrice,{nullable:true}),
      lastPrice:decimal(row.lastPrice,{nullable:true}),marketValue:{amount:decimal(marketValue?.amount,{nullable:true})}
    };
    return item.symbol&&CURRENCIES.has(item.currency)&&item.quantity!==null?item:null;
  }).filter(Boolean);
}

export function parseOrders(value,account){
  const root=object(value);if(!root||!Array.isArray(root.orders)||root.orders.length>10000)throw Object.assign(new Error('Invalid orders response'),{status:502,code:'upstream-schema'});
  return root.orders.map(row=>object(row)).filter(Boolean).map(row=>{
    const execution=object(row.execution)||{};
    const item={
      accountId:String(account.accountSeq),accountLabel:account.accountLabel,orderId:text(row.orderId,256),symbol:symbol(row.symbol),
      side:text(row.side,8).toUpperCase(),status:text(row.status,32).toUpperCase(),currency:text(row.currency,3).toUpperCase(),
      orderedAt:dateTime(row.orderedAt),canceledAt:dateTime(row.canceledAt)||null,
      execution:{
        filledQuantity:decimal(execution.filledQuantity,{nullable:true,max:1e12}),averageFilledPrice:decimal(execution.averageFilledPrice,{nullable:true}),
        filledAmount:decimal(execution.filledAmount,{nullable:true}),commission:decimal(execution.commission,{nullable:true}),
        tax:decimal(execution.tax,{nullable:true}),filledAt:dateTime(execution.filledAt)||null,settlementDate:text(execution.settlementDate,10)||null
      }
    };
    item.market=item.currency==='USD'?'US':'KR';
    return item.orderId&&item.symbol&&SIDES.has(item.side)&&CURRENCIES.has(item.currency)&&item.orderedAt?item:null;
  }).filter(Boolean);
}

export function parsePrices(value){
  if(!Array.isArray(value)||value.length>200)throw Object.assign(new Error('Invalid prices response'),{status:502,code:'upstream-schema'});
  return value.map(row=>object(row)).filter(Boolean).map(row=>{
    const item={symbol:symbol(row.symbol),currency:text(row.currency,3).toUpperCase(),lastPrice:decimal(row.lastPrice),timestamp:dateTime(row.timestamp)};
    item.market=item.currency==='USD'?'US':'KR';
    return item.symbol&&CURRENCIES.has(item.currency)&&item.lastPrice!==null&&item.timestamp?item:null;
  }).filter(Boolean);
}

export function summarizeAccountReads(settlements,priceSettlement){
  const successes=settlements.filter(row=>row.status==='fulfilled').map(row=>row.value);
  const failedAccountCount=settlements.length-successes.length,priceFailed=priceSettlement.status==='rejected';
  return {successes,failedAccountCount,priceFailed,syncStatus:failedAccountCount>0||priceFailed?'partial':'complete'};
}
