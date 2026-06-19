'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import {
  LayoutDashboard, Target, ClipboardCheck, Bell, Users, Settings,
  BarChart3, GitBranch, Building2, ScrollText, FileSpreadsheet, LogOut, Feather,
} from 'lucide-react';
import type { AppUser } from '@/lib/types';
import { signOut } from '@/lib/auth';

export function SidebarNav({ user, mobileOpen = false, onClose }: {
  user: AppUser;
  mobileOpen?: boolean;
  onClose?: () => void;
}) {
  return (
    <>
      {/* desktop: a fixed rail */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card/50 backdrop-blur-sm md:flex">
        <NavBody user={user} />
      </aside>

      {/* mobile: a slide-in drawer over a dimmed backdrop */}
      <div className={cn('fixed inset-0 z-50 md:hidden', mobileOpen ? '' : 'pointer-events-none')}>
        <div
          className={cn('absolute inset-0 bg-foreground/30 backdrop-blur-sm transition-opacity', mobileOpen ? 'opacity-100' : 'opacity-0')}
          onClick={onClose}
        />
        <aside className={cn(
          'absolute left-0 top-0 flex h-full w-64 flex-col border-r border-border bg-card shadow-2xl transition-transform duration-300',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}>
          <NavBody user={user} onNavigate={onClose} />
        </aside>
      </div>
    </>
  );
}

// the actual contents, shared between the desktop rail and the mobile drawer.
function NavBody({ user, onNavigate }: { user: AppUser; onNavigate?: () => void }) {
  const pathname = usePathname();
  const links = navFor(user.role);

  return (
    <>
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="grid size-8 place-items-center rounded-lg bg-primary">
          <Feather className="size-[18px]" style={{ color: 'hsl(var(--gold))' }} />
        </div>
        <div>
          <div className="font-display text-[15px] font-medium tracking-tight">Plumeo</div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{user.role}</div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {links.map(group => (
          <div key={group.label} className="mb-4">
            <div className="px-3 pb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">{group.label}</div>
            {group.items.map(item => {
              // root hrefs like /manager or /admin should only highlight on an exact
              // match, otherwise they'd light up on every sub-page underneath them.
              const isRoot = item.href.split('/').filter(Boolean).length === 1;
              const active = isRoot
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                    active
                      ? 'border border-border bg-accent text-foreground'
                      : 'border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <item.icon className={cn('size-4', active && 'text-primary')} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-border px-3 py-3">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <Avatar name={user.full_name} id={user.id} size={32} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{user.full_name}</div>
            <div className="truncate text-[10px] text-muted-foreground">{user.upn}</div>
          </div>
          <form action={signOut}>
            <button type="submit" className="rounded p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground" title="Sign out">
              <LogOut className="size-3.5" />
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

function navFor(role: AppUser['role']) {
  if (role === 'Employee') {
    return [
      {
        label: 'Workspace',
        items: [
          { href: '/employee',            label: 'My goals',       icon: Target },
          { href: '/employee/checkins',   label: 'Check-ins',      icon: ClipboardCheck },
          { href: '/employee/notifications', label: 'Inbox',       icon: Bell },
        ],
      },
    ];
  }
  if (role === 'Manager') {
    return [
      {
        label: 'Team',
        items: [
          { href: '/manager',                 label: 'Dashboard',    icon: LayoutDashboard },
          { href: '/manager/approvals',       label: 'Approvals',    icon: ClipboardCheck },
          { href: '/manager/checkins',        label: 'Check-ins',    icon: Target },
          { href: '/manager/shared',          label: 'Shared goals', icon: Users },
        ],
      },
      {
        label: 'Workspace',
        items: [
          { href: '/manager/me',              label: 'My goals',      icon: FileSpreadsheet },
          { href: '/manager/notifications',   label: 'Inbox',         icon: Bell },
        ],
      },
    ];
  }
  // Admin
  return [
    {
      label: 'Operations',
      items: [
        { href: '/admin',               label: 'Overview',        icon: LayoutDashboard },
        { href: '/admin/cycles',        label: 'Cycles',          icon: Building2 },
        { href: '/admin/users',         label: 'Users & Entra',   icon: Users },
        { href: '/admin/escalations',   label: 'Escalations',     icon: GitBranch },
      ],
    },
    {
      label: 'Insights',
      items: [
        { href: '/admin/analytics',     label: 'Analytics',       icon: BarChart3 },
        { href: '/admin/audit',         label: 'Audit log',       icon: ScrollText },
        { href: '/admin/reports',       label: 'Reports',         icon: FileSpreadsheet },
      ],
    },
    {
      label: 'Workspace',
      items: [
        { href: '/admin/notifications', label: 'Inbox',           icon: Bell },
        { href: '/admin/settings',      label: 'Settings',        icon: Settings },
      ],
    },
  ];
}