'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { getMockDirectory, ssoSignIn } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Pill } from '@/components/ui/pill';
import {
  ShieldCheck, Users, BarChart3, GitBranch, Bell, FileCheck,
  Layers, Building2, ArrowRight, Github, Atom,
  CheckCircle2, Lock, Target, Zap, MoveRight,
} from 'lucide-react';

type Entry = Awaited<ReturnType<typeof getMockDirectory>>[number];

// fade things in as they scroll into view. tag an element with .ls-reveal and
// it'll get .ls-in once it's on screen. falls back to "just show everything"
// if the browser has no IntersectionObserver.
function useScrollReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.ls-reveal'));
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('ls-in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('ls-in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

// the stat numbers tick up from zero the first time you scroll to them.
// respects reduced-motion (just snaps to the final value).
function CountUp({ to, suffix = '', prefix = '', duration = 1600 }: {
  to: number; suffix?: string; prefix?: string; duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [val, setVal] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setVal(to); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting && !done.current) {
          done.current = true;
          const start = performance.now();
          const tick = (now: number) => {
            const p = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            setVal(Math.round(to * eased));
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      });
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [to, duration]);

  return <span ref={ref} className="tabular-nums">{prefix}{val}{suffix}</span>;
}

export function LandingClient() {
  const [directory, setDirectory] = useState<Entry[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [loadingOid, setLoadingOid] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  useScrollReveal();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // make the atom drift toward the cursor a little — feels alive without being distracting
  function onHeroMove(e: React.MouseEvent) {
    const stage = stageRef.current;
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
    const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
    stage.style.transform = `translate(${dx * 14}px, ${dy * 14}px)`;
  }
  function onHeroLeave() {
    if (stageRef.current) stageRef.current.style.transform = '';
  }

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
    <div className="landing-scope min-h-screen font-sans">
      {/* background wash + grid + a couple of slow-drifting colour blobs */}
      <div className="ls-mesh pointer-events-none absolute inset-0" />
      <div className="ls-grid pointer-events-none absolute inset-x-0 top-0 h-[760px]" />
      <div className="ls-blob hidden md:block" style={{ top: '-80px', left: '8%', width: 360, height: 360, background: 'hsl(38 96% 56% / 0.16)' }} />
      <div className="ls-blob hidden md:block" style={{ top: '480px', right: '4%', width: 420, height: 420, background: 'hsl(204 84% 62% / 0.07)', animationDelay: '-6s' }} />

      {/* nav — stays transparent until you scroll, then gets the frosted bar */}
      <header className={`sticky top-0 z-50 transition-all duration-300 ${scrolled ? 'border-b border-border/70 bg-white/80 backdrop-blur-xl' : 'border-b border-transparent'}`}>
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5 md:px-8">
          <a href="#top" className="group flex items-center gap-2.5">
            <span className="relative grid size-9 place-items-center rounded-xl border border-primary/40 bg-gradient-to-br from-primary/20 to-primary/5 shadow-sm shadow-primary/20">
              <Atom className="size-5 text-primary transition-transform duration-700 group-hover:rotate-180" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold tracking-tight">AtomQuest</span>
              <span className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Goal Portal</span>
            </span>
          </a>
          <nav className="hidden items-center gap-1 md:flex">
            {[['Capabilities', '#features'], ['How it works', '#how'], ['Architecture', '#architecture']].map(([label, href]) => (
              <a key={href} href={href} className="rounded-md px-3 py-1.5 text-[13px] text-muted-foreground transition hover:bg-accent hover:text-foreground">{label}</a>
            ))}
            <a href="https://github.com/Vansh150705/atomquest-goals" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] text-muted-foreground transition hover:bg-accent hover:text-foreground">
              <Github className="size-3.5" /> GitHub
            </a>
          </nav>
          <Button size="sm" onClick={openDirectory} className="shadow-md shadow-primary/20">
            <Building2 className="size-3.5" /> Sign in
          </Button>
        </div>
      </header>

      {/* hero */}
      <section id="top" className="relative z-10 mx-auto max-w-7xl px-6 pb-24 pt-14 md:px-8 md:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="ls-reveal mb-7 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.06] px-3.5 py-1.5">
              <span className="ls-blink size-1.5 rounded-full bg-primary" />
              <span className="text-[11px] font-medium tracking-wide text-foreground/80">Goal alignment, without the spreadsheet sprawl</span>
            </div>

            <h1 className="ls-reveal font-serif text-[clamp(2.8rem,6vw,5.2rem)] leading-[0.94] tracking-tight" style={{ ['--rd' as string]: '60ms' }}>
              Goals,{' '}
              <span className="relative inline-block">
                <span className="ls-gold-text italic">aligned</span>
                <svg className="ls-draw absolute -bottom-2 left-0 w-full" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden>
                  <path d="M2,7 Q60,1 100,5 T198,4" stroke="currentColor" fill="none" strokeWidth="2.5" className="text-primary/50" strokeLinecap="round" />
                </svg>
              </span>
              <br />and accounted for.
            </h1>

            <p className="ls-reveal mt-7 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg" style={{ ['--rd' as string]: '120ms' }}>
              A structured portal for the entire goal lifecycle — creation, manager approval,
              quarterly check-ins, and audit-ready visibility. Built for teams who&apos;ve outgrown
              shared spreadsheets and want their objectives to actually compound.
            </p>

            <div className="ls-reveal mt-9 flex flex-wrap items-center gap-3" style={{ ['--rd' as string]: '180ms' }}>
              <Button size="lg" onClick={openDirectory} className="group h-12 px-6 text-[15px] font-semibold shadow-xl shadow-primary/25">
                <Building2 className="size-4" />
                Sign in with Microsoft
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
              <a href="#how" className="inline-flex h-12 items-center gap-2 rounded-lg border border-border bg-white px-5 text-sm font-medium transition hover:border-foreground/20 hover:bg-accent">
                See how it works <MoveRight className="size-4 text-muted-foreground" />
              </a>
            </div>

            <div className="ls-reveal mt-10 flex flex-wrap items-center gap-x-7 gap-y-3 text-[13px] text-muted-foreground" style={{ ['--rd' as string]: '240ms' }}>
              {['Row-level security', 'Immutable audit log', 'Zero-cost infra'].map((t) => (
                <span key={t} className="inline-flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-500" /> {t}
                </span>
              ))}
            </div>
          </div>

          {/* right side shows the spinning atom by default, swaps to the MS
              account picker once you hit "sign in". both share this slot. */}
          <div id="sso-panel" className="relative" onMouseMove={onHeroMove} onMouseLeave={onHeroLeave}>
            {!directory ? (
              <OrbitalAtom stageRef={stageRef} />
            ) : (
              <SsoPanel
                directory={directory}
                pending={pending}
                loadingOid={loadingOid}
                onPick={signIn}
                onBack={() => setDirectory(null)}
              />
            )}
          </div>
        </div>

        {/* the four headline numbers */}
        <div className="ls-reveal mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-4">
          {[
            { node: <CountUp to={3} />, label: 'Distinct roles', sub: 'Employee · Manager · Admin' },
            { node: <CountUp to={4} />, label: 'Scoring formulas', sub: 'Min · Max · Timeline · Zero' },
            { node: <CountUp to={100} suffix="%" />, label: 'Weightage enforced', sub: 'Client + server validated' },
            { node: <CountUp to={50} suffix="K" />, label: 'MAU on free tier', sub: 'Serverless · $0 / month' },
          ].map((s) => (
            <div key={s.label} className="bg-white px-5 py-6">
              <div className="font-serif text-4xl text-primary md:text-5xl">{s.node}</div>
              <div className="mt-1.5 text-sm font-medium">{s.label}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{s.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* scrolling ticker of feature names — duplicated once so the loop is seamless */}
      <div className="ls-marquee relative z-10 overflow-hidden border-y border-border bg-white py-4">
        <div className="ls-marquee-track">
          {[0, 1].map((dup) => (
            <div key={dup} className="flex shrink-0 items-center" aria-hidden={dup === 1}>
              {MARQUEE.map((m) => (
                <span key={m} className="mx-7 inline-flex items-center gap-2.5 text-sm font-medium text-foreground/55">
                  <span className="size-1.5 rounded-full bg-primary/60" /> {m}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* the eight things the app actually does */}
      <section id="features" className="relative z-10 mx-auto max-w-7xl px-6 py-24 md:px-8">
        <div className="ls-reveal mx-auto mb-14 max-w-2xl text-center">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">Capabilities</div>
          <h2 className="font-serif text-4xl tracking-tight md:text-[3.25rem] md:leading-[1.05]">
            Everything the workflow needs,<br /><span className="ls-gold-text">nothing it doesn&apos;t.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-lg leading-relaxed text-muted-foreground">
            Real database, real auth, real role separation enforced at the row level.
            Eight feature areas, implemented end-to-end.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className="ls-reveal ls-card group relative overflow-hidden rounded-2xl border border-border bg-white p-6 hover:border-primary/40 hover:shadow-[0_24px_60px_-30px_rgba(180,118,8,0.45)]"
              style={{ ['--rd' as string]: `${(i % 4) * 70}ms` }}
            >
              <div className="absolute -right-10 -top-10 size-24 rounded-full bg-primary/[0.05] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              <div className="relative mb-5 grid size-11 place-items-center rounded-xl border border-primary/25 bg-gradient-to-br from-primary/15 to-primary/[0.03] transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6">
                <f.icon className="size-5 text-primary" />
              </div>
              <div className="relative mb-1.5 text-[15px] font-semibold tracking-tight">{f.title}</div>
              <div className="relative text-[13px] leading-relaxed text-muted-foreground">{f.desc}</div>
              <div className="absolute right-5 top-5 font-mono text-[11px] tabular-nums text-foreground/15">{String(i + 1).padStart(2, '0')}</div>
            </div>
          ))}
        </div>
      </section>

      {/* the three-step story next to a fake-but-real-looking goal sheet */}
      <section id="how" className="relative z-10 mx-auto max-w-7xl px-6 py-24 md:px-8">
        <div className="grid items-center gap-14 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="ls-reveal">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">How it works</div>
            <h2 className="font-serif text-4xl tracking-tight md:text-[3rem] md:leading-[1.06]">
              Three roles.<br />One source of truth.
            </h2>
            <p className="mt-5 max-w-md leading-relaxed text-muted-foreground">
              Every goal moves through the same disciplined path — and every transition
              after lock is captured in an immutable audit trail.
            </p>

            <div className="mt-9 space-y-2">
              {STEPS.map((s, i) => (
                <div key={s.title} className="group flex gap-4 rounded-xl border border-transparent p-3 transition hover:border-border hover:bg-white">
                  <div className="flex flex-col items-center">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 font-serif text-base text-primary">{i + 1}</span>
                    {i < STEPS.length - 1 && <span className="mt-1 w-px flex-1 bg-gradient-to-b from-primary/30 to-transparent" />}
                  </div>
                  <div className="pb-3">
                    <div className="flex items-center gap-2 text-[15px] font-semibold">
                      <s.icon className="size-4 text-primary" /> {s.title}
                    </div>
                    <div className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="ls-reveal" style={{ ['--rd' as string]: '120ms' }}>
            <ProductPreview />
          </div>
        </div>
      </section>

      {/* how it's wired up + the $0 hosting story */}
      <section id="architecture" className="relative z-10 mx-auto max-w-7xl px-6 py-24 md:px-8">
        <div className="grid items-center gap-14 lg:grid-cols-[1fr_1.25fr]">
          <div className="ls-reveal">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">Architecture</div>
            <h2 className="mb-5 font-serif text-4xl tracking-tight md:text-[3rem] md:leading-[1.05]">
              Serverless,<br />edge to database.
            </h2>
            <p className="mb-7 max-w-md leading-relaxed text-muted-foreground">
              Next.js on Vercel speaks directly to Supabase Postgres. Row-level security
              <i> is</i> the authorisation layer — no separate auth service to host.
              Server actions handle every mutation; an audit log records every change.
            </p>
            <div className="space-y-2.5">
              {[
                { label: 'Vercel Hobby', sub: 'Edge runtime · serverless · cron', cost: '$0/mo' },
                { label: 'Supabase Free', sub: '500MB Postgres · 50k MAU · RLS', cost: '$0/mo' },
                { label: 'Custom domain', sub: 'Bring your own or *.vercel.app', cost: 'optional' },
              ].map((t) => (
                <div key={t.label} className="flex items-center gap-3 rounded-xl border border-border bg-white p-3.5">
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t.label}</div>
                    <div className="text-xs text-muted-foreground">{t.sub}</div>
                  </div>
                  <div className="font-mono text-xs text-primary">{t.cost}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="ls-reveal" style={{ ['--rd' as string]: '120ms' }}>
            <ArchitectureDiagram />
          </div>
        </div>
      </section>

      {/* last nudge to go try the demo */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 py-24 md:px-8">
        <div className="ls-reveal relative overflow-hidden rounded-[2rem] border border-primary/25 bg-gradient-to-br from-primary/[0.08] via-primary/[0.03] to-transparent p-10 text-center md:p-16">
          <div className="ls-mesh pointer-events-none absolute inset-0 opacity-70" />
          <div className="relative">
            <span className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl border border-primary/30 bg-white shadow-lg shadow-primary/20">
              <Zap className="size-7 text-primary" />
            </span>
            <h2 className="font-serif text-4xl tracking-tight md:text-[3.5rem] md:leading-[1.04]">See it for yourself.</h2>
            <p className="mx-auto mt-4 max-w-md text-muted-foreground">
              Pre-seeded accounts across every role and workflow state. One click each — no password.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button size="lg" onClick={openDirectory} className="h-12 px-7 text-[15px] font-semibold shadow-xl shadow-primary/25">
                <Building2 className="size-4" /> Open the directory <ArrowRight className="size-4" />
              </Button>
              <a href="https://github.com/Vansh150705/atomquest-goals" target="_blank" rel="noreferrer" className="inline-flex h-12 items-center gap-2 rounded-lg border border-border bg-white px-6 text-sm font-medium transition hover:bg-accent">
                <Github className="size-4" /> View source
              </a>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
              {[
                { role: 'Admin', name: 'Priya Shah', v: 'purple' as const },
                { role: 'Manager', name: 'Arjun Mehta', v: 'blue' as const },
                { role: 'Employee', name: 'Kabir Malhotra', v: 'gray' as const },
              ].map((p) => (
                <div key={p.name} className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-3 py-1.5">
                  <Pill variant={p.v}>{p.role}</Pill>
                  <span className="text-xs font-medium">{p.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="relative z-10 border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6 px-6 py-10 md:px-8">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl border border-primary/30 bg-primary/10">
              <Atom className="size-5 text-primary" />
            </span>
            <div>
              <div className="text-sm font-semibold">AtomQuest Goal Portal</div>
              <div className="text-[11px] text-muted-foreground">Goal setting &amp; tracking, done right</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-xs text-muted-foreground">
            <a href="https://github.com/Vansh150705/atomquest-goals" className="inline-flex items-center gap-1.5 transition hover:text-foreground">
              <Github className="size-3.5" /> Source
            </a>
            <a href="/docs/architecture.svg" className="inline-flex items-center gap-1.5 transition hover:text-foreground">
              <Layers className="size-3.5" /> Architecture
            </a>
            <span className="text-foreground/30">·</span>
            <span>Next.js · Supabase · Vercel</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// the spinning atom in the hero. it's the AtomQuest "logo" idea taken literally:
// a nucleus showing the 100% weightage, with goal statuses orbiting it like electrons.
function OrbitalAtom({ stageRef }: { stageRef: React.RefObject<HTMLDivElement> }) {
  return (
    <div className="relative mx-auto w-full max-w-[440px]">
      <div className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-primary/[0.06] blur-3xl" />
      <div ref={stageRef} className="transition-transform duration-300 ease-out">
        <div className="ls-stage ls-stage-float">
          {/* the classic three-ellipse atom symbol sitting behind everything, turning slowly */}
          <svg viewBox="0 0 400 400" className="absolute inset-0 size-full" style={{ animation: 'ls-spin 60s linear infinite' }} aria-hidden>
            {[0, 60, 120].map((deg) => (
              <ellipse key={deg} cx="200" cy="200" rx="190" ry="74" fill="none"
                stroke="hsl(36 90% 50% / 0.16)" strokeWidth="1.25"
                transform={`rotate(${deg} 200 200)`} />
            ))}
          </svg>

          {/* three rings, each carrying one status chip around the nucleus */}
          <Orbit ins="6%"  d="26s">
            <Electron color="#1d9e6e" label="On Track" dot />
          </Orbit>
          <Orbit ins="20%" d="19s" rev>
            <Electron color="#2b7fff" label="Q2 check-in" dot />
          </Orbit>
          <Orbit ins="34%" d="13s">
            <Electron color="#b9760a" label="Approved" dot />
          </Orbit>

          {/* the nucleus in the middle */}
          <div className="absolute inset-0 grid place-items-center">
            <div className="relative">
              <div className="ls-pulse-ring absolute -inset-5 rounded-full bg-primary/15 blur-md" />
              <div className="relative grid size-32 place-items-center rounded-full border border-primary/30 bg-white text-center shadow-[0_20px_50px_-20px_rgba(180,118,8,0.5)]">
                <div>
                  <div className="font-serif text-4xl leading-none text-primary">
                    100<span className="text-xl">%</span>
                  </div>
                  <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Weightage</div>
                </div>
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-600">
                  Balanced
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* couple of little cards that float off the edges for depth (desktop only) */}
      <div className="ls-stage-float absolute -right-2 top-4 hidden rounded-xl border border-border bg-white/90 p-3 shadow-xl backdrop-blur-sm sm:block" style={{ animationDelay: '-2s' }}>
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-emerald-500/10"><BarChart3 className="size-3.5 text-emerald-600" /></span>
          <div>
            <div className="text-[10px] text-muted-foreground">Q2 score</div>
            <div className="font-serif text-lg leading-none text-foreground">98</div>
          </div>
        </div>
      </div>
      <div className="ls-stage-float absolute -left-3 bottom-8 hidden rounded-xl border border-border bg-white/90 p-3 shadow-xl backdrop-blur-sm sm:block" style={{ animationDelay: '-4s' }}>
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-primary/10"><Lock className="size-3.5 text-primary" /></span>
          <div>
            <div className="text-[10px] text-muted-foreground">Sheet</div>
            <div className="text-[13px] font-semibold leading-none">Locked</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Orbit({ ins, d, rev, children }: { ins: string; d: string; rev?: boolean; children: React.ReactNode }) {
  return (
    <>
      <div className="absolute rounded-full border border-dashed border-foreground/[0.09]" style={{ inset: ins }} />
      <div className={`ls-arm${rev ? ' rev' : ''}`} style={{ ['--ins' as string]: ins, ['--d' as string]: d }}>
        <div className="ls-chip-pos">
          <div className="ls-chip" style={{ ['--d' as string]: d }}>{children}</div>
        </div>
      </div>
    </>
  );
}

function Electron({ color, label, dot }: { color: string; label: string; dot?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-white px-2.5 py-1 text-[11px] font-medium shadow-md"
      style={{ borderColor: `${color}40`, color }}>
      {dot && <span className="size-1.5 rounded-full" style={{ background: color }} />}
      {label}
    </span>
  );
}

// the actual Microsoft account picker. this is the real sign-in flow, not decoration —
// picking a tile calls ssoSignIn() and drops you into the right dashboard.
function SsoPanel({ directory, pending, loadingOid, onPick, onBack }: {
  directory: Entry[];
  pending: boolean;
  loadingOid: string | null;
  onPick: (oid: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="relative animate-fade-in">
      <div className="pointer-events-none absolute -inset-5 rounded-[2rem] bg-primary/10 blur-2xl" />
      <div className="relative overflow-hidden rounded-2xl border border-border bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border bg-secondary/60 px-5 py-4">
          <span className="grid size-7 shrink-0 place-items-center rounded bg-foreground text-[10px] font-bold text-white">MS</span>
          <div>
            <div className="text-sm font-semibold">Microsoft</div>
            <div className="text-[10px] text-muted-foreground">Sign in to AtomQuest</div>
          </div>
          <button onClick={onBack} className="ml-auto text-[11px] text-muted-foreground transition hover:text-foreground">← Back</button>
        </div>
        <div className="max-h-[460px] overflow-y-auto p-3">
          <div className="mb-1 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Pick an account</div>
          <div className="space-y-0.5">
            {directory.map((entry) => {
              const role = entry.memberOf.includes('HR-Admins') ? 'Admin'
                : entry.memberOf.includes('Managers-L1') ? 'Manager' : 'Employee';
              return (
                <button key={entry.oid} disabled={pending} onClick={() => onPick(entry.oid)}
                  className="relative flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition hover:bg-accent disabled:opacity-50">
                  <Avatar name={entry.displayName} id={entry.oid} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{entry.displayName}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{entry.upn}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Pill variant={role === 'Admin' ? 'purple' : role === 'Manager' ? 'blue' : 'gray'}>{role}</Pill>
                    <span className="text-[10px] text-muted-foreground">{entry.department}</span>
                  </div>
                  {loadingOid === entry.oid && (
                    <div className="absolute inset-0 grid place-items-center rounded-lg bg-white/80">
                      <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="border-t border-border bg-secondary/40 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Mocked for demo —</span> response shape mirrors Microsoft Graph{' '}
          <code className="rounded bg-accent px-1 py-0.5 font-mono text-foreground">/me</code>; roles derived from group membership.
        </div>
      </div>
    </div>
  );
}

// a mock of the employee goal-sheet screen. numbers are hand-picked to look
// like a real, healthy sheet (100% weight, a couple of completed goals).
function ProductPreview() {
  return (
    <div className="ls-card relative overflow-hidden rounded-2xl border border-border bg-white shadow-[0_40px_80px_-40px_rgba(24,20,8,0.25)] hover:shadow-[0_50px_90px_-40px_rgba(180,118,8,0.35)]">
      <div className="flex items-center gap-2 border-b border-border bg-secondary/50 px-4 py-3">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-red-400/70" />
          <span className="size-2.5 rounded-full bg-amber-400/70" />
          <span className="size-2.5 rounded-full bg-emerald-400/70" />
        </div>
        <div className="mx-3 flex-1 truncate rounded-md border border-border bg-white px-3 py-1 text-center font-mono text-[10px] text-muted-foreground">
          atomquest-goals.vercel.app/employee
        </div>
      </div>

      <div className="border-b border-border px-5 py-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Goal sheet</span>
          <Pill variant="green">Approved</Pill>
          <Pill variant="gold"><Lock className="size-2.5" /> Locked</Pill>
        </div>
        <div className="font-serif text-xl">FY 2026-27 · Kabir Malhotra</div>
      </div>

      <div className="grid grid-cols-[100px_1fr] items-center gap-4 border-b border-border p-5">
        <MiniWeightageDial />
        <div className="grid grid-cols-3 gap-3">
          <Mini label="Goals" value="6" sub="of 8 max" />
          <Mini label="Weight" value="100%" sub="balanced" highlight />
          <Mini label="Q2 score" value="98" sub="weighted" />
        </div>
      </div>

      <div className="space-y-1.5 p-3">
        {[
          { area: 'Innovation', title: 'Ship payments redesign by Q3', weight: 25, status: 'On Track', score: 100, variant: 'blue' as const },
          { area: 'Safety', title: 'Zero P0 incidents owned', weight: 20, status: 'Completed', score: 100, variant: 'green' as const },
          { area: 'Ops', title: 'PR cycle time ≤ 24h', weight: 20, status: 'On Track', score: 91, variant: 'blue' as const },
        ].map((g) => (
          <div key={g.title} className="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 p-2.5">
            <div className="grid size-9 shrink-0 place-items-center rounded-md border border-primary/20 bg-primary/10">
              <span className="font-serif text-base tabular-nums text-primary">{g.weight}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 text-[10px] text-muted-foreground">{g.area}</div>
              <div className="truncate text-sm font-medium">{g.title}</div>
            </div>
            <Pill variant={g.variant}>{g.status}</Pill>
            <div className="w-9 shrink-0 text-right font-mono text-sm tabular-nums text-primary">{g.score}</div>
          </div>
        ))}
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/[0.05] p-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-md border border-primary/20 bg-primary/10">
            <span className="font-serif text-base tabular-nums text-primary">15</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 text-[10px] text-muted-foreground">Innovation</div>
            <div className="text-sm font-medium">Author 3 internal RFCs</div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-600">
            <CheckCircle2 className="size-3" /> Saved
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border bg-secondary/30 px-4 py-3 text-[10px]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
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
        <circle cx="40" cy="40" r="36" stroke="hsl(30 10% 90%)" strokeWidth="6" fill="none" />
        <circle cx="40" cy="40" r="36" stroke="hsl(36 94% 46%)" strokeWidth="6" fill="none" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={0} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="font-serif text-2xl leading-none tabular-nums text-emerald-600">100<span className="text-sm">%</span></div>
          <div className="mt-0.5 text-[8px] uppercase tracking-[0.18em] text-muted-foreground">weight</div>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={`font-serif text-xl leading-tight tabular-nums ${highlight ? 'text-primary' : ''}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}

// hand-drawn SVG of the stack (client -> vercel -> supabase). light-theme colours
// so it sits on white. kept as inline SVG so it scales and themes cleanly.
function ArchitectureDiagram() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-white p-6 shadow-[0_30px_70px_-40px_rgba(24,20,8,0.25)] md:p-8">
      <svg viewBox="0 0 500 380" className="h-auto w-full" xmlns="http://www.w3.org/2000/svg">
        <text x="20" y="30" fill="hsl(24 7% 45%)" fontSize="10" fontWeight="600" letterSpacing="2">CLIENT</text>
        <text x="20" y="155" fill="hsl(24 7% 45%)" fontSize="10" fontWeight="600" letterSpacing="2">VERCEL EDGE</text>
        <text x="20" y="295" fill="hsl(24 7% 45%)" fontSize="10" fontWeight="600" letterSpacing="2">SUPABASE</text>

        <rect x="20" y="40" width="200" height="70" rx="10" fill="#fff" stroke="hsl(28 12% 88%)" />
        <text x="40" y="62" fill="hsl(24 16% 12%)" fontSize="12" fontWeight="600">Web browser</text>
        <text x="40" y="80" fill="hsl(24 7% 45%)" fontSize="10">Employees · Managers · HR</text>
        <text x="40" y="96" fill="hsl(24 7% 45%)" fontSize="9">Desktop · mobile · responsive</text>

        <rect x="240" y="40" width="240" height="70" rx="10" fill="#fff" stroke="hsl(28 12% 88%)" />
        <text x="260" y="62" fill="hsl(24 16% 12%)" fontSize="12" fontWeight="600">MS Teams · Email</text>
        <text x="260" y="80" fill="hsl(24 7% 45%)" fontSize="10">Notification destinations</text>
        <text x="260" y="96" fill="hsl(24 7% 45%)" fontSize="9">Deep-linked back into portal</text>

        <rect x="20" y="165" width="460" height="100" rx="12" fill="hsl(36 90% 50% / 0.04)" stroke="hsl(36 90% 50% / 0.3)" strokeDasharray="3 3" />
        <rect x="35" y="180" width="130" height="40" rx="6" fill="#fff" stroke="hsl(28 12% 88%)" />
        <text x="45" y="198" fill="hsl(32 90% 40%)" fontSize="10" fontWeight="600">Next.js 14 SSR</text>
        <text x="45" y="212" fill="hsl(24 7% 45%)" fontSize="8">React Server Components</text>

        <rect x="175" y="180" width="130" height="40" rx="6" fill="#fff" stroke="hsl(28 12% 88%)" />
        <text x="185" y="198" fill="hsl(32 90% 40%)" fontSize="10" fontWeight="600">Server Actions</text>
        <text x="185" y="212" fill="hsl(24 7% 45%)" fontSize="8">RLS-aware mutations</text>

        <rect x="315" y="180" width="150" height="40" rx="6" fill="#fff" stroke="hsl(28 12% 88%)" />
        <text x="325" y="198" fill="hsl(32 90% 40%)" fontSize="10" fontWeight="600">API + Cron routes</text>
        <text x="325" y="212" fill="hsl(24 7% 45%)" fontSize="8">CSV export · escalation sweep</text>

        <rect x="35" y="228" width="430" height="28" rx="6" fill="hsl(36 90% 50% / 0.08)" stroke="hsl(36 90% 50% / 0.25)" />
        <text x="50" y="246" fill="hsl(32 90% 40%)" fontSize="10" fontWeight="600">lib/goals.ts</text>
        <text x="120" y="246" fill="hsl(24 7% 45%)" fontSize="9">Pure business logic · 4 scoring formulas · validations · shared client + server</text>

        <rect x="20" y="305" width="140" height="60" rx="10" fill="hsl(204 84% 56% / 0.06)" stroke="hsl(204 84% 56% / 0.4)" />
        <text x="35" y="324" fill="hsl(204 70% 42%)" fontSize="11" fontWeight="600">Postgres + RLS</text>
        <text x="35" y="338" fill="hsl(24 7% 45%)" fontSize="9">10 tables · 8 policies</text>
        <text x="35" y="352" fill="hsl(24 7% 45%)" fontSize="9">Audit log · view aggregates</text>

        <rect x="180" y="305" width="140" height="60" rx="10" fill="hsl(150 64% 45% / 0.06)" stroke="hsl(150 64% 45% / 0.4)" />
        <text x="195" y="324" fill="hsl(150 64% 34%)" fontSize="11" fontWeight="600">Supabase Auth</text>
        <text x="195" y="338" fill="hsl(24 7% 45%)" fontSize="9">JWT · cookie sessions</text>
        <text x="195" y="352" fill="hsl(24 7% 45%)" fontSize="9">Entra ID provider (mock)</text>

        <rect x="340" y="305" width="140" height="60" rx="10" fill="hsl(270 70% 60% / 0.06)" stroke="hsl(270 70% 60% / 0.4)" />
        <text x="355" y="324" fill="hsl(270 60% 50%)" fontSize="11" fontWeight="600">Notifications</text>
        <text x="355" y="338" fill="hsl(24 7% 45%)" fontSize="9">Postgres queue</text>
        <text x="355" y="352" fill="hsl(24 7% 45%)" fontSize="9">Fan-out Email/Teams</text>

        <g stroke="hsl(36 90% 50% / 0.6)" strokeWidth="1.5" fill="none">
          <path d="M 120 115 L 120 162" markerEnd="url(#arr)" />
          <path d="M 360 115 L 360 162" markerEnd="url(#arr)" />
          <path d="M 100 268 L 100 302" markerEnd="url(#arr)" />
          <path d="M 250 268 L 250 302" markerEnd="url(#arr)" />
          <path d="M 410 268 L 410 302" markerEnd="url(#arr)" />
        </g>
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(36 90% 50% / 0.6)" />
          </marker>
        </defs>
      </svg>
    </div>
  );
}

// --- copy lives down here so the JSX above stays readable ---
const MARQUEE = [
  'Goal lifecycle', 'L1 approval', 'Shared goals', 'Quarterly check-ins',
  'Live analytics', 'Immutable audit', 'Entra ID SSO', 'Rule-based escalations',
  'CSV export', 'Row-level security',
];

const STEPS = [
  { icon: FileCheck, title: 'Employees draft & submit', desc: 'Pick thrust areas, set weightage, choose a unit of measure. Live validation keeps the sheet to 100% across at most eight goals.' },
  { icon: ShieldCheck, title: 'Managers review & lock', desc: 'Inline-edit, return for rework, or approve and lock. Shared goals cascade one KPI to many reports in a single push.' },
  { icon: BarChart3, title: 'Everyone tracks quarterly', desc: 'Planned vs actual per quarter, weighted scores recomputed on every check-in, and analytics for HR across the org.' },
];

const FEATURES = [
  { icon: FileCheck,   title: 'Goal lifecycle',  desc: 'Draft → Submit → Approve → Lock. Every transition audited.' },
  { icon: ShieldCheck, title: 'L1 approval',      desc: 'Inline edit, return-for-rework, approve-and-lock. Real workflow.' },
  { icon: Users,       title: 'Shared goals',     desc: 'Cascade departmental KPIs to N reports in one push. Weightage adjustable.' },
  { icon: Target,      title: 'Four UoM types',   desc: 'Numeric · Percentage · Timeline · Zero-based. Each with its own formula.' },
  { icon: BarChart3,   title: 'Live analytics',   desc: 'QoQ trends, heatmaps, goal distribution, manager effectiveness.' },
  { icon: Bell,        title: 'Notifications',    desc: 'Email + Teams + In-app. Every lifecycle event. Deep-linked.' },
  { icon: GitBranch,   title: 'Escalations',      desc: 'Configurable rules. N-day thresholds. Routed up the org hierarchy.' },
  { icon: Lock,        title: 'Audit trail',      desc: 'Who changed what, when, with before/after JSON diff. CSV export.' },
];
