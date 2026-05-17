import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow, parseISO } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? parseISO(d) : d;
  return format(dt, 'd MMM yyyy');
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? parseISO(d) : d;
  return format(dt, 'd MMM yyyy, HH:mm');
}

export function fmtRelative(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? parseISO(d) : d;
  return formatDistanceToNow(dt, { addSuffix: true });
}

export function initials(name: string): string {
  return name.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
}

const AVATAR_PALETTE = ['#f0b429', '#c084fc', '#60a5fa', '#4ade80', '#fb923c', '#f87171', '#22d3ee', '#a78bfa'];
export function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n == null || !isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}
