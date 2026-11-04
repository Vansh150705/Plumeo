import * as React from 'react';
import { Feather } from 'lucide-react';

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <div className="mb-3 grid size-10 place-items-center rounded-full bg-accent"><Feather className="size-5 text-[hsl(var(--gold))]" aria-hidden /></div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
