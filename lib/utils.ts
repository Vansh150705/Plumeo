import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow, parseISO } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '·';
  const dt = typeof d === 'string' ? parseISO(d) : d;
  return format(dt, 'd MMM yyyy');
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '·';
  const dt = typeof d === 'string' ? parseISO(d) : d;
  return format(dt, 'd MMM yyyy, HH:mm');
}

export function fmtRelative(d: string | Date | null | undefined): string {
  if (!d) return '·';
  const dt = typeof d === 'string' ? parseISO(d) : d;
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
