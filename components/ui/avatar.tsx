import { cn } from '@/lib/utils';
import { initials, colorFor } from '@/lib/utils';

export function Avatar({ name, id, size = 32, className }: {
  name: string;
  id: string;
  size?: number;
  className?: string;
}) {
  const color = colorFor(id);
  return (
    <span
      className={cn('inline-flex items-center justify-center rounded-full font-semibold shrink-0', className)}
      style={{
        width: size,
        height: size,
        backgroundColor: `${color}25`,
        color,
        fontSize: size * 0.4,
        border: `1px solid ${color}40`,
      }}
    >
      {initials(name)}
    </span>
  );
}
