import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowUpRight, CalendarDays, Layers, User } from 'lucide-react';
import { requireCtx } from '@/server/auth/request';
import { can } from '@/server/core/context';
import { getGoalDetail } from '@/server/services/goals';
import { AppError } from '@/server/core/errors';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Pill } from '@/components/ui/pill';
import { GoalStatusPill, HealthPill, LevelPill, PriorityPill, RiskPill } from '@/components/status';
import { DecisionPanel, GoalActions, KeyResultProgress } from '@/components/goal-actions';
import { VersionList } from '@/components/version-viewer';
import { fmtDate, fmtDateTime, fmtRelative } from '@/lib/utils';

export async function generateMetadata() { return { title: 'Goal' }; }

const ACTION_LABEL: Record<string, string> = {
  'goal.created': 'created the goal', 'goal.updated': 'edited the draft', 'goal.submitted': 'submitted for approval', 'goal.withdrawn': 'withdrew the submission', 'goal.approved': 'approved the goal',
  'goal.rejected': 'rejected the goal', 'goal.changes_requested': 'requested changes', 'goal.amendment_requested': 'proposed an amendment', 'goal.amended': 'applied an amendment', 'goal.amendment_withdrawn': 'withdrew an amendment',
  'goal.completed': 'completed the goal', 'goal.cancelled': 'cancelled the goal', 'goal.owner_transferred': 'transferred ownership', 'goal.progress_updated': 'recorded progress', 'goal.deleted': 'deleted the draft',
  'approval.level_approved': 'approved a level', 'approval.amendment_approved': 'approved the amendment', 'approval.amendment_rejected': 'declined the amendment',
  'checkin.submitted': 'submitted a check-in', 'checkin.resubmitted': 'resubmitted a check-in', 'checkin.reviewed': 'reviewed a check-in', 'checkin.reopened': 'reopened a check-in', 'action_item.updated': 'updated a follow-up',
};

export default async function GoalPage({ params }: { params: { id: string } }) {
  const ctx = await requireCtx();
  const d = await getGoalDetail(ctx, params.id).catch((e) => { if (e instanceof AppError && (e.code === 'not_found' || e.code === 'validation_failed')) notFound(); throw e; });
  const g = d.goal;
  const pending = d.approvals.filter((a: any) => a.status === 'pending' || a.status === 'waiting');
  const decide = d.approvals.find((a: any) => a.id === d.permissions.decide);
  const latestRound = d.approvals.length ? Math.max(...d.approvals.filter((a: any) => !a.amendment_id).map((a: any) => a.round)) : 0;
  const totalLevels = decide ? d.approvals.filter((a: any) => a.round === decide.round && a.amendment_id === decide.amendment_id).length : 1;

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-3 text-xs text-muted-foreground"><Link href="/app/goals" className="hover:text-foreground">Goals</Link> / <span>{g.cycle_name}</span></nav>
      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2"><LevelPill level={g.level} /><GoalStatusPill status={g.status} />{g.status === 'active' && <RiskPill risk={g.risk} />}<PriorityPill priority={g.priority} /></div>
        <h1 className="text-2xl font-semibold tracking-tight">{g.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><User className="size-3.5" aria-hidden />{g.owner_name}</span>
          {(g.team_name || g.department_name) && <span className="inline-flex items-center gap-1.5"><Layers className="size-3.5" aria-hidden />{[g.department_name, g.team_name].filter(Boolean).join(' · ')}</span>}
          <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" aria-hidden />{fmtDate(g.start_date)} → {fmtDate(g.due_date)}</span>
        </div>
      </header>

      <div className="mb-6"><GoalActions goal={g} permissions={d.permissions} hasKeyResults={d.keyResults.length > 0} canTemplate={can(ctx, 'templates.manage')} canTransfer={can(ctx, 'goals.reassign')} /></div>

      {decide && <div className="mb-6"><DecisionPanel requestId={decide.id} level={decide.level} totalLevels={totalLevels} amendment={!!decide.amendment_id} /></div>}
      {g.status === 'changes_requested' || g.status === 'rejected' ? (() => {
        const last = d.approvals.find((a: any) => !a.amendment_id && a.decision_comment && ['changes_requested', 'rejected'].includes(a.status));
        return last ? <div role="note" className="mb-6 rounded-xl border border-[hsl(var(--warning))]/40 bg-[hsl(var(--warning))]/10 p-4 text-sm"><div className="mb-1 font-medium">{last.decided_by_name} {g.status === 'rejected' ? 'rejected this goal' : 'asked for changes'}</div><p className="text-muted-foreground">{last.decision_comment}</p></div> : null;
      })() : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3"><CardTitle>Overview</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div><div className="mb-1 text-xs font-medium text-muted-foreground">Description</div><p className="whitespace-pre-wrap">{g.description || <span className="text-muted-foreground">No description yet.</span>}</p></div>
              <div><div className="mb-1 text-xs font-medium text-muted-foreground">Expected outcome</div><p className="whitespace-pre-wrap">{g.expected_outcome || <span className="text-muted-foreground">Not set.</span>}</p></div>
              {g.context && <div><div className="mb-1 text-xs font-medium text-muted-foreground">Context</div><p className="whitespace-pre-wrap">{g.context}</p></div>}
              {d.collaborators.length > 0 && <div><div className="mb-1 text-xs font-medium text-muted-foreground">Collaborators</div><div className="flex flex-wrap gap-1.5">{d.collaborators.map((c: any) => <Pill key={c.user_id}>{c.full_name}</Pill>)}</div></div>}
            </CardContent>
          </Card>

          <Card id="key-results">
            <CardHeader className="pb-1"><CardTitle className="flex items-center justify-between">Key results<span className="text-sm font-normal text-muted-foreground">{g.progress_mode === 'rollup' ? 'Rolled up from aligned goals' : 'Measured by key results'}</span></CardTitle></CardHeader>
            <CardContent>
              <div className="mb-4 rounded-lg bg-muted/50 p-3">
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground"><span>Overall progress{g.progress_mode === 'rollup' ? ` (from ${g.contributors} approved goal${g.contributors === 1 ? '' : 's'})` : ''}</span></div>
                <ProgressBar value={g.progress} label="Overall progress" />
                {g.progress_mode === 'rollup' && g.own_progress != null && <p className="mt-1 text-xs text-muted-foreground">Its own key results stand at {g.own_progress}% but do not feed the roll-up.</p>}
              </div>
              {d.keyResults.length === 0 ? <p className="text-sm text-muted-foreground">No key results yet. Goals need at least one measurable key result before they can be submitted.</p>
                : <KeyResultProgress goalId={g.id} krs={d.keyResults} editable={d.permissions.recordProgress} />}
            </CardContent>
          </Card>

          {d.progressHistory.length > 0 && (
            <Card><CardHeader className="pb-3"><CardTitle>Progress history</CardTitle></CardHeader><CardContent>
              <ul className="divide-y divide-border text-sm">{d.progressHistory.slice(0, 12).map((p: any) => (
                <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2"><span><span className="font-medium">{p.key_result_title}</span>: {p.previous_value ?? '—'} → <strong>{p.value}</strong>{p.note ? <span className="text-muted-foreground"> · {p.note}</span> : null}{p.source === 'checkin' && <Pill className="ml-2" variant="blue">check-in</Pill>}</span><span className="text-xs text-muted-foreground">{p.created_by_name} · {fmtRelative(p.created_at)}</span></li>
              ))}</ul></CardContent></Card>
          )}

          <Card>
            <CardHeader className="pb-3"><CardTitle>Check-ins</CardTitle></CardHeader>
            <CardContent>
              {d.checkins.length === 0 ? <p className="text-sm text-muted-foreground">{g.status === 'active' ? 'Check-ins appear here once a review period opens.' : 'No check-ins recorded.'}</p> : (
                <ul className="divide-y divide-border">{d.checkins.map((c: any) => (
                  <li key={c.id}><Link href={`/app/checkins/${g.id}/${c.period_id}`} className="flex items-center justify-between gap-3 py-3 hover:opacity-80"><span className="text-sm font-medium">{c.period_name}</span><span className="flex items-center gap-2"><HealthPill health={c.health} />{c.progress_snapshot != null && <span className="text-xs tabular-nums text-muted-foreground">{c.progress_snapshot}%</span>}{c.is_late && <Pill variant="orange">late</Pill>}<ArrowUpRight className="size-3.5 text-muted-foreground" aria-hidden /></span></Link></li>
                ))}</ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle>Activity</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-3">{d.history.slice(0, 30).map((h: any) => (
                <li key={h.seq} className="flex gap-3 text-sm"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[hsl(var(--gold))]" aria-hidden />
                  <div className="min-w-0 flex-1"><span className="font-medium">{h.actor_name ?? 'Someone'}</span> {ACTION_LABEL[h.action] ?? h.action}
                    {h.metadata?.comment && <p className="text-xs text-muted-foreground">“{h.metadata.comment}”</p>}{h.metadata?.reason && <p className="text-xs text-muted-foreground">Reason: {h.metadata.reason}</p>}
                    <div className="text-xs text-muted-foreground" title={fmtDateTime(h.occurred_at)}>{fmtRelative(h.occurred_at)}</div></div></li>
              ))}</ol>
              {can(ctx, 'audit.read') && <Link href={`/app/audit?entityId=${g.id}`} className="mt-3 inline-block text-xs text-muted-foreground hover:text-foreground">Open in audit trail →</Link>}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3"><CardTitle>How this contributes</CardTitle></CardHeader>
            <CardContent>
              {d.ancestors.length === 0 && d.children.length === 0 && <p className="text-sm text-muted-foreground">Not aligned to any other goal yet.</p>}
              {d.ancestors.length > 0 && (
                <ol className="mb-3 space-y-1.5 border-l-2 border-[hsl(var(--gold))]/40 pl-3">{d.ancestors.map((a: any) => (
                  <li key={a.id} className="text-sm"><LevelPill level={a.level} /><Link href={`/app/goals/${a.id}`} className="mt-1 block font-medium hover:underline">{a.title}</Link><span className="text-xs text-muted-foreground">{a.owner_name}{a.progress != null ? ` · ${Math.round(a.progress)}%` : ''}</span></li>
                ))}</ol>
              )}
              {d.children.length > 0 && <><div className="mb-1.5 text-xs font-medium text-muted-foreground">Aligned goals ({d.children.length}{d.hiddenChildren ? ` of ${d.children.length + d.hiddenChildren}` : ''})</div>
                <ul className="space-y-2">{d.children.map((c: any) => <li key={c.id} className="text-sm"><Link href={`/app/goals/${c.id}`} className="font-medium hover:underline">{c.title}</Link><div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{c.owner_name}</span><GoalStatusPill status={c.status} /></div><ProgressBar value={c.progress} className="mt-1" /></li>)}</ul></>}
              {g.status === 'active' && g.level !== 'individual' && <Link href={`/app/goals/new?parent=${g.id}&cycleId=${g.cycle_id}`} className="mt-3 inline-block text-xs font-medium text-[hsl(var(--gold))] hover:underline">+ Add an aligned goal</Link>}
              {g.status === 'active' && g.level === 'individual' ? null : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle>Approval</CardTitle></CardHeader>
            <CardContent>
              {d.approvals.length === 0 ? <p className="text-sm text-muted-foreground">Not submitted yet.</p> : (
                <ol className="space-y-3">{d.approvals.slice(0, 8).map((a: any) => (
                  <li key={a.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2"><span className="font-medium">{a.amendment_id ? 'Amendment · ' : ''}Level {a.level}{a.round !== latestRound && !a.amendment_id ? ` · round ${a.round}` : ''}</span>
                      <Pill variant={a.status === 'approved' ? 'green' : a.status === 'pending' ? 'blue' : a.status === 'waiting' ? 'gray' : a.status === 'rejected' ? 'red' : a.status === 'changes_requested' ? 'orange' : 'gray'}>{a.status.replace('_', ' ')}</Pill></div>
                    <div className="text-xs text-muted-foreground">{a.decided_at ? `${a.decided_by_name}${a.on_behalf_of_name ? ` (for ${a.on_behalf_of_name})` : ''} · ${fmtDateTime(a.decided_at)}` : a.approver_name ? `Waiting on ${a.approver_name}${a.status === 'pending' && a.due_at ? ` · due ${fmtDate(a.due_at)}` : ''}` : 'Waiting on an approver from the approver pool'}</div>
                    {a.decision_comment && <p className="mt-0.5 text-xs">“{a.decision_comment}”</p>}
                  </li>
                ))}</ol>
              )}
              {pending.length === 0 && g.approved_at && <p className="mt-3 text-xs text-muted-foreground">Approved {fmtDate(g.approved_at)}</p>}
            </CardContent>
          </Card>

          {d.amendments.length > 0 && (
            <Card><CardHeader className="pb-3"><CardTitle>Amendments</CardTitle></CardHeader><CardContent>
              <ul className="space-y-3 text-sm">{d.amendments.map((a: any) => (
                <li key={a.id}><div className="flex items-center justify-between gap-2"><span className="font-medium">{a.change_kinds.length ? a.change_kinds.join(', ') : 'minor'}</span><Pill variant={a.status === 'applied' ? 'green' : a.status === 'pending_approval' ? 'blue' : 'gray'}>{a.status.replace('_', ' ')}</Pill></div>
                  <p className="text-xs text-muted-foreground">{a.reason}</p><div className="text-xs text-muted-foreground">{a.requested_by_name} · {fmtDate(a.requested_at)}</div></li>
              ))}</ul></CardContent></Card>
          )}

          {d.versions.length > 0 && <Card><CardHeader className="pb-1"><CardTitle>Version history</CardTitle></CardHeader><CardContent><VersionList goalId={g.id} versions={d.versions} /></CardContent></Card>}
        </div>
      </div>
    </div>
  );
}
