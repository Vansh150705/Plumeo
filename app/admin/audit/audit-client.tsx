'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { Input } from '@/components/ui/input';
import { ScrollText, Search, ChevronRight } from 'lucide-react';
import { fmtDateTime, cn } from '@/lib/utils';
import type { AuditEntry } from '@/lib/types';

export function AuditClient({ entries }: { entries: AuditEntry[] }) {
  const [filter, setFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    return entries.filter(e => {
      if (entityFilter !== 'all' && e.entity_type !== entityFilter) return false;
      if (filter) {
        const q = filter.toLowerCase();
        return (
          e.action.toLowerCase().includes(q)
          || e.actor_name?.toLowerCase().includes(q)
          || e.entity_id.includes(q)
          || e.reason?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [entries, filter, entityFilter]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <div>
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
          Compliance
        </div>
        <h1 className="font-serif text-4xl tracking-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Immutable record of every lifecycle change: who edited what, when, with before-and-after snapshots.
          Every action after sheet lock is captured here for compliance.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter by action, actor, ID, reason…"
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-border p-1 bg-card">
          {['all', 'sheet', 'goal', 'check_in'].map(t => (
            <button
              key={t}
              onClick={() => setEntityFilter(t)}
              className={cn(
                'px-3 py-1.5 text-xs rounded transition',
                entityFilter === t ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t === 'all' ? 'All' : t}
            </button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground ml-auto">
          {filtered.length} of {entries.length}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {filtered.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                <ScrollText className="size-8 mx-auto mb-2 opacity-30" />
                No audit entries match your filters.
              </div>
            ) : (
              filtered.map(e => (
                <div key={e.id}>
                  <button
                    onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                    className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-accent/50 transition"
                  >
                    <ChevronRight className={cn('size-3.5 text-muted-foreground transition-transform', expandedId === e.id && 'rotate-90')} />
                    <Pill variant="gray" className="font-mono text-[10px]">{e.entity_type}</Pill>
                    <Pill variant={
                      e.action === 'create' ? 'green'
                      : e.action === 'delete' ? 'red'
                      : e.action === 'approve' ? 'green'
                      : e.action === 'return' ? 'orange'
                      : e.action === 'unlock' ? 'red'
                      : 'blue'
                    }>{e.action}</Pill>
                    <div className="flex-1 min-w-0 text-sm">
                      <span className="text-foreground font-medium">{e.actor_name}</span>
                      {e.reason && <span className="text-muted-foreground"> · {e.reason}</span>}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground truncate max-w-[140px]" title={e.entity_id}>
                      {e.entity_id.slice(0, 8)}
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {fmtDateTime(e.occurred_at)}
                    </div>
                  </button>
                  {expandedId === e.id && (
                    <div className="px-5 pb-4 pt-1 grid md:grid-cols-2 gap-3 bg-background/30">
                      <DiffPanel label="Before" data={e.before_data} />
                      <DiffPanel label="After" data={e.after_data} />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DiffPanel({ label, data }: { label: string; data: any }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">{label}</div>
      <pre className="text-[11px] font-mono p-3 rounded-md bg-card border border-border max-h-60 overflow-auto">
        {data == null ? <span className="text-muted-foreground italic">empty</span> : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
