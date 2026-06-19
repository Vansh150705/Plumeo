'use client';

import { useState } from 'react';
import { SidebarNav } from '@/components/sidebar-nav';
import { TopBar } from '@/components/top-bar';
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
  return (
    <div className="md:flex md:min-h-screen">
      <SidebarNav user={user} mobileOpen={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <TopBar user={user} notifications={notifications} onMenu={() => setNavOpen(true)} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
