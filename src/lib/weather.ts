// One weather scale for the whole product (primer section 1). Must match pipeline/common.py.

export const BANDS = [
  { low: 0, high: 20, label: 'Clear', colour: '#34d399' },
  { low: 21, high: 40, label: 'Cloudy', colour: '#a3e635' },
  { low: 41, high: 60, label: 'Rain', colour: '#facc15' },
  { low: 61, high: 75, label: 'Storm Watch', colour: '#fb923c' },
  { low: 76, high: 90, label: 'Severe Storm', colour: '#f87171' },
  { low: 91, high: 100, label: 'Hurricane', colour: '#e11d48' },
] as const;

export function weatherLabel(score: number | null | undefined): string {
  if (score === null || score === undefined || Number.isNaN(score)) return 'No data';
  for (const b of BANDS) if (score <= b.high) return b.label;
  return 'Hurricane';
}

export function stressColour(score: number | null | undefined): string {
  if (score === null || score === undefined || Number.isNaN(score)) return '#64748b';
  for (const b of BANDS) if (score <= b.high) return b.colour;
  return '#e11d48';
}

export function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  return n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function signed(n: number | null | undefined, digits = 1, unit = ''): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  const s = n > 0 ? '+' : n < 0 ? '−' : '±';
  return `${s}${Math.abs(n).toFixed(digits)}${unit}`;
}

export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'n/a';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}bn`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}m`;
  return `$${fmt(n)}`;
}

export function ageHours(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (Date.now() - t) / 3_600_000;
}

export function ageText(iso: string | undefined | null): string {
  const h = ageHours(iso);
  if (h === null) return 'unknown';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export const CLASS_ORDER = ['credit', 'equities', 'bonds', 'liquidity', 'fx', 'commodities', 'crypto', 'news', 'trade'];
