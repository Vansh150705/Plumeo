'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { LevelPill } from '@/components/status';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAction } from '@/components/use-action';
import { del, post } from '@/lib/api-client';

export function TemplatesAdmin({ templates, departments }: { templates: any[]; departments: { id: string; name: string }[] }) {
  const { run, busy, error } = useAction();
  const [dlg, setDlg] = useState(false);
  const [f, setF] = useState({ name: '', level: 'individual', departmentId: '', title: '', description: '', expectedOutcome: '', priority: 'medium' });
  const [krs, setKrs] = useState([{ title: '', metricType: 'number', startValue: '0', targetValue: '' }]);
  async function save() {
    const content = { title: f.title.trim() || undefined, description: f.description.trim() || undefined, expectedOutcome: f.expectedOutcome.trim() || undefined, priority: f.priority,
      keyResults: krs.filter((k) => k.title.trim()).map((k) => ({ title: k.title.trim(), metricType: k.metricType, startValue: Number(k.startValue), targetValue: Number(k.targetValue), weight: 1 })) };
    const r = await run(() => post('/templates', { name: f.name.trim(), level: f.level, departmentId: f.departmentId || null, content }), { success: 'Added to the library.' });
    if (r) setDlg(false);
  }
  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setDlg(true)}><Plus className="size-4" aria-hidden />New template</Button></div>
      <ul className="grid gap-3 sm:grid-cols-2">{templates.map((t) => (
        <li key={t.id} className="rounded-xl border border-border bg-card p-4">
          <div className="mb-1 flex items-start justify-between gap-2"><div className="font-medium">{t.name}</div><Button size="icon" variant="ghost" aria-label={`Archive ${t.name}`} disabled={busy} onClick={() => run(() => del(`/templates/${t.id}`), { success: 'Archived.' })}><Trash2 className="size-4" aria-hidden /></Button></div>
          <div className="mb-2 flex items-center gap-2"><LevelPill level={t.level} />{t.department_name && <span className="text-xs text-muted-foreground">{t.department_name}</span>}<span className="text-xs text-muted-foreground">used {t.usage_count}×</span></div>
          {t.content?.title && <p className="text-sm">{t.content.title}</p>}
          {t.content?.keyResults?.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">{t.content.keyResults.map((k: any, i: number) => <li key={i}>{k.title} ({k.startValue}→{k.targetValue})</li>)}</ul>}
        </li>))}</ul>
      <Dialog open={dlg} onOpenChange={setDlg}><DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New goal template</DialogTitle></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
        <Field label="Template name" htmlFor="tn"><Input id="tn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="For goals at level" htmlFor="tl"><Select id="tl" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>{['individual', 'team', 'department', 'company'].map((l) => <option key={l}>{l}</option>)}</Select></Field><Field label="Library (optional)" htmlFor="td"><Select id="td" value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}><option value="">Whole organisation</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field></div>
        <Field label="Suggested goal title" htmlFor="tt"><Input id="tt" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Description" htmlFor="tdesc"><Textarea id="tdesc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Expected outcome" htmlFor="tout"><Textarea id="tout" rows={2} value={f.expectedOutcome} onChange={(e) => setF({ ...f, expectedOutcome: e.target.value })} /></Field>
        <div className="space-y-2"><div className="flex items-center justify-between"><span className="text-xs font-medium">Key results</span><Button type="button" size="sm" variant="ghost" onClick={() => setKrs([...krs, { title: '', metricType: 'number', startValue: '0', targetValue: '' }])}><Plus className="size-4" aria-hidden />Add</Button></div>
          {krs.map((k, i) => <div key={i} className="grid grid-cols-[1fr_5rem_5rem] gap-2"><Input aria-label="Key result" placeholder="Title" value={k.title} onChange={(e) => setKrs(krs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} /><Input aria-label="Start" type="number" step="any" value={k.startValue} onChange={(e) => setKrs(krs.map((x, j) => (j === i ? { ...x, startValue: e.target.value } : x)))} /><Input aria-label="Target" type="number" step="any" placeholder="Target" value={k.targetValue} onChange={(e) => setKrs(krs.map((x, j) => (j === i ? { ...x, targetValue: e.target.value } : x)))} /></div>)}</div>
        <DialogFooter><Button variant="ghost" onClick={() => setDlg(false)}>Cancel</Button><Button disabled={busy || f.name.trim().length < 2} onClick={save}>Save template</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
