'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Bell, Feather, LogOut, Menu, Search, Settings, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { ThemeToggle } from '@/components/theme-toggle';
import { CommandPalette } from '@/components/command-palette';
import { ACCOUNT_NAV, visibleNav } from '@/lib/nav';
import { post } from '@/lib/api-client';

interface Props { user: { id: string; name: string; roles: string[] }; orgName: string; perms: string[]; unread: number; approvals: number; children: React.ReactNode }

export function AppShell({ user, orgName, perms, unread, approvals, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const nav = useMemo(() => visibleNav(perms), [perms]);

  useEffect(() => { setDrawer(false); setMenu(false); }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((o) => !o); } if (e.key === 'Escape') { setMenu(false); setDrawer(false); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function signOut() { try { await post('/auth/logout'); } finally { router.push('/login'); router.refresh(); } }

  const isActive = (href: string) => (href === '/app' ? pathname === '/app' : pathname === href || pathname.startsWith(href + '/'));
  const badge = (href: string) => (href === '/app/approvals' && approvals > 0 ? approvals : 0);

  const Nav = (
    <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
      {nav.map((g) => (
        <div key={g.label}>
          <div className="px-3 pb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{g.label}</div>
          <ul className="space-y-0.5">
            {g.items.map((i) => (
              <li key={i.href}>
                <Link href={i.href} aria-current={isActive(i.href) ? 'page' : undefined}
                  className={cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors', isActive(i.href) ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')}>
                  <i.icon className={cn('size-4 shrink-0', isActive(i.href) && 'text-[hsl(var(--gold))]')} aria-hidden />
                  <span className="flex-1">{i.label}</span>
                  {badge(i.href) > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground" aria-label={`${badge(i.href)} waiting`}>{badge(i.href)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
  const Brand = (
    <Link href="/app" className="flex items-center gap-2.5 px-5 py-5">
      <span className="grid size-8 place-items-center rounded-lg bg-primary"><Feather className="size-[18px] text-[hsl(var(--gold))]" aria-hidden /></span>
      <span className="min-w-0"><span className="block text-[15px] font-semibold leading-tight tracking-tight">Plumeo</span><span className="block truncate text-[11px] text-muted-foreground">{orgName}</span></span>
    </Link>
  );

  return (
    <div className="md:flex md:min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-card/60 md:flex">{Brand}{Nav}</aside>

      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-foreground/30" aria-label="Close navigation" onClick={() => setDrawer(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col border-r border-border bg-card shadow-2xl">
            <button className="absolute right-3 top-3 rounded-md p-2 text-muted-foreground hover:bg-accent" aria-label="Close" onClick={() => setDrawer(false)}><X className="size-4" /></button>
            {Brand}{Nav}
          </aside>
        </div>
      )}

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <button className="-ml-2 rounded-md p-2 text-muted-foreground hover:bg-accent md:hidden" aria-label="Open navigation" onClick={() => setDrawer(true)}><Menu className="size-4" /></button>
            <button onClick={() => setPalette(true)} className="flex w-44 items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 sm:w-72" aria-label="Search and jump to">
              <Search className="size-3.5" aria-hidden /><span>Search goals, people, pages…</span><kbd className="ml-auto hidden rounded border border-border px-1.5 font-mono text-[10px] sm:block">⌘K</kbd>
            </button>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Link href="/app/notifications" className="relative rounded-md p-2 hover:bg-accent" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
              <Bell className="size-4 text-muted-foreground" aria-hidden />
              {unread > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-4 text-primary-foreground">{unread > 99 ? '99+' : unread}</span>}
            </Link>
            <div className="relative">
              <button onClick={() => setMenu((o) => !o)} className="ml-1 rounded-full" aria-haspopup="menu" aria-expanded={menu} aria-label="Account menu"><Avatar name={user.name} id={user.id} size={32} /></button>
              {menu && (
                <>
                  <button className="fixed inset-0 z-40 cursor-default" aria-label="Close menu" onClick={() => setMenu(false)} />
                  <div role="menu" className="absolute right-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
                    <div className="border-b border-border px-4 py-3"><div className="truncate text-sm font-medium">{user.name}</div><div className="truncate text-xs text-muted-foreground">{user.roles.map((r) => r.replace('_', ' ')).join(', ')}</div></div>
                    {ACCOUNT_NAV.map((i) => <Link key={i.href} role="menuitem" href={i.href} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"><i.icon className="size-4" aria-hidden />{i.label}</Link>)}
                    <button role="menuitem" onClick={signOut} className="flex w-full items-center gap-2.5 border-t border-border px-4 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"><LogOut className="size-4" aria-hidden />Sign out</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} nav={nav.flatMap((g) => g.items).concat(ACCOUNT_NAV)} />
    </div>
  );
}
export { Settings };
