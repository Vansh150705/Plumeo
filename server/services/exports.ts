import PDFDocument from 'pdfkit';
import { withOrg } from '../db/pool';
import { type Ctx, requirePerm } from '../core/context';
import { audit, auditExportRows, type AuditFilters } from './audit';
import { listGoals, type GoalFilters } from './goals';
import { getAnalytics, type AnalyticsFilters } from './analytics';
import { EXPECTED_CHECKINS_SQL, todayUtc } from './checkins';
import { scopeOwnerPredicate } from './goal-access';

/** CSV with formula-injection protection (cells starting with = + - @ tab or CR are neutralised). */
export function csvCell(v: unknown): string {
  if (v == null) return '';
  let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  return [head, ...rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(','))].join('\r\n') + '\r\n';
}

async function recordExport(ctx: Ctx, kind: string, rows: number, filters: unknown) {
  await withOrg(ctx.orgId, (tx) => audit(tx, ctx, { action: 'export.generated', entityType: 'export', metadata: { kind, rows, filters } }));
}

export async function exportGoalsCsv(ctx: Ctx, f: GoalFilters) {
  requirePerm(ctx, 'exports.run');
  const all: any[] = [];
  for (let offset = 0; offset < 10000; offset += 200) {
    const page = await listGoals(ctx, { ...f, limit: 200, offset });
    all.push(...page.data);
    if (page.data.length < 200) break;
  }
  await recordExport(ctx, 'goals', all.length, f);
  return toCsv(all, [
    { key: 'id', label: 'Goal ID' }, { key: 'title', label: 'Title' }, { key: 'level', label: 'Level' }, { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' }, { key: 'owner_name', label: 'Owner' }, { key: 'department_name', label: 'Department' }, { key: 'team_name', label: 'Team' },
    { key: 'parent_title', label: 'Aligned to' }, { key: 'start_date', label: 'Start' }, { key: 'due_date', label: 'Due' },
    { key: 'progress', label: 'Progress %' }, { key: 'risk', label: 'Risk' }, { key: 'approved_at', label: 'Approved at' },
  ]);
}

export async function exportCheckinsCsv(ctx: Ctx, f: { periodId?: string; asOf?: string }) {
  requirePerm(ctx, 'exports.run');
  const asOf = f.asOf ?? todayUtc();
  const rows = await withOrg(ctx.orgId, async (tx) => {
    const params: unknown[] = [ctx.orgId, asOf];
    const scope = scopeOwnerPredicate(ctx, params, 'e.owner_id');
    const w = [scope, `e.state <> 'upcoming'`];
    if (f.periodId) { params.push(f.periodId); w.push(`e.period_id = $${params.length}`); }
    return tx.query<any>(`with e as (${EXPECTED_CHECKINS_SQL})
      select e.goal_id, e.title, u.full_name as owner, e.period_name, e.due_on, e.state, e.health, e.progress_snapshot, e.is_late, e.submitted_at
      from e join users u on u.org_id = $1 and u.id = e.owner_id where ${w.join(' and ')} order by e.sequence, u.full_name limit 50000`, params);
  });
  await recordExport(ctx, 'checkins', rows.length, f);
  return toCsv(rows, [
    { key: 'goal_id', label: 'Goal ID' }, { key: 'title', label: 'Goal' }, { key: 'owner', label: 'Owner' }, { key: 'period_name', label: 'Period' },
    { key: 'due_on', label: 'Due' }, { key: 'state', label: 'State' }, { key: 'health', label: 'Health' }, { key: 'progress_snapshot', label: 'Progress %' },
    { key: 'is_late', label: 'Late' }, { key: 'submitted_at', label: 'Submitted at' },
  ]);
}

export async function exportAuditCsv(ctx: Ctx, f: AuditFilters) {
  const rows = await auditExportRows(ctx, f);
  return toCsv(rows, [
    { key: 'seq', label: 'Seq' }, { key: 'occurred_at', label: 'Time (UTC)' }, { key: 'actor_name', label: 'Actor' }, { key: 'actor_type', label: 'Actor type' },
    { key: 'action', label: 'Action' }, { key: 'entity_type', label: 'Entity' }, { key: 'entity_id', label: 'Entity ID' }, { key: 'request_id', label: 'Request ID' },
    { key: 'before_data', label: 'Before' }, { key: 'after_data', label: 'After' }, { key: 'metadata', label: 'Metadata' }, { key: 'hash', label: 'Hash' },
  ]);
}

/** One-page PDF progress summary built from exactly the same (scoped) numbers as the dashboard. */
export async function exportSummaryPdf(ctx: Ctx, f: AnalyticsFilters): Promise<Buffer> {
  requirePerm(ctx, 'exports.run');
  const a: any = await getAnalytics(ctx, f);
  const org = await withOrg(ctx.orgId, (tx) => tx.one<{ name: string }>('select name from orgs where id = $1', [ctx.orgId]));
  await recordExport(ctx, 'summary_pdf', 1, f);
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'Plumeo goal progress summary', Author: 'Plumeo' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.fontSize(20).text(`${org?.name ?? 'Organisation'} — goal progress`, { align: 'left' });
    doc.fontSize(10).fillColor('#555').text(a.cycle ? `Cycle: ${a.cycle.name} · As of ${a.asOf} · Scope: ${a.scope}` : 'No cycle').moveDown();
    if (!a.cycle) { doc.end(); return; }
    doc.fillColor('#000').fontSize(13).text('Summary');
    const s = a.summary;
    doc.fontSize(10);
    for (const line of [
      `Goals: ${s.totalGoals}  (active ${s.byStatus.active ?? 0}, completed ${s.byStatus.completed ?? 0}, pending approval ${s.byStatus.pending_approval ?? 0})`,
      `Average progress of active goals: ${s.averageProgress ?? 'n/a'}%  (${s.goalsWithoutMeasurableProgress} active goals have no measurable progress yet)`,
      `Completion rate (completed ÷ approved): ${s.completionRate ?? 'n/a'}%`,
      `Overdue: ${s.overdue}   At risk: ${s.atRisk}   Stalled: ${s.stalled}`,
      `Approval turnaround (hours): avg ${a.approvals.turnaroundHours.average ?? 'n/a'}, median ${a.approvals.turnaroundHours.median ?? 'n/a'}, p90 ${a.approvals.turnaroundHours.p90 ?? 'n/a'}; pending ${a.approvals.pending}`,
      `Alignment rate: ${a.alignment.alignmentRate ?? 'n/a'}%`,
    ]) doc.text(line);
    doc.moveDown().fontSize(13).text('By department').fontSize(10);
    for (const d of a.byDepartment.slice(0, 20)) doc.text(`${d.name}: ${d.goals} goals, avg progress ${d.averageProgress ?? 'n/a'}%, at risk ${d.atRisk}, overdue ${d.overdue}`);
    doc.moveDown().fontSize(13).text('Check-in completion by period').fontSize(10);
    for (const p of a.checkins.periods) doc.text(`${p.name}: ${p.submitted}/${p.expected} submitted (${p.completionRate ?? 'n/a'}%), on time ${p.onTimeRate ?? 'n/a'}%, avg progress ${p.averageProgress ?? 'n/a'}%`);
    doc.moveDown().fontSize(8).fillColor('#777').text('Generated by Plumeo. Figures are limited to the goals the requesting user is permitted to see. Progress = weighted key-result attainment; see documentation for definitions.');
    doc.end();
  });
}
