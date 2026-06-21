'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Search, CornerDownLeft } from 'lucide-react';
import { navItemsFor, type NavItem } from '@/lib/nav';
import { cn } from '@/lib/utils';
import type { AppUser } from '@/lib/types';

/** Global ⌘K / Ctrl-K palette to jump to any page for the current role.
 *  Open state is owned by the parent (DashboardChrome) so the top-bar search
 *  field can trigger it too. */
export function CommandPalette({
  user, open, onOpenChange,
}: {
  user: AppUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const items = useMemo(() => navItemsFor(user.role), [user.role]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(i => i.label.toLowerCase().includes(q) || i.href.toLowerCase().includes(q));
  }, [items, query]);

  // Reset the query + selection each time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  // Keep the active index in range as results narrow.
  useEffect(() => {
    setActive(a => Math.min(a, Math.max(0, results.length - 1)));
  }, [results.length]);

  function go(item: NavItem) {
    onOpenChange(false);
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(a => (results.length ? (a + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => (results.length ? (a - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = results[active];
      if (item) go(item);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          onKeyDown={onKeyDown}
          aria-label="Command palette"
          className="fixed left-1/2 top-[18%] z-50 w-[92vw] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-2xl data-[state=open]:animate-fade-in"
        >
          <DialogPrimitive.Title className="sr-only">Search and navigate</DialogPrimitive.Title>
          <div className="flex items-center gap-2.5 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search pages…"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">esc</kbd>
          </div>

          <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
            {results.length === 0 ? (
              <div className="px-3 py-10 text-center text-xs text-muted-foreground">
                No matches for “{query}”.
              </div>
            ) : (
              results.map((item, i) => {
                const Icon = item.icon;
                const selected = i === active;
                return (
                  <button
                    key={item.href}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(item)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                      selected ? 'bg-accent text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    <Icon className={cn('size-4 shrink-0', selected && 'text-primary')} />
                    <span className="flex-1 truncate text-foreground">{item.label}</span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">{item.href}</span>
                    {selected && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
                  </button>
                );
              })
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
