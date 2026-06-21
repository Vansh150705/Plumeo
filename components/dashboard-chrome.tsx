'use client';

import { useEffect, useState } from 'react';
import { SidebarNav } from '@/components/sidebar-nav';
import { TopBar } from '@/components/top-bar';
import { CommandPalette } from '@/components/command-palette';
import type { AppUser, Notification } from '@/lib/types';

// holds the mobile-drawer open state and stitches the sidebar + top bar together.
// the sidebar is a fixed rail on desktop and a slide-in drawer on phones.
export function DashboardChrome({
  user, notifications, children,
}: {
  user: AppUser;
  notifications: Notification[];
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

  // Global ⌘K / Ctrl-K opens the command palette from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen(o => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="md:flex md:min-h-screen">
      <SidebarNav user={user} mobileOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <TopBar
          user={user}
          notifications={notifications}
          onMenu={() => setNavOpen(true)}
          onSearch={() => setCmdOpen(true)}
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
      <CommandPalette user={user} open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}
