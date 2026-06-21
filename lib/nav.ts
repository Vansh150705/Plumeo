/** Shared navigation config — the single source of truth for both the sidebar
 *  rail and the ⌘K command palette, keyed by role. */
import {
  LayoutDashboard, Target, ClipboardCheck, Bell, Users, Settings,
  BarChart3, GitBranch, Building2, ScrollText, FileSpreadsheet, Feather,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { UserRole } from './types';

export type NavIcon = ComponentType<{ className?: string; style?: React.CSSProperties }>;

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export function navFor(role: UserRole): NavGroup[] {
  if (role === 'Employee') {
    return [
      {
        label: 'Workspace',
        items: [
          { href: '/employee',               label: 'My goals',  icon: Target },
          { href: '/employee/checkins',      label: 'Check-ins', icon: ClipboardCheck },
          { href: '/employee/notifications', label: 'Inbox',     icon: Bell },
        ],
      },
    ];
  }
  if (role === 'Manager') {
    return [
      {
        label: 'Team',
        items: [
          { href: '/manager',           label: 'Dashboard',    icon: LayoutDashboard },
          { href: '/manager/approvals', label: 'Approvals',    icon: ClipboardCheck },
          { href: '/manager/checkins',  label: 'Check-ins',    icon: Target },
          { href: '/manager/shared',    label: 'Shared goals', icon: Users },
        ],
      },
      {
        label: 'Workspace',
        items: [
          { href: '/manager/me',            label: 'My goals', icon: FileSpreadsheet },
          { href: '/manager/notifications', label: 'Inbox',    icon: Bell },
        ],
      },
    ];
  }
  // Admin
  return [
    {
      label: 'Operations',
      items: [
        { href: '/admin',             label: 'Overview',      icon: LayoutDashboard },
        { href: '/admin/cycles',      label: 'Cycles',        icon: Building2 },
        { href: '/admin/users',       label: 'Users & Entra', icon: Users },
        { href: '/admin/escalations', label: 'Escalations',   icon: GitBranch },
      ],
    },
    {
      label: 'Insights',
      items: [
        { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
        { href: '/admin/audit',     label: 'Audit log', icon: ScrollText },
        { href: '/admin/reports',   label: 'Reports',   icon: FileSpreadsheet },
      ],
    },
    {
      label: 'Workspace',
      items: [
        { href: '/admin/notifications', label: 'Inbox',    icon: Bell },
        { href: '/admin/settings',      label: 'Settings', icon: Settings },
      ],
    },
  ];
}

/** All nav destinations for a role, flattened — handy for search/palettes. */
export function navItemsFor(role: UserRole): NavItem[] {
  return navFor(role).flatMap(g => g.items);
}

export { Feather };
