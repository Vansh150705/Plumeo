import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCtx } from '@/server/auth/request';
import { getCheckin } from '@/server/services/checkins';
import { getPolicy } from '@/server/services/orgs';
import { AppError } from '@/server/core/errors';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckinStatePill, HealthPill } from '@/components/status';
import { Pill } from '@/components/ui/pill';
import { ProgressBar } from '@/components/ui/progress-bar';
import { CheckinForm, ReviewPanel } from '@/components/checkin-panels';
import { fmtDate, fmtDateTime } from '@/lib/utils';

export const metadata = { title: 'Check-in' };

const Block = ({ title, text }: { title: string; text?: string | null }) => text ? <div><div className="text-xs font-medium text-muted-foreground">{title}</div><p className="whitespace-pre-wrap text-sm">{text}</p></div> : null;

export default async function CheckinPage({ params }: { params: { goalId: string; periodId: string } }) {
  const ctx = await requireCtx();
  const d = await getCheckin(ctx, params.goalId, params.periodId).catch((e) => { if (e instanceof AppError && ['not_found', 'validation_failed'].includes(e.code)) notFound(); throw e; });
  const { policy } = await getPolicy(ctx);
  const owner = d.owner_id === ctx.userId;
  const status = d.checkin?.status ?? 'draft';
  const canEdit = d.permissions.submit;
  const aiEnabled = policy.ai.enabled && !!process.env.GROQ_API_KEY;
  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-3 text-xs text-muted-foreground"><Link href={owner ? '/app/checkins' : '/app/team'} className="hover:text-foreground">Check-ins</Link> / {d.period.name}</nav>
      <PageHeader title={`${d.period.name} check-in`} description={<><Link href={`/app/goals/${d.goal.id}`} className="font-medium text-foreground hover:underline">{d.goal.title}</Link> · window {fmtDate(d.period.opens_on)} – due {fmtDate(d.period.due_on)}</>} actions={<CheckinStatePill state={d.state} />} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {canEdit ? (
            <Card><CardHeader className="pb-3"><CardTitle>{d.state === 'reopened' ? 'Correct your check-in' : 'Your check-in'}</CardTitle></CardHeader><CardContent>
              {d.state === 'reopened' && d.feedback.filter((f: any) => f.kind === 'reopen').slice(-1).map((f: any) => <div key={f.id} role="note" className="mb-4 rounded-lg border border-[hsl(var(--warning))]/40 bg-[hsl(var(--warning))]/10 p-3 text-sm"><strong>{f.author_name}</strong> asked for a correction: {f.body}</div>)}
              <CheckinForm goalId={d.goal.id} periodId={d.period.id} krs={d.keyResults} draft={d.checkin?.draft} questions={d.questions} locked={false} aiEnabled={aiEnabled} /></CardContent></Card>
          ) : d.revisions.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{d.state === 'upcoming' ? `This review period opens on ${fmtDate(d.period.opens_on)}.` : owner ? 'You have not submitted this check-in yet.' : 'The owner has not submitted this check-in yet.'}</CardContent></Card>
          ) : null}

          {d.revisions.map((r: any, idx: number) => (
            <Card key={r.revision}>
              <CardHeader className="pb-3"><CardTitle className="flex flex-wrap items-center justify-between gap-2"><span>{idx === 0 ? 'Submitted check-in' : 'Earlier version'} · revision {r.revision}</span><span className="flex items-center gap-2"><HealthPill health={r.health} />{r.is_late && <Pill variant="orange">late</Pill>}</span></CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="text-xs text-muted-foreground">{r.submitted_by_name} · {fmtDateTime(r.submitted_at)}</div>
                <ProgressBar value={r.progress} label="Goal progress at submission" />
                <ul className="space-y-1 text-sm">{r.kr_values.map((k: any) => <li key={k.key_result_id} className="flex justify-between gap-3"><span>{k.title}</span><span className="tabular-nums text-muted-foreground">{k.value} / {k.target} ({Math.round(k.progress)}%)</span></li>)}</ul>
                <div className="grid gap-4 sm:grid-cols-2"><Block title="What went well" text={r.achievements} /><Block title="Challenges" text={r.challenges} /><Block title="Blockers" text={r.blockers} /><Block title="Next steps" text={r.next_steps} /></div>
                <Block title="Reflection" text={r.reflection} />
                {Object.entries(r.answers ?? {}).map(([k, v]) => <Block key={k} title={d.questions.find((q: any) => q.id === k)?.label ?? k} text={String(v)} />)}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-6">
          {d.feedback.length > 0 && (
            <Card><CardHeader className="pb-3"><CardTitle>Conversation</CardTitle></CardHeader><CardContent>
              <ul className="space-y-3">{d.feedback.map((f: any) => <li key={f.id} className="text-sm"><div className="flex items-center gap-2"><span className="font-medium">{f.author_name}</span>{f.kind === 'reopen' && <Pill variant="orange">asked for correction</Pill>}<span className="text-xs text-muted-foreground">on revision {f.revision}</span></div><p className="mt-0.5 whitespace-pre-wrap">{f.body}</p><div className="text-xs text-muted-foreground">{fmtDateTime(f.created_at)}</div></li>)}</ul></CardContent></Card>
          )}
          {d.permissions.review && d.checkin && ['submitted', 'reviewed'].includes(status) && <ReviewPanel checkinId={d.checkin.id} goalId={d.goal.id} periodId={d.period.id} status={status} aiEnabled={aiEnabled} />}
          {d.actionItems.length > 0 && <Card><CardHeader className="pb-3"><CardTitle>Follow-up actions</CardTitle></CardHeader><CardContent><ul className="space-y-2 text-sm">{d.actionItems.map((a: any) => <li key={a.id} className="flex justify-between gap-2"><span className={a.status === 'done' ? 'line-through text-muted-foreground' : ''}>{a.title}</span><span className="text-xs text-muted-foreground">{a.assignee_name}{a.due_date ? ` · ${fmtDate(a.due_date)}` : ''}</span></li>)}</ul></CardContent></Card>}
        </div>
      </div>
    </div>
  );
}
