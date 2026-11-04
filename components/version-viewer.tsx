'use client';

import { useState } from 'react';
import { get } from '@/lib/api-client';
import { fmtDateTime } from '@/lib/utils';

const FIELDS: [string, string][] = [['title', 'Title'], ['description', 'Description'], ['expected_outcome', 'Expected outcome'], ['priority', 'Priority'], ['start_date', 'Start'], ['due_date', 'Due'], ['weight', 'Weight'], ['owner_id', 'Owner']];

/** Shows a stored version and highlights what changed compared with the previous one. */
export function VersionList({ goalId, versions }: { goalId: string; versions: any[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [data, setData] = useState<Record<number, any>>({});
  async function toggle(v: number) {
    if (open === v) return setOpen(null);
    setOpen(v);
    const need = [v, v - 1].filter((x) => x >= 1 && !data[x]);
    const rows = await Promise.all(need.map((x) => get<any>(`/goals/${goalId}/versions/${x}`).catch(() => null)));
    setData((d) => ({ ...d, ...Object.fromEntries(need.map((x, i) => [x, rows[i]])) }));
  }
  return (
    <ul className="divide-y divide-border">
      {versions.map((v) => {
        const cur = data[v.version]?.snapshot; const prev = data[v.version - 1]?.snapshot;
        return (
          <li key={v.version} className="py-3">
            <button className="flex w-full items-center justify-between gap-3 text-left" onClick={() => toggle(v.version)} aria-expanded={open === v.version}>
              <span className="text-sm"><span className="font-medium">Version {v.version}</span> · {v.change_summary}</span>
              <span className="text-xs text-muted-foreground">{v.changed_by_name} · {fmtDateTime(v.created_at)}</span>
            </button>
            {v.change_reason && <p className="mt-1 text-xs text-muted-foreground">Reason: {v.change_reason}</p>}
            {open === v.version && cur && (
              <div className="mt-3 space-y-1.5 rounded-lg bg-muted/50 p-3 text-xs">
                {FIELDS.map(([k, label]) => {
                  const a = cur.goal?.[k], b = prev?.goal?.[k]; const changed = prev && String(a ?? '') !== String(b ?? '');
                  if (a == null && !changed) return null;
                  return <div key={k} className={changed ? 'text-foreground' : 'text-muted-foreground'}><span className="font-medium">{label}:</span> {changed && <><del className="opacity-60">{String(b ?? '—')}</del> → </>}{String(a ?? '—')}</div>;
                })}
                {cur.keyResults?.map((k: any) => {
                  const old = prev?.keyResults?.find((x: any) => x.id === k.id); const changed = prev && (!old || Number(old.target_value) !== Number(k.target_value) || Number(old.start_value) !== Number(k.start_value));
                  return <div key={k.id} className={changed ? 'text-foreground' : 'text-muted-foreground'}><span className="font-medium">KR:</span> {k.title} — {changed && old && <><del className="opacity-60">{old.start_value}→{old.target_value}</del> → </>}{k.start_value}→{k.target_value}{changed && !old ? ' (new)' : ''}</div>;
                })}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
