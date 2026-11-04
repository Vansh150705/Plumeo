'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronRight, EyeOff } from 'lucide-react';
import { GoalStatusPill, LevelPill, RiskPill } from '@/components/status';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface Node { id: string; title: string; level: string; status: string; owner_id: string; owner_name: string; parent_goal_id: string | null; progress: number | null; risk: string; redacted?: boolean; progress_mode: string }

export function AlignmentTree({ nodes, meId }: { nodes: Node[]; meId: string }) {
  const [q, setQ] = useState(''); const [onlyMine, setOnlyMine] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const kids = useMemo(() => { const m = new Map<string, Node[]>(); for (const n of nodes) if (n.parent_goal_id && byId.has(n.parent_goal_id)) m.set(n.parent_goal_id, [...(m.get(n.parent_goal_id) ?? []), n]); return m; }, [nodes, byId]);
  const mine = useMemo(() => { // nodes on a path from one of my goals to the top
    const s = new Set<string>();
    for (const n of nodes) if (n.owner_id === meId && !n.redacted) { let c: Node | undefined = n; while (c && !s.has(c.id)) { s.add(c.id); c = c.parent_goal_id ? byId.get(c.parent_goal_id) : undefined; } }
    return s;
  }, [nodes, byId, meId]);
  const match = useMemo(() => {
    if (!q.trim()) return null;
    const s = new Set<string>(); const t = q.toLowerCase();
    for (const n of nodes) if (n.title.toLowerCase().includes(t) || n.owner_name.toLowerCase().includes(t)) { let c: Node | undefined = n; while (c && !s.has(c.id)) { s.add(c.id); c = c.parent_goal_id ? byId.get(c.parent_goal_id) : undefined; } }
    return s;
  }, [q, nodes, byId]);
  const roots = nodes.filter((n) => !n.parent_goal_id || !byId.has(n.parent_goal_id));
  const rootsAligned = roots.filter((n) => n.level === 'company' || (kids.get(n.id)?.length ?? 0) > 0 || n.redacted);
  const unaligned = roots.filter((n) => !rootsAligned.includes(n) && (!onlyMine || n.owner_id === meId));
  const visible = (n: Node) => (!match || match.has(n.id)) && (!onlyMine || mine.has(n.id));

  const Row = ({ n, depth }: { n: Node; depth: number }) => {
    const children = (kids.get(n.id) ?? []).filter(visible);
    const expanded = match ? true : open[n.id] ?? depth < 2;
    return (
      <li>
        <div className={cn('group flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5 transition-colors', n.owner_id === meId ? 'border-[hsl(var(--gold))]/50' : 'border-border')} style={{ marginLeft: Math.min(depth, 6) * 20 }}>
          <button className={cn('grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent', !children.length && 'invisible')} aria-label={expanded ? `Collapse ${n.title}` : `Expand ${n.title}`} aria-expanded={expanded} onClick={() => setOpen((o) => ({ ...o, [n.id]: !expanded }))}><ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} aria-hidden /></button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><LevelPill level={n.level} />{n.redacted ? <span className="inline-flex items-center gap-1 text-sm font-medium">{n.title}<EyeOff className="size-3 text-muted-foreground" aria-label="Shown for context only" /></span> : <Link href={`/app/goals/${n.id}`} className="truncate text-sm font-medium hover:underline">{n.title}</Link>}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{n.owner_name}</span>{n.status !== 'active' && <GoalStatusPill status={n.status} />}{n.status === 'active' && n.risk !== 'on_track' && n.risk !== 'unknown' && <RiskPill risk={n.risk} />}{children.length > 0 && <span>{children.length} aligned</span>}{n.progress_mode === 'rollup' && <span>rolls up</span>}</div>
          </div>
          <ProgressBar value={n.progress} className="hidden w-40 sm:flex" label={`Progress of ${n.title}`} />
        </div>
        {expanded && children.length > 0 && <ul className="mt-1.5 space-y-1.5">{children.map((c) => <Row key={c.id} n={c} depth={depth + 1} />)}</ul>}
      </li>
    );
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input aria-label="Filter the tree" placeholder="Find a goal or person…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" />Show only the paths my goals contribute to</label>
      </div>
      {rootsAligned.filter(visible).length === 0 && unaligned.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to show with these filters.</p> : (
        <ul className="space-y-1.5" aria-label="Goal alignment hierarchy">{rootsAligned.filter(visible).map((n) => <Row key={n.id} n={n} depth={0} />)}</ul>
      )}
      {unaligned.length > 0 && (
        <section className="mt-8" aria-label="Not yet aligned">
          <h2 className="mb-2 text-sm font-semibold">Not aligned to a broader goal yet <span className="font-normal text-muted-foreground">({unaligned.length})</span></h2>
          <ul className="space-y-1.5">{unaligned.filter((n) => !match || match.has(n.id)).map((n) => <Row key={n.id} n={n} depth={0} />)}</ul>
        </section>
      )}
    </div>
  );
}
