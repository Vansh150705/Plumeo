import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Feather, GitBranch, History, LineChart, ShieldCheck, Target, Users } from 'lucide-react';
import { getCtx } from '@/server/auth/request';
import { config } from '@/server/core/config';

export const dynamic = 'force-dynamic';

const FEATURES = [
  { icon: Target, title: 'Goals people can actually measure', body: 'Every goal carries an outcome and measurable key results. Vague goals are caught before they reach a manager.' },
  { icon: GitBranch, title: 'Alignment you can see', body: 'Company, department, team and individual goals connect in one hierarchy, so everyone sees how their work contributes.' },
  { icon: Users, title: 'Approvals that respect your org', body: 'Multi-level approval along your real reporting lines, with delegation, deadlines and no self-approval.' },
  { icon: LineChart, title: 'Check-ins, not status theatre', body: 'Quarterly check-ins with frozen history, manager feedback and follow-ups. Progress is calculated, never guessed.' },
  { icon: History, title: 'A trail that never forgets', body: 'Every decision is written to a tamper-evident audit log, with before-and-after values you can search and export.' },
  { icon: ShieldCheck, title: 'Built for real organisations', body: 'Strict tenant isolation, role-based access, SSO (OIDC) and SCIM provisioning for your identity provider.' },
];

export default async function Landing() {
  if (await getCtx()) redirect('/app');
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2.5"><span className="grid size-9 place-items-center rounded-lg bg-primary"><Feather className="size-5 text-[hsl(var(--gold))]" aria-hidden /></span><span className="font-display text-2xl font-medium">Plumeo</span></Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/login" className="rounded-lg px-3 py-2 text-muted-foreground hover:text-foreground">Sign in</Link>
          {config().allowSignup && <Link href="/signup" className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90">Create a workspace</Link>}
        </nav>
      </header>
      <main>
        <section className="mx-auto max-w-4xl px-6 pb-16 pt-14 text-center sm:pt-24">
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-[hsl(var(--gold))]">Goal management for whole organisations</p>
          <h1 className="font-display text-4xl font-medium leading-[1.08] sm:text-6xl">A lighter, more human way to set, align and track goals.</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">Plumeo runs the full goal lifecycle — drafting, manager approval, alignment, quarterly check-ins and an audit trail that never forgets — in one calm place.</p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href={config().allowSignup ? '/signup' : '/login'} className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">{config().allowSignup ? 'Create a workspace' : 'Sign in'} <ArrowRight className="size-4" aria-hidden /></Link>
            <Link href="/login" className="rounded-lg border border-border bg-card px-6 py-3 text-sm font-medium hover:bg-accent">Sign in</Link>
          </div>
        </section>
        <section aria-label="Features" className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-border bg-card p-6">
              <span className="mb-4 grid size-10 place-items-center rounded-lg bg-accent"><f.icon className="size-5 text-[hsl(var(--gold))]" aria-hidden /></span>
              <h2 className="text-base font-semibold">{f.title}</h2><p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </section>
      </main>
      <footer className="border-t border-border px-6 py-6 text-center text-xs text-muted-foreground">Plumeo · open source (MIT)</footer>
    </div>
  );
}
