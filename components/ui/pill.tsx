import * as React from 'react';
import { cn } from '@/lib/utils';
import type { SheetStatus, GoalProgress } from '@/lib/types';

type Variant = 'green' | 'red' | 'blue' | 'purple' | 'orange' | 'gray' | 'gold';

export function Pill({
  variant = 'gray',
  className,
  children,
}: {
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={cn(`pill pill-${variant}`, className)}>{children}</span>;
}

export function StatusPill({ status }: { status: SheetStatus }) {
  const map: Record<SheetStatus, { v: Variant; label: string }> = {
    Draft:     { v: 'gray',   label: 'Draft' },
    Submitted: { v: 'blue',   label: 'Submitted' },
    Returned:  { v: 'orange', label: 'Returned' },
    Approved:  { v: 'green',  label: 'Approved' },
    Locked:    { v: 'gold',   label: 'Locked' },
  };
  const { v, label } = map[status];
  return <Pill variant={v}>{label}</Pill>;
}

export function ProgressPill({ status }: { status: GoalProgress }) {
  const map: Record<GoalProgress, { v: Variant; label: string }> = {
    NotStarted: { v: 'gray',   label: 'Not Started' },
    OnTrack:    { v: 'blue',   label: 'On Track' },
    AtRisk:     { v: 'orange', label: 'At Risk' },
    Completed:  { v: 'green',  label: 'Completed' },
  };
  const { v, label } = map[status];
  return <Pill variant={v}>{label}</Pill>;
}
