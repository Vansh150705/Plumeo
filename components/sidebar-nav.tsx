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

export function SidebarNav({ user }: { user: AppUser }) {
  const pathname = usePathname();

  const links = navFor(user.role);

  return (
    <aside className="w-60 shrink-0 border-r border-border bg-card/50 backdrop-blur-sm flex flex-col">
      <div className="px-5 py-5 flex items-center gap-2.5">
        <div className="size-8 rounded-lg bg-primary grid place-items-center">
          <Feather className="size-[18px]" style={{ color: 'hsl(var(--gold))' }} />
        </div>
        <div>
          <div className="font-display text-[15px] font-medium tracking-tight">Plumeo</div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{user.role}</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {links.map(group => (
          <div key={group.label} className="mb-4">
            <div className="px-3 pb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">{group.label}</div>
            {group.items.map(item => {
              // Root dashboard hrefs (e.g. /manager, /admin, /employee) should
              // only match exactly — otherwise they light up on every sub-route.
              const isRoot = item.href.split('/').filter(Boolean).length === 1;
              const active = isRoot
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors',
                    active
                      ? 'bg-accent text-foreground border border-border'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground border border-transparent',
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

      <div className="px-3 py-3 border-t border-border">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <Avatar name={user.full_name} id={user.id} size={32} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium truncate">{user.full_name}</div>
            <div className="text-[10px] text-muted-foreground truncate">{user.upn}</div>
          </div>
          <form action={signOut}>
            <button type="submit" className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition" title="Sign out">
              <LogOut className="size-3.5" />
            </button>
          </form>
        </div>
      </div>
    </aside>
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