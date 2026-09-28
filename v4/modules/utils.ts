export const n: any = (value: any) => Number(value) || 0;
export const clamp: any = (value: any, min: any, max: any) => Math.min(max, Math.max(min, value));
export const round: any = (value: any, digits = 8) => Number(n(value).toFixed(digits));
export const clone: any = (value: any) => JSON.parse(JSON.stringify(value));
export const uid: any = (prefix: any) => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
export const esc: any = (value: any) => String(value ?? '').replace(/[&<>'"]/g, (character: any) => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
} as any)[character]);

export function todayISO(): any {
  const date: any = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export const isDate: any = (value: any) => {
  const text: any=String(value||''),match=text.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)return false;
  const date: any=new Date(`${text}T00:00:00Z`);return !Number.isNaN(date.getTime())&&date.getUTCFullYear()===Number(match[1])&&date.getUTCMonth()+1===Number(match[2])&&date.getUTCDate()===Number(match[3]);
};
