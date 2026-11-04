'use client';

import { useState } from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { get } from '@/lib/api-client';

export function AuditVerify() {
  const [state, setState] = useState<null | { intact: boolean; eventsChecked: number; firstBrokenSeq: number | null }>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function verify() { setBusy(true); setErr(null); try { setState(await get('/audit/verify')); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }
  return (
    <div className="flex flex-wrap items-center gap-3" aria-live="polite">
      <Button variant="outline" onClick={verify} disabled={busy}><ShieldCheck className="size-4" aria-hidden />{busy ? 'Verifying…' : 'Verify integrity'}</Button>
      {state && (state.intact
        ? <span className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--success))]"><ShieldCheck className="size-4" aria-hidden />Hash chain intact · {state.eventsChecked.toLocaleString()} events verified</span>
        : <span className="inline-flex items-center gap-1.5 text-sm text-destructive"><ShieldAlert className="size-4" aria-hidden />Chain broken at event #{state.firstBrokenSeq}. Investigate immediately.</span>)}
      {err && <span className="text-sm text-destructive">{err}</span>}
    </div>
  );
}
