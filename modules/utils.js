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

export const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
