'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { useAction } from '@/components/use-action';
import { post } from '@/lib/api-client';
import { fmtRelative } from '@/lib/utils';

export function NotificationList({ items, unread }: { items: any[]; unread: number }) {
  const { run, busy } = useAction();
  return (
    <div>
      {unread > 0 && <div className="mb-3 flex justify-end"><Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => post('/notifications/read', {}), { success: 'All caught up.' })}>Mark all as read</Button></div>}
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">{items.map((n) => (
        <li key={n.id} className={n.read_at ? '' : 'bg-[hsl(var(--gold))]/5'}>
          <Link href={n.link ?? '/app'} onClick={() => { if (!n.read_at) post('/notifications/read', { ids: [n.id] }).catch(() => {}); }} className="block px-4 py-3 hover:bg-accent/50">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2 text-sm font-medium">{!n.read_at && <span className="size-2 rounded-full bg-[hsl(var(--gold))]" aria-label="Unread" />}{n.title}</div><p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{n.body}</p></div><div className="flex shrink-0 flex-col items-end gap-1"><span className="text-xs text-muted-foreground">{fmtRelative(n.created_at)}</span><Pill>{n.category}</Pill></div></div>
          </Link></li>))}</ul>
    </div>
  );
}
