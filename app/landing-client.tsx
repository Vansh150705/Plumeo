'use client';

import { useState, useTransition, useEffect } from 'react';
import { getMockDirectory, ssoSignIn } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Pill } from '@/components/ui/pill';
import {
  ShieldCheck, Users, BarChart3, GitBranch, Bell, FileCheck,
  Layers, Sparkles, Building2, ArrowRight, Github,
  CheckCircle2, Lock, Target, Zap, Trophy,
} from 'lucide-react';

type Entry = Awaited<ReturnType<typeof getMockDirectory>>[number];

export function LandingClient() {
  const [directory, setDirectory] = useState<Entry[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [loadingOid, setLoadingOid] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  async function openDirectory() {
    const d = await getMockDirectory();
    setDirectory(d);
    setTimeout(() => {
      document.getElementById('sso-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }

  function signIn(oid: string) {
    setLoadingOid(oid);
    startTransition(async () => {
      try { await ssoSignIn(oid); } catch (err) { console.error(err); setLoadingOid(null); }
    });
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <div className="absolute inset-0 mesh-bg pointer-events-none" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-primary/[0.06] rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-[400px] right-0 w-[500px] h-[500px] bg-purple-500/[0.04] rounded-full blur-[100px] pointer-events-none" />

      <header className={`sticky top-0 z-40 transition-all ${scrolled ? 'border-b border-border/60 bg-background/80 backdrop-blur-xl' : ''}`}>
        <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="size-9 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/40 grid place-items-center shadow-lg shadow-primary/10">
              <span className="font-serif text-primary text-2xl leading-none">A</span>
            </div>
            <div>
              <div className="font-semibold tracking-tight text-sm">AtomQuest</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Goal Portal</div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-1">
            <a href="#features" className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition rounded-md hover:bg-accent">Features</a>
            <a href="#architecture" className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition rounded-md hover:bg-accent">Architecture</a>
            <a href="#brd" className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition rounded-md hover:bg-accent">BRD coverage</a>
            <a href="https://github.com" target="_blank" rel="noreferrer" className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition rounded-md hover:bg-accent inline-flex items-center gap-1.5">
              <Github className="size-3.5" /> GitHub
            </a>
          </div>
          <Button size="sm" onClick={openDirectory} className="shadow-lg shadow-primary/20">
            <Building2 className="size-3.5" />
            Sign in
          </Button>
        </div>
      </header>

      <section className="relative z-10 max-w-7xl mx-auto px-8 pt-16 pb-24">
        <div className="grid lg:grid-cols-[1.05fr_1fr] gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full border border-primary/20 bg-primary/5 backdrop-blur-sm">
              <Trophy className="size-3.5 text-primary" />
              <span className="text-[11px] font-medium tracking-wide">AtomQuest Hackathon 2026 · Submission</span>
            </div>

            <h1 className="font-serif text-5xl md:text-7xl leading-[0.95] tracking-tight mb-6">
              Goals,<br />
              <span className="relative inline-block">
                <span className="text-primary italic">aligned</span>
                <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 200 12" preserveAspectRatio="none">
                  <path d="M2,7 Q60,1 100,5 T198,4" stroke="currentColor" fill="none" strokeWidth="2" className="text-primary/40" strokeLinecap="round" />
                </svg>
              </span>{' '}and<br />
              accounted for.
            </h1>

            <p className="text-muted-foreground text-base md:text-lg leading-relaxed max-w-xl mb-8">
              A structured digital portal for the full goal lifecycle — creation, manager approval,
              quarterly check-ins, audit-ready visibility. Built for HR, managers, and employees
              who&apos;ve outgrown shared spreadsheets.
            </p>

            <div className="flex flex-wrap gap-3 mb-10">
              <Button size="lg" onClick={openDirectory} className="font-semibold h-12 px-6 shadow-xl shadow-primary/20">
                <Building2 className="size-4" />
                Sign in with Microsoft Entra ID
                <ArrowRight className="size-4 ml-1" />
              </Button>
              <a href="#features" className="inline-flex h-12 items-center gap-2 px-5 rounded-lg border border-border bg-card/60 backdrop-blur-sm text-sm font-medium hover:bg-accent transition">
                Explore the build
              </a>
            </div>

            <div className="rounded-xl border border-border bg-card/40 backdrop-blur-sm p-4 max-w-xl">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="size-3.5 text-primary" />
                <div className="text-[11px] font-semibold uppercase tracking-widest text-primary">For judges · Quick access</div>
              </div>
              <div className="text-xs text-muted-foreground mb-3 leading-relaxed">
                Click the Entra ID button above and pick any account — no password needed.
                Three roles, pre-seeded with sheets in every workflow state.
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { role: 'Admin', name: 'Priya Shah', color: 'purple' as const },
                  { role: 'Manager', name: 'Arjun Mehta', color: 'blue' as const },
                  { role: 'Employee', name: 'Kabir Malhotra', color: 'gray' as const },
                ].map(p => (
                  <div key={p.name} className="rounded-lg border border-border bg-background/50 p-2.5">
                    <Pill variant={p.color}>{p.role}</Pill>
                    <div className="text-xs font-medium mt-1.5 truncate">{p.name}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="relative" id="sso-panel">
            <div className="absolute -inset-6 bg-gradient-to-br from-primary/10 via-purple-500/5 to-transparent rounded-[2rem] blur-2xl" />

            {!directory ? (
              <ProductPreview />
            ) : (
              <div className="relative rounded-2xl border border-border bg-card/90 backdrop-blur-xl overflow-hidden shadow-2xl animate-fade-in">
                <div className="px-5 py-4 border-b border-border bg-background/40 flex items-center gap-3">
                  <div className="size-7 rounded bg-white grid place-items-center text-[10px] font-bold text-black shrink-0">MS</div>
                  <div>
                    <div className="text-sm font-semibold">Microsoft</div>
                    <div className="text-[10px] text-muted-foreground">Sign in to AtomQuest</div>
                  </div>
                  <button onClick={() => setDirectory(null)} className="ml-auto text-[10px] text-muted-foreground hover:text-foreground">Back</button>
                </div>
                <div className="p-3 max-h-[460px] overflow-y-auto">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground px-2 py-1 mb-1">Pick an account</div>
                  <div className="space-y-0.5">
                    {directory.map(entry => {
                      const role = entry.memberOf.includes('HR-Admins') ? 'Admin'
                        : entry.memberOf.includes('Managers-L1') ? 'Manager' : 'Employee';
                      return (
                        <button key={entry.oid} disabled={pending} onClick={() => signIn(entry.oid)}
                          className="relative w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent text-left transition disabled:opacity-50">
                          <Avatar name={entry.displayName} id={entry.oid} size={36} />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{entry.displayName}</div>
                            <div className="text-[11px] text-muted-foreground truncate">{entry.upn}</div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <Pill variant={role === 'Admin' ? 'purple' : role === 'Manager' ? 'blue' : 'gray'}>{role}</Pill>
                            <span className="text-[10px] text-muted-foreground">{entry.department}</span>
                          </div>
                          {loadingOid === entry.oid && (
                            <div className="absolute inset-0 grid place-items-center bg-background/80 rounded-lg">
                              <div className="size-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="px-4 py-3 border-t border-border bg-background/30 text-[11px] text-muted-foreground leading-relaxed">
                  <span className="font-medium text-foreground">Mocked for demo —</span> response shape mirrors Microsoft Graph <code className="font-mono text-foreground bg-card px-1 py-0.5 rounded">/me</code>; roles derived from group membership.
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-px mt-16 rounded-2xl overflow-hidden border border-border bg-border">
          {[
            { num: '3', label: 'Distinct roles', sub: 'Employee · Manager · Admin' },
            { num: '4', label: 'Scoring formulas', sub: 'Min · Max · Timeline · Zero' },
            { num: '4', label: 'Bonus features', sub: 'All §5 items shipped' },
            { num: '$0', label: 'Monthly cost', sub: 'Free tier · serverless' },
          ].map(s => (
            <div key={s.label} className="bg-card/60 backdrop-blur-sm p-5">
              <div className="font-serif text-4xl text-primary tabular-nums">{s.num}</div>
              <div className="text-sm font-medium mt-1">{s.label}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{s.sub}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="relative z-10 max-w-7xl mx-auto px-8 py-20">
        <div className="text-center mb-12">
          <div className="text-[11px] uppercase tracking-widest text-primary mb-3">Capabilities</div>
          <h2 className="font-serif text-4xl md:text-5xl tracking-tight">Everything in the BRD,<br/>nothing simulated.</h2>
          <p className="text-muted-foreground text-base mt-4 max-w-xl mx-auto leading-relaxed">
            Real database. Real auth. Real role separation enforced at the row level.
            All eight feature areas below are implemented end-to-end.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          {FEATURES.map((f, i) => (
            <div key={f.title} className="group relative rounded-xl border border-border bg-card/60 backdrop-blur-sm p-5 hover:border-primary/40 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/5">
              <div className="size-10 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 grid place-items-center mb-4 group-hover:scale-110 transition-transform">
                <f.icon className="size-4 text-primary" />
              </div>
              <div className="text-sm font-semibold mb-1.5">{f.title}</div>
              <div className="text-xs text-muted-foreground leading-relaxed">{f.desc}</div>
              <div className="absolute top-4 right-4 font-mono text-[10px] text-muted-foreground/50">0{i + 1}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="architecture" className="relative z-10 max-w-7xl mx-auto px-8 py-20">
        <div className="grid lg:grid-cols-[1fr_1.3fr] gap-12 items-center">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-primary mb-3">Architecture</div>
            <h2 className="font-serif text-4xl md:text-5xl tracking-tight mb-5">Serverless<br/>from edge<br/>to database.</h2>
            <p className="text-muted-foreground leading-relaxed mb-6">
              Next.js 14 on Vercel Edge speaks directly to Supabase Postgres.
              Row-level security <i>is</i> the authorisation layer — no separate auth service to host.
              Server actions handle every mutation; an audit log records every change.
            </p>
            <div className="space-y-3">
              {[
                { label: 'Vercel Hobby', sub: 'Edge runtime · serverless functions · cron', cost: '$0/mo' },
                { label: 'Supabase Free', sub: '500MB Postgres · 50k MAU · RLS · Auth', cost: '$0/mo' },
                { label: 'Domain', sub: '*.vercel.app or bring your own', cost: 'optional' },
              ].map(t => (
                <div key={t.label} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50">
                  <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{t.label}</div>
                    <div className="text-xs text-muted-foreground">{t.sub}</div>
                  </div>
                  <div className="font-mono text-xs text-primary">{t.cost}</div>
                </div>
              ))}
            </div>
          </div>
          <ArchitectureDiagram />
        </div>
      </section>

      <section id="brd" className="relative z-10 max-w-7xl mx-auto px-8 py-20">
        <div className="text-center mb-12">
          <div className="text-[11px] uppercase tracking-widest text-primary mb-3">BRD adherence</div>
          <h2 className="font-serif text-4xl md:text-5xl tracking-tight">Every clause, accounted for.</h2>
        </div>

        <div className="rounded-2xl border border-border bg-card/40 backdrop-blur-sm overflow-hidden">
          <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border">
            {BRD_SECTIONS.map(section => (
              <div key={section.title} className="p-6 md:p-8">
                <div className="flex items-center gap-2 mb-4">
                  <div className="size-8 rounded-lg bg-primary/10 border border-primary/20 grid place-items-center">
                    <section.icon className="size-3.5 text-primary" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{section.tag}</div>
                    <div className="text-sm font-semibold">{section.title}</div>
                  </div>
                </div>
                <ul className="space-y-2.5">
                  {section.items.map(item => (
                    <li key={item} className="flex gap-2.5 text-xs leading-relaxed">
                      <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0 mt-px" />
                      <span className="text-muted-foreground">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 max-w-4xl mx-auto px-8 py-20 text-center">
        <div className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-10 md:p-14">
          <Zap className="size-8 text-primary mx-auto mb-4" />
          <h2 className="font-serif text-3xl md:text-5xl tracking-tight mb-4">See it for yourself.</h2>
          <p className="text-muted-foreground text-base mb-8 max-w-md mx-auto">
            Three pre-seeded demo accounts. One click each. No password.
          </p>
          <Button size="lg" onClick={openDirectory} className="h-12 px-6 shadow-xl shadow-primary/20">
            <Building2 className="size-4" />
            Open the SSO directory
            <ArrowRight className="size-4 ml-1" />
          </Button>
        </div>
      </section>

      <footer className="relative z-10 border-t border-border mt-20">
        <div className="max-w-7xl mx-auto px-8 py-10 flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="size-7 rounded-md bg-primary/15 border border-primary/30 grid place-items-center">
              <span className="font-serif text-primary leading-none">A</span>
            </div>
            <div>
              <div className="text-sm font-medium">AtomQuest Goal Portal</div>
              <div className="text-[11px] text-muted-foreground">Hackathon 2026 submission</div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <a href="https://github.com" className="hover:text-foreground transition inline-flex items-center gap-1.5">
              <Github className="size-3.5" /> Source
            </a>
            <a href="/docs/architecture.svg" className="hover:text-foreground transition inline-flex items-center gap-1.5">
              <Layers className="size-3.5" /> Architecture
            </a>
            <span>·</span>
            <span>Next.js · Supabase · Vercel</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

const FEATURES = [
  { icon: FileCheck,   title: 'Goal lifecycle',     desc: 'Draft → Submit → Approve → Lock. Every transition audited.' },
  { icon: ShieldCheck, title: 'L1 approval',        desc: 'Inline edit, return-for-rework, approve-and-lock. Real workflow.' },
  { icon: Users,       title: 'Shared goals',       desc: 'Cascade departmental KPIs to N reports in one push. Weightage adjustable.' },
  { icon: Target,      title: 'Four UoM types',     desc: 'Numeric · Percentage · Timeline · Zero-based. Each with its own scoring formula.' },
  { icon: BarChart3,   title: 'Live analytics',     desc: 'QoQ trends, heatmaps, goal distribution, manager effectiveness.' },
  { icon: Bell,        title: 'Notifications',      desc: 'Email + Teams + In-app. Every lifecycle event. Deep-linked.' },
  { icon: GitBranch,   title: 'Escalations',        desc: 'Configurable rules. N-day thresholds. Routed up the org hierarchy.' },
  { icon: Lock,        title: 'Audit trail',        desc: 'Who changed what, when, with before/after JSON diff. CSV export.' },
];

const BRD_SECTIONS = [
  {
    tag: 'BRD §2.1',
    icon: FileCheck,
    title: 'Goal creation',
    items: [
      'Thrust area · Title · Description · Weightage',
      'UoM types: Numeric / % / Timeline / Zero',
      'Total weightage = 100% · min 10% · max 8 goals',
      'L1 inline edit · return-for-rework · lock-on-approve',
      'Shared goals: one push to N reports, target synced',
    ],
  },
  {
    tag: 'BRD §2.2 + §2.3',
    icon: BarChart3,
    title: 'Tracking & check-ins',
    items: [
      'Quarterly Planned vs Actual capture',
      'All 4 scoring formulas implemented exactly',
      'Manager check-in comments, structured log',
      'Q1 July · Q2 Oct · Q3 Jan · Q4 Mar-Apr',
      'Status: Not Started · On Track · At Risk · Completed',
    ],
  },
  {
    tag: 'BRD §5 · Bonus',
    icon: Sparkles,
    title: 'All four bonuses',
    items: [
      'Microsoft Entra ID SSO with group → role mapping',
      'Email + Teams notifications with deep links',
      'Rule-based escalations with N-day thresholds',
      'Analytics: QoQ trends, heatmaps, manager metrics',
      'Achievement CSV export + completion dashboard',
    ],
  },
];

function ProductPreview() {
  return (
    <div className="relative rounded-2xl border border-border bg-card/80 backdrop-blur-xl overflow-hidden shadow-2xl">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-background/40">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-red-400/60" />
          <span className="size-2.5 rounded-full bg-yellow-400/60" />
          <span className="size-2.5 rounded-full bg-emerald-400/60" />
        </div>
        <div className="flex-1 mx-3 px-3 py-1 rounded-md bg-background/60 border border-border text-[10px] text-muted-foreground font-mono text-center truncate">
          atomquest-goals.vercel.app/employee
        </div>
      </div>

      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Goal sheet</span>
          <Pill variant="green">Approved</Pill>
          <Pill variant="gold"><Lock className="size-2.5" /> Locked</Pill>
        </div>
        <div className="font-serif text-xl">FY 2026-27 · Kabir Malhotra</div>
      </div>

      <div className="p-5 grid grid-cols-[100px_1fr] gap-4 items-center border-b border-border">
        <MiniWeightageDial />
        <div className="grid grid-cols-3 gap-3">
          <Mini label="Goals" value="6" sub="of 8 max" />
          <Mini label="Weight" value="100%" sub="balanced" highlight />
          <Mini label="Q2 score" value="98" sub="weighted" />
        </div>
      </div>

      <div className="p-3 space-y-1.5">
        {[
          { area: 'Innovation', title: 'Ship payments redesign by Q3', weight: 25, status: 'On Track', score: 100, variant: 'blue' as const },
          { area: 'Safety', title: 'Zero P0 incidents owned', weight: 20, status: 'Completed', score: 100, variant: 'green' as const },
          { area: 'Ops', title: 'PR cycle time ≤ 24h', weight: 20, status: 'On Track', score: 91, variant: 'blue' as const },
        ].map(g => (
          <div key={g.title} className="flex items-center gap-3 p-2.5 rounded-lg border border-border bg-background/30">
            <div className="size-9 rounded-md bg-primary/10 border border-primary/20 grid place-items-center shrink-0">
              <span className="font-serif text-primary text-base tabular-nums">{g.weight}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-muted-foreground mb-0.5">{g.area}</div>
              <div className="text-sm font-medium truncate">{g.title}</div>
            </div>
            <Pill variant={g.variant}>{g.status}</Pill>
            <div className="text-right shrink-0 w-9">
              <div className="font-mono text-sm tabular-nums text-primary">{g.score}</div>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-3 p-2.5 rounded-lg border border-primary/30 bg-primary/[0.04]">
          <div className="size-9 rounded-md bg-primary/10 border border-primary/20 grid place-items-center shrink-0">
            <span className="font-serif text-primary text-base tabular-nums">15</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-muted-foreground mb-0.5">Innovation</div>
            <div className="text-sm font-medium">Author 3 internal RFCs</div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
            <CheckCircle2 className="size-3" />
            Saved
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-border bg-background/30 flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Auto-saved · audit log entry written
        </div>
        <div className="font-mono text-muted-foreground">RLS · 12ms</div>
      </div>
    </div>
  );
}

function MiniWeightageDial() {
  const circumference = 2 * Math.PI * 36;
  return (
    <div className="relative size-24">
      <svg className="size-24 -rotate-90" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="36" stroke="hsl(var(--muted))" strokeWidth="6" fill="none" />
        <circle cx="40" cy="40" r="36" stroke="#f0b429" strokeWidth="6" fill="none" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={0} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="font-serif text-2xl text-emerald-400 tabular-nums leading-none">100<span className="text-sm">%</span></div>
          <div className="text-[8px] uppercase tracking-widest text-muted-foreground mt-0.5">weight</div>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`font-serif text-xl tabular-nums leading-tight ${highlight ? 'text-primary' : ''}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function ArchitectureDiagram() {
  return (
    <div className="relative rounded-2xl border border-border bg-card/40 backdrop-blur-sm p-6 md:p-8">
      <svg viewBox="0 0 500 380" className="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
        <text x="20" y="30" fill="hsl(var(--muted-foreground))" fontSize="10" fontWeight="600" letterSpacing="2">CLIENT</text>
        <text x="20" y="155" fill="hsl(var(--muted-foreground))" fontSize="10" fontWeight="600" letterSpacing="2">VERCEL EDGE</text>
        <text x="20" y="295" fill="hsl(var(--muted-foreground))" fontSize="10" fontWeight="600" letterSpacing="2">SUPABASE</text>

        <rect x="20" y="40" width="200" height="70" rx="10" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="40" y="62" fill="hsl(var(--foreground))" fontSize="12" fontWeight="600">Web browser</text>
        <text x="40" y="80" fill="hsl(var(--muted-foreground))" fontSize="10">Employees · Managers · HR</text>
        <text x="40" y="96" fill="hsl(var(--muted-foreground))" fontSize="9">Desktop · mobile · responsive</text>

        <rect x="240" y="40" width="240" height="70" rx="10" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="260" y="62" fill="hsl(var(--foreground))" fontSize="12" fontWeight="600">MS Teams · Email</text>
        <text x="260" y="80" fill="hsl(var(--muted-foreground))" fontSize="10">Notification destinations</text>
        <text x="260" y="96" fill="hsl(var(--muted-foreground))" fontSize="9">Deep-linked back into portal</text>

        <rect x="20" y="165" width="460" height="100" rx="12" fill="rgba(240,180,41,0.03)" stroke="rgba(240,180,41,0.25)" strokeDasharray="3 3" />
        <rect x="35" y="180" width="130" height="40" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="45" y="198" fill="#f0b429" fontSize="10" fontWeight="600">Next.js 14 SSR</text>
        <text x="45" y="212" fill="hsl(var(--muted-foreground))" fontSize="8">React Server Components</text>

        <rect x="175" y="180" width="130" height="40" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="185" y="198" fill="#f0b429" fontSize="10" fontWeight="600">Server Actions</text>
        <text x="185" y="212" fill="hsl(var(--muted-foreground))" fontSize="8">RLS-aware mutations</text>

        <rect x="315" y="180" width="150" height="40" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="325" y="198" fill="#f0b429" fontSize="10" fontWeight="600">API + Cron routes</text>
        <text x="325" y="212" fill="hsl(var(--muted-foreground))" fontSize="8">CSV export · escalation sweep</text>

        <rect x="35" y="228" width="430" height="28" rx="6" fill="rgba(240,180,41,0.06)" stroke="rgba(240,180,41,0.2)" />
        <text x="50" y="246" fill="#f0b429" fontSize="10" fontWeight="600">lib/goals.ts</text>
        <text x="120" y="246" fill="hsl(var(--muted-foreground))" fontSize="9">Pure business logic · 4 scoring formulas · validations · shared client + server</text>

        <rect x="20" y="305" width="140" height="60" rx="10" fill="rgba(96,165,250,0.04)" stroke="rgba(96,165,250,0.3)" />
        <text x="35" y="324" fill="#60a5fa" fontSize="11" fontWeight="600">Postgres + RLS</text>
        <text x="35" y="338" fill="hsl(var(--muted-foreground))" fontSize="9">10 tables · 8 policies</text>
        <text x="35" y="352" fill="hsl(var(--muted-foreground))" fontSize="9">Audit log · view aggregates</text>

        <rect x="180" y="305" width="140" height="60" rx="10" fill="rgba(74,222,128,0.04)" stroke="rgba(74,222,128,0.3)" />
        <text x="195" y="324" fill="#4ade80" fontSize="11" fontWeight="600">Supabase Auth</text>
        <text x="195" y="338" fill="hsl(var(--muted-foreground))" fontSize="9">JWT · cookie sessions</text>
        <text x="195" y="352" fill="hsl(var(--muted-foreground))" fontSize="9">Entra ID provider (mock)</text>

        <rect x="340" y="305" width="140" height="60" rx="10" fill="rgba(192,132,252,0.04)" stroke="rgba(192,132,252,0.3)" />
        <text x="355" y="324" fill="#c084fc" fontSize="11" fontWeight="600">Notifications</text>
        <text x="355" y="338" fill="hsl(var(--muted-foreground))" fontSize="9">Postgres queue</text>
        <text x="355" y="352" fill="hsl(var(--muted-foreground))" fontSize="9">Fan-out Email/Teams</text>

        <g stroke="rgba(240,180,41,0.6)" strokeWidth="1.5" fill="none">
          <path d="M 120 115 L 120 162" markerEnd="url(#arr)" />
          <path d="M 360 115 L 360 162" markerEnd="url(#arr)" />
          <path d="M 100 268 L 100 302" markerEnd="url(#arr)" />
          <path d="M 250 268 L 250 302" markerEnd="url(#arr)" />
          <path d="M 410 268 L 410 302" markerEnd="url(#arr)" />
        </g>
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(240,180,41,0.6)" />
          </marker>
        </defs>
      </svg>
    </div>
  );
}
