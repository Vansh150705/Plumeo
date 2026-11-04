'use client';

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const C = { navy: 'hsl(218 56% 22%)', gold: 'hsl(38 56% 46%)', green: 'hsl(152 52% 36%)', amber: 'hsl(32 80% 48%)', red: 'hsl(0 68% 50%)', gray: 'hsl(218 12% 62%)', blue: 'hsl(214 60% 48%)' };
const STATUS_COLOR: Record<string, string> = { active: C.green, completed: C.gold, pending_approval: C.blue, draft: C.gray, changes_requested: C.amber, rejected: C.red, cancelled: 'hsl(218 12% 78%)' };
const STATUS_LABEL: Record<string, string> = { active: 'Active', completed: 'Completed', pending_approval: 'Awaiting approval', draft: 'Draft', changes_requested: 'Changes requested', rejected: 'Rejected', cancelled: 'Cancelled' };
const tip = { contentStyle: { borderRadius: 10, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontSize: 12 } };
const axis = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };

function Frame({ title, caption, children, height = 240 }: { title: string; caption?: string; children: React.ReactNode; height?: number }) {
  return (
    <figure className="rounded-xl border border-border bg-card p-4" aria-label={title}>
      <figcaption className="mb-3"><div className="text-sm font-semibold">{title}</div>{caption && <div className="text-xs text-muted-foreground">{caption}</div>}</figcaption>
      <div style={{ height }}>{children}</div>
    </figure>
  );
}

export function StatusChart({ byStatus }: { byStatus: Record<string, number> }) {
  const data = Object.entries(byStatus).map(([k, v]) => ({ key: k, name: STATUS_LABEL[k] ?? k, value: v }));
  return <Frame title="Goals by status" caption="Count of goals in the selected scope">
    <ResponsiveContainer><BarChart data={data} layout="vertical" margin={{ left: 24, right: 16 }}><CartesianGrid horizontal={false} stroke="hsl(var(--border))" /><XAxis type="number" allowDecimals={false} tick={axis} /><YAxis type="category" dataKey="name" width={120} tick={axis} /><Tooltip {...tip} cursor={{ fill: 'hsl(var(--accent))' }} />
      <Bar dataKey="value" radius={[0, 6, 6, 0]}>{data.map((d) => <Cell key={d.key} fill={STATUS_COLOR[d.key] ?? C.gray} />)}</Bar></BarChart></ResponsiveContainer></Frame>;
}

export function DepartmentChart({ rows }: { rows: { name: string; averageProgress: number | null; atRisk: number; overdue: number }[] }) {
  const data = rows.filter((r) => r.averageProgress != null).map((r) => ({ name: r.name, progress: r.averageProgress }));
  if (!data.length) return <Frame title="Average progress by department"><p className="grid h-full place-items-center text-sm text-muted-foreground">No measurable progress yet.</p></Frame>;
  return <Frame title="Average progress by department" caption="Active goals with measurable key results">
    <ResponsiveContainer><BarChart data={data} margin={{ left: -10, right: 8 }}><CartesianGrid vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="name" tick={axis} interval={0} /><YAxis domain={[0, 100]} unit="%" tick={axis} /><Tooltip {...tip} formatter={(v: number) => [`${v}%`, 'Average progress']} cursor={{ fill: 'hsl(var(--accent))' }} /><Bar dataKey="progress" fill={C.navy} radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></Frame>;
}

export function CheckinChart({ periods }: { periods: { name: string; onTime: number; late: number; missing: number }[] }) {
  if (!periods.length) return <Frame title="Check-in completion"><p className="grid h-full place-items-center text-sm text-muted-foreground">No review periods have opened yet.</p></Frame>;
  return <Frame title="Check-in completion by period" caption="On time, late and missing check-ins">
    <ResponsiveContainer><BarChart data={periods} margin={{ left: -10, right: 8 }}><CartesianGrid vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="name" tick={axis} /><YAxis allowDecimals={false} tick={axis} /><Tooltip {...tip} cursor={{ fill: 'hsl(var(--accent))' }} /><Legend wrapperStyle={{ fontSize: 12 }} />
      <Bar dataKey="onTime" name="On time" stackId="a" fill={C.green} /><Bar dataKey="late" name="Late" stackId="a" fill={C.amber} /><Bar dataKey="missing" name="Missing" stackId="a" fill={C.red} radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></Frame>;
}

export function TrendChart({ periods }: { periods: { name: string; averageProgress: number | null }[] }) {
  const data = periods.filter((p) => p.averageProgress != null);
  if (data.length < 1) return <Frame title="Progress trend"><p className="grid h-full place-items-center text-sm text-muted-foreground">Trends appear after check-ins are submitted.</p></Frame>;
  return <Frame title="Progress trend across periods" caption="Average goal progress recorded at each period's check-ins">
    <ResponsiveContainer><LineChart data={data} margin={{ left: -10, right: 16 }}><CartesianGrid vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="name" tick={axis} /><YAxis domain={[0, 100]} unit="%" tick={axis} /><Tooltip {...tip} formatter={(v: number) => [`${v}%`, 'Average progress']} /><Line type="monotone" dataKey="averageProgress" stroke={C.gold} strokeWidth={2.5} dot={{ r: 4, fill: C.gold }} /></LineChart></ResponsiveContainer></Frame>;
}

export function PriorityChart({ byPriority }: { byPriority: Record<string, number> }) {
  const order = ['critical', 'high', 'medium', 'low'];
  const data = order.filter((k) => byPriority[k]).map((k) => ({ name: k[0].toUpperCase() + k.slice(1), value: byPriority[k], key: k }));
  const col: Record<string, string> = { critical: C.red, high: C.amber, medium: C.blue, low: C.gray };
  return <Frame title="Goals by priority" height={200}><ResponsiveContainer><BarChart data={data} margin={{ left: -10, right: 8 }}><CartesianGrid vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="name" tick={axis} /><YAxis allowDecimals={false} tick={axis} /><Tooltip {...tip} cursor={{ fill: 'hsl(var(--accent))' }} /><Bar dataKey="value" radius={[6, 6, 0, 0]}>{data.map((d) => <Cell key={d.key} fill={col[d.key]} />)}</Bar></BarChart></ResponsiveContainer></Frame>;
}
