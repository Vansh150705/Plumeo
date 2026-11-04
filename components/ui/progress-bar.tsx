import { cn } from '@/lib/utils';

/** Accessible progress bar. `value = null` means "not measurable yet" — never rendered as 0%. */
export function ProgressBar({ value, className, label, tone }: { value: number | null | undefined; className?: string; label?: string; tone?: 'auto' | 'gold' }) {
  if (value == null) return <div className={cn('text-xs text-muted-foreground', className)}>Not measurable yet</div>;
  const v = Math.max(0, Math.min(100, value));
  const color = tone === 'gold' ? 'bg-[hsl(var(--gold))]' : v >= 70 ? 'bg-[hsl(var(--success))]' : v >= 35 ? 'bg-[hsl(var(--gold))]' : 'bg-[hsl(var(--warning))]';
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? 'Progress'} className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${v}%` }} />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round(v)}%</span>
    </div>
  );
}
