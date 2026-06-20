'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { Button } from '@/components/ui/button';
import { Mail, MessageSquareText, Bell, Check, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { fmtRelative, cn } from '@/lib/utils';
import type { Notification } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';

export function Inbox({ notifications: initial }: { notifications: Notification[] }) {
  const [notifications, setNotifications] = useState(initial);
  const [filter, setFilter] = useState<'all' | 'unread' | 'Email' | 'Teams' | 'InApp'>('all');
  const [pending, startTransition] = useTransition();

  const filtered = notifications.filter(n => {
    if (filter === 'all') return true;
    if (filter === 'unread') return !n.read_at;
    return n.channel === filter;
  });

  async function markRead(id: string) {
    const supabase = createClient();
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
  }

  async function markAllRead() {
    startTransition(async () => {
      const supabase = createClient();
      const unread = notifications.filter(n => !n.read_at);
      const now = new Date().toISOString();
      for (const n of unread) {
        await supabase.from('notifications').update({ read_at: now }).eq('id', n.id);
      }
      setNotifications(prev => prev.map(n => n.read_at ? n : { ...n, read_at: now }));
    });
  }

  const unreadCount = notifications.filter(n => !n.read_at).length;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Inbox</div>
          <h1 className="font-serif text-4xl tracking-tight">{unreadCount} unread</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Multi-channel notifications: Email and Teams ship to their configured transports; In-App lives here.
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="secondary" onClick={markAllRead} disabled={pending}>
            <Check className="size-3.5" /> Mark all read
          </Button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 border-b border-border">
        {(['all', 'unread', 'Email', 'Teams', 'InApp'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-2 text-sm border-b-2 -mb-px transition',
              filter === f ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground',
            )}
          >
            {f === 'all' ? 'All' : f}
            {f === 'unread' && unreadCount > 0 && (
              <Pill variant="gold" className="ml-1.5">{unreadCount}</Pill>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card><CardContent className="p-12 text-center text-sm text-muted-foreground">
            Nothing here.
          </CardContent></Card>
        ) : (
          filtered.map(n => (
            <Card
              key={n.id}
              className={cn(
                'hover:border-primary/30 transition cursor-pointer',
                !n.read_at && 'border-primary/20 bg-primary/[0.02]',
              )}
              onClick={() => !n.read_at && markRead(n.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="size-9 rounded-lg border border-border bg-background grid place-items-center shrink-0">
                    {n.channel === 'Email' ? <Mail className="size-4 text-blue-400" />
                      : n.channel === 'Teams' ? <MessageSquareText className="size-4 text-purple-400" />
                      : <Bell className="size-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Pill variant={n.channel === 'Email' ? 'blue' : n.channel === 'Teams' ? 'purple' : 'gray'}>
                        {n.channel}
                      </Pill>
                      {n.channel !== 'InApp' && (
                        n.sent_at
                          ? <Pill variant="green">Sent</Pill>
                          : n.delivery_error
                            ? <span title={n.delivery_error} className="cursor-help"><Pill variant="red">Failed</Pill></span>
                            : <Pill variant="gray">Queued</Pill>
                      )}
                      {!n.read_at && <Pill variant="gold">New</Pill>}
                      <span className="text-[11px] text-muted-foreground ml-auto">{fmtRelative(n.created_at)}</span>
                    </div>
                    <div className="text-sm font-medium mb-1">{n.subject}</div>
                    <div className="text-sm text-muted-foreground whitespace-pre-wrap">{n.body}</div>
                    {n.deep_link && (
                      <Link
                        href={n.deep_link}
                        className="inline-flex items-center gap-1 mt-2 text-xs text-primary hover:underline"
                        onClick={e => e.stopPropagation()}
                      >
                        Open in app <ExternalLink className="size-3" />
                      </Link>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
