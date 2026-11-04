'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Search, Target } from 'lucide-react';
import { get } from '@/lib/api-client';
import type { NavItem } from '@/lib/nav';

/** ⌘K: jump to any page you can access, or search goals you are allowed to see (server-side, permission-aware). */
export function CommandPalette({ open, onOpenChange, nav }: { open: boolean; onOpenChange: (o: boolean) => void; nav: NavItem[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [goals, setGoals] = useState<{ id: string; title: string; owner_name: string }[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(''); setGoals([]); setActive(0); setTimeout(() => input.current?.focus(), 30); } }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) { setGoals([]); return; }
    const t = setTimeout(() => { get<any>(`/goals?q=${encodeURIComponent(q.trim())}&limit=6`).then((r) => setGoals(Array.isArray(r) ? r : [])).catch(() => setGoals([])); }, 180);
    return () => clearTimeout(t);
  }, [q]);
  const pages = nav.filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase()));
  const items = [...pages.map((p) => ({ key: p.href, label: p.label, href: p.href, kind: 'page' as const })), ...goals.map((g) => ({ key: g.id, label: g.title, href: `/app/goals/${g.id}`, kind: 'goal' as const, sub: g.owner_name }))];
  const go = (href: string) => { onOpenChange(false); router.push(href); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] max-w-xl translate-y-0 gap-0 p-0" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-4"><Search className="size-4 text-muted-foreground" aria-hidden />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} placeholder="Jump to a page or search goals…" aria-label="Search"
            onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); } if (e.key === 'Enter' && items[active]) go(items[active].href); }}
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" /></div>
        <ul className="max-h-80 overflow-y-auto p-2" role="listbox">
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing found.</li>}
          {items.map((it, i) => (
            <li key={it.key} role="option" aria-selected={i === active}>
              <button onMouseEnter={() => setActive(i)} onClick={() => go(it.href)} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${i === active ? 'bg-accent' : ''}`}>
                {it.kind === 'goal' ? <Target className="size-4 text-[hsl(var(--gold))]" aria-hidden /> : <span className="size-4" />}
                <span className="flex-1 truncate">{it.label}</span>{'sub' in it && <span className="text-xs text-muted-foreground">{it.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
