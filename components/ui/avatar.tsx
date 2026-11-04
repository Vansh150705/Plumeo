import { cn, colorFor, initials } from '@/lib/utils';

/** Initials avatar: neutral surface + readable foreground text; the per-person colour is a ring only (contrast-safe). */
export function Avatar({ name, id, size = 32, className }: { name: string; id: string; size?: number; className?: string }) {
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-foreground', className)}
      style={{ width: size, height: size, fontSize: size * 0.38, boxShadow: `inset 0 0 0 2px ${colorFor(id)}` }}>
      {initials(name)}
    </span>
  );
}
