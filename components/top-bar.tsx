'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bell, Search, Menu } from 'lucide-react';
import { Pill } from '@/components/ui/pill';
import { fmtRelative } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import type { AppUser, Notification } from '@/lib/types';

export function TopBar({ user, notifications: initialNotifications, onMenu }: { user: AppUser; notifications: Notification[]; onMenu?: () => void }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState(initialNotifications);
  const router = useRouter();

  async function handleNotificationClick(n: Notification) {
    setOpen(false);
    // Optimistically remove the unread indicator
    if (!n.read_at) {
      setNotifications(prev => prev.filter(x => x.id !== n.id));
      try {
        const supabase = createClient();
        await supabase
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('id', n.id);
      } catch (err) {
        console.error('Failed to mark notification read:', err);
      }
    }
    if (n.deep_link) router.push(n.deep_link);
  }

  return (
    <header className="h-14 px-6 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-30 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <button onClick={onMenu} className="-ml-2 rounded-md p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground md:hidden" aria-label="Open menu">
          <Menu className="size-4" />
        </button>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">FY 2026-27</div>
        <Pill variant="green">Active cycle</Pill>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-card text-xs text-muted-foreground w-64">
          <Search className="size-3.5" />
          <span>Search…</span>
          <span className="ml-auto font-mono text-[10px] px-1.5 py-0.5 rounded border border-border">⌘K</span>
        </div>

        <div className="relative">
          <button
            onClick={() => setOpen(v => !v)}
            className="relative p-2 rounded-md hover:bg-accent transition"
            aria-label="Notifications"
          >
            <Bell className="size-4 text-muted-foreground" />
            {notifications.length > 0 && (
              <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
            )}
          </button>

          {open && (
            <>
              <button
                className="fixed inset-0 z-40"
                aria-label="Close"
                onClick={() => setOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1.5 w-96 rounded-xl border border-border bg-card shadow-2xl z-50 overflow-hidden animate-fade-in">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <div className="text-sm font-semibold">Notifications</div>
                  <Link
                    href={user.role === 'Employee' ? '/employee/notifications' : user.role === 'Manager' ? '/manager/notifications' : '/admin/notifications'}
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setOpen(false)}
                  >
                    View all →
                  </Link>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-10 text-center text-xs text-muted-foreground">
                      You&apos;re all caught up.
                    </div>
                  ) : (
                    notifications.map(n => (
                      <button
                        key={n.id}
                        onClick={() => handleNotificationClick(n)}
                        className="block w-full text-left px-4 py-3 hover:bg-accent border-b border-border last:border-0 transition"
                      >
                        <div className="flex items-start gap-2 mb-1">
                          <Pill variant={n.channel === 'Email' ? 'blue' : n.channel === 'Teams' ? 'purple' : 'gray'}>
                            {n.channel}
                          </Pill>
                          <div className="text-xs text-muted-foreground ml-auto">{fmtRelative(n.created_at)}</div>
                        </div>
                        <div className="text-sm font-medium mb-0.5">{n.subject}</div>
                        <div className="text-xs text-muted-foreground line-clamp-2">{n.body}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}