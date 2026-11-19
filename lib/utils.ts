import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow, parseISO } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDate(d: string | Date): Date {
  return typeof d === 'string' ? parseISO(d) : d;
}

// Dates are always rendered in UTC. Server components render on the server (UTC) and client
// components re-render in the visitor's browser, so formatting in the local timezone produced
// different text in the two places (React hydration errors #425/#422, and dates off by a day).
// A bare YYYY-MM-DD string is anchored to UTC midnight (parseISO would read it as local midnight),
// so date-only values stay on the same calendar day everywhere.
function toUtc(d: string | Date): Date {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(`${d}T00:00:00Z`);
  return toDate(d);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '·';
  const dt = toUtc(d);
  if (Number.isNaN(dt.getTime())) return '·';
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '·';
  const dt = toUtc(d);
  if (Number.isNaN(dt.getTime())) return '·';
  return `${fmtDate(dt)}, ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`;
}

export function fmtRelative(d: string | Date | null | undefined): string {
  if (!d) return '·';
  const dt = toDate(d);
  if (Number.isNaN(dt.getTime())) return '·';
  return formatDistanceToNow(dt, { addSuffix: true });
}

export function initials(name: string): string {
  return name.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
}

// warm/cool mix that stays on-brand (navy + gold leaning, no neon purple or green)
const AVATAR_PALETTE = ['#14233D', '#B8893A', '#B5613C', '#4F6B92', '#5B6B86', '#9A7B3E', '#6E86A8', '#A66A4E'];
export function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
