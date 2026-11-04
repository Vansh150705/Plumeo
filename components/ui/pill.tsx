import * as React from 'react';
import { cn } from '@/lib/utils';

export type PillVariant = 'green' | 'red' | 'blue' | 'purple' | 'orange' | 'gray' | 'gold';

export function Pill({ variant = 'gray', className, children, title }: { variant?: PillVariant; className?: string; children: React.ReactNode; title?: string }) {
  return <span title={title} className={cn(`pill pill-${variant}`, className)}>{children}</span>;
}
