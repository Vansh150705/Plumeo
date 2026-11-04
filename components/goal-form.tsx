'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, get, post, patch, ApiError } from '@/lib/api-client';

type Kr = { id?: string; title: string; metricType: string; startValue: string; targetValue: string; unit: string; weight: string };
interface Props {
  mode: 'create' | 'edit';
  cycles: { id: string; name: string; status: string }[];
  departments: { id: string; name: string }[];
  teams: { id: string; name: string; department_id: string }[];
  templates: { id: string; name: string; level: string; content: any }[];
  allowedLevels: string[];
  aiEnabled: boolean;
  me: { id: string; departmentId?: string | null; teamId?: string | null };
  initial?: any;
  defaultCycleId?: string;
  defaultParentId?: string;
}

const LEVELS: Record<string, string> = { individual: 'Individual goal', team: 'Team goal', department: 'Department goal', company: 'Company goal' };
const PARENT_LEVELS: Record<string, string[]> = { individual: ['team', 'department', 'company'], team: ['team', 'department', 'company'], department: ['department', 'company'], company: [] };
const emptyKr = (): Kr => ({ title: '', metricType: 'number', startValue: '0', targetValue: '', unit: '', weight: '1' });

export function GoalForm(p: Props) {
  const router = useRouter();
  const g = p.initial?.goal;
  const [f, setF] = useState({
    cycleId: g?.cycle_id ?? p.defaultCycleId ?? p.cycles.find((c) => c.status === 'active')?.id ?? p.cycles[0]?.id ?? '',
    level: g?.level ?? 'individual', title: g?.title ?? '', description: g?.description ?? '', expectedOutcome: g?.expected_outcome ?? '', context: g?.context ?? '',
    priority: g?.priority ?? 'medium', startDate: g?.start_date ?? '', dueDate: g?.due_date ?? '', departmentId: g?.department_id ?? '', teamId: g?.team_id ?? '',
    parentGoalId: g?.parent_goal_id ?? p.defaultParentId ?? '', weight: String(g?.weight ?? 1), progressMode: g?.progress_mode ?? 'own', templateId: '',
  });
  const [krs, setKrs] = useState<Kr[]>(p.initial?.keyResults?.map((k: any) => ({ id: k.id, title: k.title, metricType: k.metric_type, startValue: String(k.start_value), targetValue: String(k.target_value), unit: k.unit ?? '', weight: String(k.weight) })) ?? [emptyKr()]);
  const [collab, setCollab] = useState<{ userId: string; name: string }[]>(p.initial?.collaborators?.map((c: any) => ({ userId: c.user_id, name: c.full_name })) ?? []);
  const [parents, setParents] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]); const [personQ, setPersonQ] = useState('');
  const [lint, setLint] = useState<{ score: number; findings: { level: string; message: string }[] } | null>(null);
  const [busy, setBusy] = useState<null | 'draft' | 'submit'>(null);
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const issue = (field: string) => issues.find((i) => i.field === field)?.message ?? null;

  // candidate parents: active goals of compatible levels in the same cycle
  useEffect(() => {
    const levels = PARENT_LEVELS[f.level] ?? [];
    if (!levels.length || !f.cycleId) { setParents([]); return; }
    get<any[]>(`/goals?status=active&cycleId=${f.cycleId}&level=${levels.join(',')}&limit=200&sort=title&order=asc`).then((r) => setParents(Array.isArray(r) ? r.filter((x) => x.id !== g?.id) : [])).catch(() => setParents([]));
  }, [f.level, f.cycleId, g?.id]);
  useEffect(() => {
    if (personQ.trim().length < 2) { setPeople([]); return; }
    const t = setTimeout(() => get<any>(`/users?q=${encodeURIComponent(personQ)}&limit=8`).then((r) => setPeople(Array.isArray(r) ? r : [])).catch(() => setPeople([])), 200);
    return () => clearTimeout(t);
  }, [personQ]);
  // live measurability hints (deterministic, not AI)
  useEffect(() => {
    const t = setTimeout(() => post<any>('/goals/lint', { title: f.title || ' ', description: f.description, expectedOutcome: f.expectedOutcome, keyResults: krs.filter((k) => k.title.trim()).map((k) => ({ title: k.title })) }).then(setLint).catch(() => setLint(null)), 400);
    return () => clearTimeout(t);
  }, [f.title, f.description, f.expectedOutcome, krs]);

  const teamsHere = useMemo(() => p.teams.filter((t) => !f.departmentId || t.department_id === f.departmentId), [p.teams, f.departmentId]);
  const canAlign = (PARENT_LEVELS[f.level] ?? []).length > 0;

  function applyTemplate(id: string) {
    set('templateId', id);
    const t = p.templates.find((x) => x.id === id); if (!t) return;
    const c = t.content ?? {};
    setF((s) => ({ ...s, templateId: id, level: t.level, title: c.title ?? s.title, description: c.description ?? s.description, expectedOutcome: c.expectedOutcome ?? s.expectedOutcome, priority: c.priority ?? s.priority }));
    if (c.keyResults?.length) setKrs(c.keyResults.map((k: any) => ({ title: k.title, metricType: k.metricType ?? 'number', startValue: String(k.startValue ?? 0), targetValue: String(k.targetValue ?? ''), unit: k.unit ?? '', weight: String(k.weight ?? 1) })));
  }

  async function refineWithAi() {
    try {
      const r = await post<any>('/ai/refine', { title: f.title, description: f.description, goalId: g?.id });
      set('title', r.suggestion.title || f.title); set('description', r.suggestion.description || f.description);
      if (r.suggestion.keyResults?.length && krs.every((k) => !k.title.trim())) setKrs(r.suggestion.keyResults.map((k: any) => ({ title: String(k.title ?? ''), metricType: k.metricType ?? 'number', startValue: String(k.startValue ?? 0), targetValue: String(k.targetValue ?? ''), unit: '', weight: '1' })));
      toast.message('AI suggestion applied — review and edit it before saving.');
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'AI assistance is unavailable.'); }
  }

  function payload() {
    const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
    const base: any = {
      title: f.title.trim(), description: f.description.trim() || null, expectedOutcome: f.expectedOutcome.trim() || null, context: f.context.trim() || null,
      priority: f.priority, startDate: f.startDate || null, dueDate: f.dueDate || null, parentGoalId: f.parentGoalId || null,
      weight: Number(f.weight) || 1, progressMode: f.progressMode,
      departmentId: f.level === 'department' || f.level === 'team' ? f.departmentId || null : undefined, teamId: f.level === 'team' ? f.teamId || null : undefined,
      collaborators: collab.map((c) => ({ userId: c.userId, role: 'contributor' })),
      keyResults: krs.filter((k) => k.title.trim()).map((k) => ({ ...(k.id ? { id: k.id } : {}), title: k.title.trim(), metricType: k.metricType, startValue: k.metricType === 'boolean' ? 0 : num(k.startValue), targetValue: k.metricType === 'boolean' ? 1 : num(k.targetValue), unit: k.unit.trim() || null, weight: Number(k.weight) || 1 })),
    };
    if (base.keyResults.some((k: any) => Number.isNaN(k.startValue) || Number.isNaN(k.targetValue))) throw new ApiError('Every key result needs numeric start and target values.', 422, 'validation_failed');
    return base;
  }

  async function save(andSubmit: boolean) {
    setBusy(andSubmit ? 'submit' : 'draft'); setError(null); setIssues([]);
    try {
      const body = payload();
      let id: string = g?.id; let version: number = g?.version;
      if (p.mode === 'create') {
        const r = await post<{ id: string; version: number }>('/goals', { cycleId: f.cycleId, level: f.level, ...(f.templateId ? { templateId: f.templateId } : {}), ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) }, { 'idempotency-key': crypto.randomUUID() });
        id = r.id; version = r.version;
      } else {
        const r = await patch<{ version: number }>(`/goals/${id}`, { expectedVersion: version, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) });
        version = r.version;
      }
      if (andSubmit) {
        try { await post(`/goals/${id}/submit`, { expectedVersion: version }); toast.success('Submitted for approval.'); }
        catch (e) {
          if (e instanceof ApiError && Array.isArray(e.details)) { setIssues(e.details); setError('Your draft was saved, but it is not ready to submit yet:'); toast.message('Draft saved'); router.replace(`/app/goals/${id}/edit`); setBusy(null); return; }
          throw e;
        }
      } else toast.success('Draft saved.');
      router.push(`/app/goals/${id}`); router.refresh();
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.details)) setIssues(e.details.map((d: any) => ({ field: d.path ?? d.field, message: d.message })));
      setError(e instanceof ApiError ? e.message : 'Could not save the goal.'); setBusy(null);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }} className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {error && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}{issues.length > 0 && <ul className="mt-1.5 list-disc pl-5">{issues.map((i, n) => <li key={n}>{i.message}</li>)}</ul>}
          </div>
        )}
        {p.mode === 'create' && p.templates.length > 0 && (
          <Card><CardContent className="flex flex-wrap items-center gap-3 p-4">
            <span className="text-sm font-medium">Start from the goal library</span>
            <Select value={f.templateId} onChange={(e) => applyTemplate(e.target.value)} className="max-w-xs" aria-label="Goal template"><option value="">Blank goal</option>{p.templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.level})</option>)}</Select>
          </CardContent></Card>
        )}
        <Card>
          <CardHeader className="pb-3"><CardTitle>What do you want to achieve?</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Level" htmlFor="level"><Select id="level" value={f.level} disabled={p.mode === 'edit'} onChange={(e) => { set('level', e.target.value); set('parentGoalId', ''); }}>{p.allowedLevels.map((l) => <option key={l} value={l}>{LEVELS[l]}</option>)}</Select></Field>
              <Field label="Cycle" htmlFor="cycle"><Select id="cycle" value={f.cycleId} disabled={p.mode === 'edit'} onChange={(e) => set('cycleId', e.target.value)}>{p.cycles.filter((c) => c.status !== 'closed').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            </div>
            <Field label="Title" htmlFor="title" error={issue('title')} hint="A short, specific objective — what will be different?">
              <div className="flex gap-2"><Input id="title" value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={200} required />
                {p.aiEnabled && <Button type="button" variant="outline" onClick={refineWithAi} title="Suggest a clearer, measurable wording (AI, editable)"><Sparkles className="size-4" aria-hidden /><span className="sr-only sm:not-sr-only">Refine</span></Button>}</div>
            </Field>
            <Field label="Description" htmlFor="desc" error={issue('description')} hint="What you will do, and why it matters."><Textarea id="desc" rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={5000} /></Field>
            <Field label="Expected outcome" htmlFor="outcome" error={issue('expected_outcome')} hint="How will you know it worked?"><Textarea id="outcome" rows={2} value={f.expectedOutcome} onChange={(e) => set('expectedOutcome', e.target.value)} maxLength={2000} /></Field>
            <Field label="Supporting context (optional)" htmlFor="context"><Textarea id="context" rows={2} value={f.context} onChange={(e) => set('context', e.target.value)} maxLength={5000} /></Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3"><CardTitle>Key results</CardTitle><Button type="button" variant="ghost" size="sm" onClick={() => setKrs((k) => [...k, emptyKr()])}><Plus className="size-4" aria-hidden />Add</Button></CardHeader>
          <CardContent className="space-y-3">
            {issue('key_results') && <p role="alert" className="text-xs text-destructive">{issue('key_results')}</p>}
            {krs.map((k, i) => (
              <fieldset key={k.id ?? i} className="space-y-3 rounded-lg border border-border p-3">
                <legend className="sr-only">Key result {i + 1}</legend>
                <div className="flex gap-2"><Input aria-label={`Key result ${i + 1} title`} placeholder="e.g. Qualified enterprise accounts" value={k.title} onChange={(e) => setKrs((a) => a.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove key result ${i + 1}`} onClick={() => setKrs((a) => (a.length > 1 ? a.filter((_, j) => j !== i) : [emptyKr()]))}><Trash2 className="size-4" aria-hidden /></Button></div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <Select aria-label="Type" value={k.metricType} onChange={(e) => setKrs((a) => a.map((x, j) => (j === i ? { ...x, metricType: e.target.value } : x)))}><option value="number">Number</option><option value="percent">Percent</option><option value="currency">Currency</option><option value="boolean">Yes / no</option></Select>
                  {k.metricType !== 'boolean' ? (<>
                    <Input aria-label="Start value" type="number" step="any" placeholder="Start" value={k.startValue} onChange={(e) => setKrs((a) => a.map((x, j) => (j === i ? { ...x, startValue: e.target.value } : x)))} />
                    <Input aria-label="Target value" type="number" step="any" placeholder="Target" value={k.targetValue} onChange={(e) => setKrs((a) => a.map((x, j) => (j === i ? { ...x, targetValue: e.target.value } : x)))} />
                    <Input aria-label="Unit" placeholder="Unit (optional)" value={k.unit} maxLength={20} onChange={(e) => setKrs((a) => a.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} />
                  </>) : <p className="col-span-3 self-center text-xs text-muted-foreground">Done or not done.</p>}
                  <Input aria-label="Weight" type="number" step="any" min="0.1" placeholder="Weight" value={k.weight} onChange={(e) => setKrs((a) => a.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))} />
                </div>
                {k.metricType !== 'boolean' && k.startValue !== '' && k.targetValue !== '' && <p className="text-xs text-muted-foreground">{Number(k.targetValue) < Number(k.startValue) ? 'Lower is better' : 'Higher is better'}: from {k.startValue} to {k.targetValue}{k.unit ? ` ${k.unit}` : ''}.</p>}
              </fieldset>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-3"><CardTitle>Schedule &amp; priority</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start" htmlFor="start" error={issue('start_date')}><Input id="start" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
              <Field label="Due" htmlFor="due" error={issue('due_date')}><Input id="due" type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></Field>
            </div>
            <Field label="Priority" htmlFor="prio"><Select id="prio" value={f.priority} onChange={(e) => set('priority', e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></Select></Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle>Alignment</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {(f.level === 'department' || f.level === 'team') && (
              <Field label="Department" htmlFor="dept" error={issue('department_id')}><Select id="dept" value={f.departmentId} onChange={(e) => { set('departmentId', e.target.value); set('teamId', ''); }}><option value="">Choose…</option>{p.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
            )}
            {f.level === 'team' && <Field label="Team" htmlFor="team" error={issue('team_id')}><Select id="team" value={f.teamId} onChange={(e) => set('teamId', e.target.value)}><option value="">Choose…</option>{teamsHere.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>}
            {canAlign ? (
              <Field label="Contributes to" htmlFor="parent" hint="Link this goal to the broader goal it supports.">
                <Select id="parent" value={f.parentGoalId} onChange={(e) => set('parentGoalId', e.target.value)}><option value="">Not aligned yet</option>{parents.map((x) => <option key={x.id} value={x.id}>{x.level === 'company' ? '🏢' : x.level === 'department' ? '🏛' : '👥'} {x.title}</option>)}</Select>
              </Field>
            ) : <p className="text-xs text-muted-foreground">Company goals sit at the top of the hierarchy.</p>}
            {(f.level !== 'individual') && (
              <Field label="Progress is" htmlFor="mode" hint="Roll-up goals take their progress from the approved goals aligned to them.">
                <Select id="mode" value={f.progressMode} onChange={(e) => set('progressMode', e.target.value as 'own' | 'rollup')}><option value="own">Measured by its own key results</option><option value="rollup">Rolled up from aligned goals</option></Select>
              </Field>
            )}
            {f.parentGoalId && <Field label="Weight among siblings" htmlFor="weight" hint="Used when the parent rolls up its children."><Input id="weight" type="number" step="any" min="0.1" value={f.weight} onChange={(e) => set('weight', e.target.value)} /></Field>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle>Collaborators</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-1.5">{collab.map((c) => <span key={c.userId} className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs">{c.name}<button type="button" aria-label={`Remove ${c.name}`} onClick={() => setCollab((a) => a.filter((x) => x.userId !== c.userId))}><X className="size-3" aria-hidden /></button></span>)}</div>
            <Input aria-label="Add a collaborator" placeholder="Search people to add…" value={personQ} onChange={(e) => setPersonQ(e.target.value)} />
            {people.length > 0 && <ul className="rounded-lg border border-border">{people.filter((x) => x.id !== p.me.id && !collab.some((c) => c.userId === x.id)).map((x) => <li key={x.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { setCollab((a) => [...a, { userId: x.id, name: x.full_name }]); setPersonQ(''); setPeople([]); }}>{x.full_name}<span className="ml-2 text-xs text-muted-foreground">{x.job_title}</span></button></li>)}</ul>}
          </CardContent>
        </Card>
        {lint && (
          <Card aria-live="polite">
            <CardHeader className="pb-3"><CardTitle className="flex items-center justify-between">Measurability check<span className="text-sm font-normal text-muted-foreground">{lint.score}/100</span></CardTitle></CardHeader>
            <CardContent>{lint.findings.length === 0 ? <p className="text-sm text-[hsl(var(--success))]">Looks specific and measurable.</p> : <ul className="space-y-2 text-sm">{lint.findings.map((x, i) => <li key={i} className={x.level === 'warn' ? 'text-[hsl(var(--warning))]' : 'text-muted-foreground'}>{x.message}</li>)}</ul>}
              <p className="mt-3 text-[11px] text-muted-foreground">Rule-based hints, not an AI judgement.</p></CardContent>
          </Card>
        )}
        <div className="flex flex-col gap-2">
          <Button type="button" disabled={!!busy || !f.title.trim()} onClick={() => save(true)}>{busy === 'submit' ? 'Submitting…' : 'Save & submit for approval'}</Button>
          <Button type="submit" variant="outline" disabled={!!busy || !f.title.trim()}>{busy === 'draft' ? 'Saving…' : 'Save draft'}</Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
        </div>
      </div>
    </form>
  );
}
export { api };
