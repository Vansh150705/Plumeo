import {
  LayoutDashboard, Target, ClipboardCheck, Users, BarChart3, ScrollText, Network, CheckCircle2, UsersRound, Building2,
  ShieldCheck, CalendarRange, SlidersHorizontal, LibraryBig, Plug, Bell, Settings,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface NavItem { href: string; label: string; icon: ComponentType<{ className?: string }>; perms?: string[] }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { label: 'My work', items: [
    { href: '/app', label: 'Home', icon: LayoutDashboard },
    { href: '/app/goals', label: 'Goals', icon: Target },
    { href: '/app/alignment', label: 'Alignment', icon: Network },
    { href: '/app/checkins', label: 'Check-ins', icon: ClipboardCheck },
    { href: '/app/approvals', label: 'Approvals', icon: CheckCircle2 },
  ] },
  { label: 'Insight', items: [
    { href: '/app/team', label: 'My team', icon: UsersRound, perms: ['goals.approve', 'checkins.review', 'goals.read_reports', 'goals.read_org'] },
    { href: '/app/analytics', label: 'Analytics', icon: BarChart3 },
    { href: '/app/audit', label: 'Audit trail', icon: ScrollText, perms: ['audit.read'] },
  ] },
  { label: 'Organisation', items: [
    { href: '/app/admin/people', label: 'People', icon: Users, perms: ['users.manage', 'users.read'] },
    { href: '/app/admin/structure', label: 'Structure', icon: Building2, perms: ['structure.manage'] },
    { href: '/app/admin/roles', label: 'Roles & access', icon: ShieldCheck, perms: ['roles.manage'] },
    { href: '/app/admin/cycles', label: 'Cycles & periods', icon: CalendarRange, perms: ['cycles.manage'] },
    { href: '/app/admin/policies', label: 'Policies', icon: SlidersHorizontal, perms: ['policies.manage'] },
    { href: '/app/admin/templates', label: 'Goal library', icon: LibraryBig, perms: ['templates.manage'] },
    { href: '/app/admin/integrations', label: 'Integrations', icon: Plug, perms: ['integrations.manage'] },
  ] },
];
export const ACCOUNT_NAV: NavItem[] = [
  { href: '/app/notifications', label: 'Notifications', icon: Bell },
  { href: '/app/settings', label: 'Settings', icon: Settings },
];

export function visibleNav(perms: string[]): NavGroup[] {
  const has = (p?: string[]) => !p || p.some((x) => perms.includes(x));
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => has(i.perms)) })).filter((g) => g.items.length);
}
