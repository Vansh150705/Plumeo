'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

// navy + gold ramp (no bright purple/green -keeps the brand palette)
const COLORS = ['#B8893A', '#14233D', '#34507C', '#6E83AC', '#C9A45F', '#41608C', '#9AAAC8', '#8A6A2E'];

const tooltipStyle = {
  contentStyle: {
    background: '#ffffff',
    border: '1px solid hsl(218 20% 90%)',
    borderRadius: 8,
    fontSize: 12,
    boxShadow: '0 10px 30px -16px hsl(218 40% 16% / 0.25)',
  },
  itemStyle: { color: 'hsl(218 54% 14%)' },
  labelStyle: { color: 'hsl(218 54% 14%)', fontWeight: 600 },
};

export function AnalyticsCharts({
  qoqData, thrustData, uomData, heatmap, managerData, departments,
}: {
  qoqData: { quarter: string; score: number | null; count: number }[];
  thrustData: { name: string; value: number }[];
  uomData: { name: string; value: number }[];
  heatmap: Record<string, Record<string, number>>;
  managerData: { name: string; completion: number; team: number }[];
  departments: string[];
}) {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Insights</div>
        <h1 className="font-serif text-4xl tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Real-time dashboards across the entire goal lifecycle.
          Driven by Postgres views and recomputed on every check-in save.
        </p>
      </div>

      {/* Row 1 -QoQ trend (wide) */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold">Quarter-on-quarter score</div>
              <div className="text-xs text-muted-foreground">Weighted average across all goals</div>
            </div>
            <Pill variant="gold">FY 2026-27</Pill>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={qoqData}>
              <CartesianGrid stroke="hsl(218 20% 90%)" vertical={false} />
              <XAxis dataKey="quarter" tick={{ fill: 'hsl(218 14% 42%)', fontSize: 12 }} stroke="hsl(218 20% 90%)" />
              <YAxis tick={{ fill: 'hsl(218 14% 42%)', fontSize: 12 }} stroke="hsl(218 20% 90%)" domain={[0, 100]} />
              <Tooltip {...tooltipStyle} />
              <Line
                type="monotone" dataKey="score"
                stroke="#B8893A" strokeWidth={2.5}
                dot={{ fill: '#B8893A', r: 5 }}
                activeDot={{ r: 7, fill: '#B8893A' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Row 2 -Thrust + UoM */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="text-sm font-semibold mb-1">Goals by thrust area</div>
            <div className="text-xs text-muted-foreground mb-4">Where teams are focusing</div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={thrustData} layout="vertical">
                <CartesianGrid stroke="hsl(218 20% 90%)" horizontal={false} />
                <XAxis type="number" tick={{ fill: 'hsl(218 14% 42%)', fontSize: 11 }} stroke="hsl(218 20% 90%)" />
                <YAxis type="category" dataKey="name" tick={{ fill: 'hsl(218 14% 42%)', fontSize: 11 }} stroke="hsl(218 20% 90%)" width={120} />
                <Tooltip {...tooltipStyle} cursor={{ fill: 'hsl(40 34% 92%)' }} />
                <Bar dataKey="value" fill="#B8893A" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="text-sm font-semibold mb-1">UoM distribution</div>
            <div className="text-xs text-muted-foreground mb-4">Numeric / % / Timeline / Zero</div>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={uomData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%" cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={3}
                >
                  {uomData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12, color: 'hsl(218 14% 42%)' }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Row 3 -Heatmap */}
      <Card>
        <CardContent className="p-5">
          <div className="text-sm font-semibold mb-1">Department × quarter completion heatmap</div>
          <div className="text-xs text-muted-foreground mb-4">Weighted score; darker gold = stronger</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left py-2 text-xs font-medium text-muted-foreground w-40">Department</th>
                  {['Q1', 'Q2', 'Q3', 'Q4'].map(q => (
                    <th key={q} className="py-2 text-xs font-medium text-muted-foreground text-center">{q}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {departments.map(dept => (
                  <tr key={dept} className="border-t border-border">
                    <td className="py-2 text-sm font-medium">{dept}</td>
                    {(['Q1', 'Q2', 'Q3', 'Q4'] as const).map(q => {
                      const score = heatmap[dept]?.[q] ?? 0;
                      const intensity = Math.min(1, score / 100);
                      return (
                        <td key={q} className="py-1.5 text-center">
                          <div
                            className="inline-flex items-center justify-center w-20 h-12 rounded-md font-mono text-sm font-semibold"
                            style={{
                              backgroundColor: score === 0 ? 'hsl(40 30% 96%)' : `rgba(184, 137, 58, ${0.12 + intensity * 0.55})`,
                              color: score === 0 ? 'hsl(218 14% 55%)' : score > 60 ? '#fff' : 'hsl(218 54% 14%)',
                              border: `1px solid ${score === 0 ? 'hsl(218 20% 90%)' : `rgba(184, 137, 58, ${0.2 + intensity * 0.4})`}`,
                            }}
                          >
                            {score === 0 ? '·' : score}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {departments.length === 0 && (
                  <tr><td colSpan={5} className="py-10 text-center text-sm text-muted-foreground">No departmental data yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Row 4 -Manager effectiveness */}
      <Card>
        <CardContent className="p-5">
          <div className="text-sm font-semibold mb-1">Manager effectiveness</div>
          <div className="text-xs text-muted-foreground mb-4">% of expected check-ins captured by each manager&apos;s team</div>
          <ResponsiveContainer width="100%" height={Math.max(200, managerData.length * 50)}>
            <BarChart data={managerData} layout="vertical">
              <CartesianGrid stroke="hsl(218 20% 90%)" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fill: 'hsl(218 14% 42%)', fontSize: 11 }} stroke="hsl(218 20% 90%)" />
              <YAxis type="category" dataKey="name" tick={{ fill: 'hsl(218 14% 42%)', fontSize: 11 }} stroke="hsl(218 20% 90%)" width={100} />
              <Tooltip {...tooltipStyle} cursor={{ fill: 'hsl(40 34% 92%)' }} formatter={(v: any) => `${v}%`} />
              <Bar dataKey="completion" fill="#14233D" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
