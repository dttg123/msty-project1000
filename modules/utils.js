export const n = value => Number(value) || 0;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const round = (value, digits = 8) => Number(n(value).toFixed(digits));
export const clone = value => JSON.parse(JSON.stringify(value));
export const uid = prefix => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
export const esc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
}[character]));

export function todayISO() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export const isDate = value => {
  const text=String(value||''),match=text.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)return false;
  const date=new Date(`${text}T00:00:00Z`);return !Number.isNaN(date.getTime())&&date.getUTCFullYear()===Number(match[1])&&date.getUTCMonth()+1===Number(match[2])&&date.getUTCDate()===Number(match[3]);
};

