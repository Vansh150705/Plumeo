'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { getMockDirectory, ssoSignIn } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import {
  Feather, ArrowRight, Github, Check, MoveRight, X,
  FileCheck, ShieldCheck, Users, BarChart3, Bell,
  Lock, Target, Sparkles, ArrowDown,
} from 'lucide-react';

type Entry = Awaited<ReturnType<typeof getMockDirectory>>[number];

// fade sections in as they scroll up into view. anything with .pl-reveal gets
// .pl-in once it's on screen; if the browser can't do IntersectionObserver we
// just show everything straight away.
function useScrollReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.pl-reveal'));
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('pl-in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('pl-in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

// counts a number up from zero the first time it scrolls into view (snaps
// straight to the value if the user prefers reduced motion).
function CountUp({ to, suffix = '', prefix = '', duration = 1500 }: {
  to: number; suffix?: string; prefix?: string; duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [val, setVal] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setVal(to); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting && !done.current) {
          done.current = true;
          const start = performance.now();
          const step = (now: number) => {
            const p = Math.min((now - start) / duration, 1);
            setVal(Math.round(to * (1 - Math.pow(1 - p, 3))));
            if (p < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }
      });
    }, { threshold: 0.5 });
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

  useScrollReveal();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // lock the page scroll while the sign-in modal is open
  useEffect(() => {
    document.body.style.overflow = directory ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [directory]);

  async function openDirectory() {
    setDirectory(await getMockDirectory());
  }

  function signIn(oid: string) {
    setLoadingOid(oid);
    startTransition(async () => {
      try { await ssoSignIn(oid); } catch (err) { console.error(err); setLoadingOid(null); }
    });
  }

  return (
    <div className="plumeo min-h-screen font-sans antialiased">
      {/* nav — transparent at the top, frosted once you start scrolling */}
      <header className={`sticky top-0 z-50 transition-all duration-300 ${scrolled ? 'border-b border-border/70 bg-white/75 backdrop-blur-xl' : 'border-b border-transparent'}`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 md:px-8">
          <a href="#top" className="group flex items-center gap-2.5">
            <Brandmark />
            <span className="text-[17px] font-semibold tracking-tight">Plumeo</span>
          </a>
          <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-white/60 px-1.5 py-1 backdrop-blur md:flex">
            {[['Features', '#features'], ['How it works', '#how'], ['For teams', '#roles'], ['Stack', '#stack']].map(([label, href]) => (
              <a key={href} href={href} className="rounded-full px-3.5 py-1.5 text-[13px] text-muted-foreground transition hover:bg-accent hover:text-foreground">{label}</a>
            ))}
          </nav>
          <div className="flex items-center gap-1.5">
            <a href="https://github.com/Vansh150705/Plumeo" target="_blank" rel="noreferrer"
              className="hidden size-9 place-items-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground sm:grid">
              <Github className="size-4" />
            </a>
            <Button size="sm" onClick={openDirectory} className="rounded-full px-4">Sign in</Button>
          </div>
        </div>
      </header>

      {/* ============================ hero ============================ */}
      <section id="top" className="relative overflow-hidden">
        <div className="pl-aurora pointer-events-none absolute inset-0" />
        <div className="pl-grid pointer-events-none absolute inset-x-0 top-0 h-[680px]" />
        <div className="pl-blob hidden md:block" style={{ top: -60, left: '6%', width: 340, height: 340, background: 'hsl(264 82% 64% / 0.20)' }} />
        <div className="pl-blob hidden md:block" style={{ top: 120, right: '4%', width: 360, height: 360, background: 'hsl(8 90% 68% / 0.16)', animationDelay: '-7s' }} />

        {/* giant feather drifting behind the headline */}
        <PlumeBackdrop />

        <div className="relative z-10 mx-auto max-w-3xl px-5 pb-10 pt-16 text-center md:pt-24">
          <div className="pl-reveal mb-6 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-white/70 px-3.5 py-1.5 backdrop-blur">
            <Sparkles className="size-3.5 text-[hsl(var(--coral))]" />
            <span className="text-[12px] font-medium tracking-wide">Introducing Plumeo</span>
            <span className="h-3 w-px bg-border" />
            <span className="text-[12px] text-muted-foreground">formerly AtomQuest</span>
          </div>

          <h1 className="pl-reveal font-serif text-[clamp(2.9rem,7vw,5.6rem)] leading-[0.95] tracking-tight" style={{ ['--rd' as string]: '60ms' }}>
            Goal setting that
            <br className="hidden sm:block" /> finally feels{' '}
            <span className="pl-grad-text italic">light.</span>
          </h1>

          <p className="pl-reveal mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-muted-foreground" style={{ ['--rd' as string]: '120ms' }}>
            Plumeo runs the whole goal lifecycle — drafting, manager approval,
            quarterly check-ins, and an audit trail that never forgets — so your
            objectives stop living in a tangle of spreadsheets.
          </p>

          <div className="pl-reveal mt-9 flex flex-wrap items-center justify-center gap-3" style={{ ['--rd' as string]: '180ms' }}>
            <Button size="lg" onClick={openDirectory} className="group h-12 rounded-full px-7 text-[15px] font-semibold shadow-lg shadow-primary/25">
              Get started
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
            <a href="#how" className="inline-flex h-12 items-center gap-2 rounded-full border border-border bg-white px-6 text-sm font-medium transition hover:border-primary/40 hover:bg-accent">
              See how it works <MoveRight className="size-4 text-muted-foreground" />
            </a>
          </div>

          <div className="pl-reveal mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-muted-foreground" style={{ ['--rd' as string]: '240ms' }}>
            {['3 roles', '4 scoring models', '100% audited', '$0 to run'].map((t, i) => (
              <span key={t} className="inline-flex items-center gap-2">
                {i > 0 && <span className="mr-4 h-3.5 w-px bg-border" />}
                <Check className="size-3.5 text-primary" /> {t}
              </span>
            ))}
          </div>
        </div>

        {/* the product shot, tilted in 3D, floating chips around it */}
        <div className="pl-reveal relative z-10 mx-auto max-w-5xl px-5 pb-20 pt-6 md:px-8" style={{ ['--rd' as string]: '300ms' }}>
          <ProductShowcase />
        </div>
      </section>

      {/* scrolling band of what's inside */}
      <div className="pl-marquee relative z-10 overflow-hidden border-y border-border bg-[hsl(var(--secondary))] py-3.5">
        <div className="pl-marquee-track">
          {[0, 1].map((dup) => (
            <div key={dup} className="flex shrink-0 items-center" aria-hidden={dup === 1}>
              {MARQUEE.map((m) => (
                <span key={m} className="mx-6 inline-flex items-center gap-2 text-sm font-medium text-foreground/55">
                  <Feather className="size-3.5 text-primary/70" /> {m}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ===================== bento features ===================== */}
      <section id="features" className="relative mx-auto max-w-6xl px-5 py-24 md:px-8">
        <SectionHead
          kicker="What's inside"
          title={<>Everything the workflow needs,<br /><span className="pl-grad-text">woven into one place.</span></>}
          sub="Real database, real auth, real role separation at the row level. Eight feature areas, all shipped end-to-end."
        />

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {/* wide tile — the lifecycle */}
          <BentoCard className="md:col-span-2" icon={FileCheck} title="A goal lifecycle with real gates"
            desc="Draft, submit, approve, lock. Managers can inline-edit or send a sheet back for rework, and every move after lock is written to the audit log.">
            <LifecycleStrip />
          </BentoCard>

          {/* tall tile — analytics */}
          <BentoCard className="md:row-span-2" icon={BarChart3} title="Analytics that actually land"
            desc="Quarter-over-quarter trends, distribution by thrust area, and manager effectiveness — recomputed on every check-in.">
            <MiniBars />
          </BentoCard>

          <BentoCard icon={Users} title="Shared goals, one push"
            desc="Cascade a department KPI to many reports at once. Weightage stays adjustable; the target stays in sync." />

          <BentoCard icon={Lock} title="An audit trail that never forgets"
            desc="Who changed what, when — with a before/after JSON diff and a one-click CSV export." />

          {/* wide tile — scoring */}
          <BentoCard className="md:col-span-2" icon={Target} title="Four scoring models, exact to spec"
            desc="Numeric, percentage, timeline, and zero-based — each with its own formula, validated on the client and again on the server.">
            <FormulaChips />
          </BentoCard>

          <BentoCard icon={Bell} title="Notifications that reach people"
            desc="Email, Teams, and in-app — fired on every lifecycle event and deep-linked straight back into the sheet." />
        </div>
      </section>

      {/* ===================== how it works ===================== */}
      <section id="how" className="relative overflow-hidden bg-[hsl(var(--secondary))] py-24">
        <div className="pl-blob hidden md:block" style={{ top: 40, left: '12%', width: 300, height: 300, background: 'hsl(264 82% 66% / 0.14)' }} />
        <div className="relative mx-auto max-w-6xl px-5 md:px-8">
          <SectionHead
            kicker="How it works"
            title={<>Three roles.<br /><span className="pl-grad-text">One source of truth.</span></>}
            sub="Every goal travels the same disciplined path — and nothing important happens off the record."
          />

          <div className="relative mt-16 grid gap-8 md:grid-cols-3">
            {/* connecting hairline behind the steps on desktop */}
            <div className="pl-rule absolute left-0 right-0 top-7 hidden h-px md:block" />
            {STEPS.map((s, i) => (
              <div key={s.title} className="pl-reveal relative" style={{ ['--rd' as string]: `${i * 110}ms` }}>
                <div className="mb-5 inline-grid size-14 place-items-center rounded-2xl border border-primary/20 bg-white font-serif text-2xl text-primary shadow-sm" style={{ color: `hsl(var(${s.tone}))` }}>
                  {i + 1}
                </div>
                <div className="mb-2 flex items-center gap-2 text-[17px] font-semibold">
                  <s.icon className="size-4" style={{ color: `hsl(var(${s.tone}))` }} /> {s.title}
                </div>
                <p className="text-[14px] leading-relaxed text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== roles ===================== */}
      <section id="roles" className="relative mx-auto max-w-6xl px-5 py-24 md:px-8">
        <SectionHead
          kicker="For teams"
          title={<>Made for every seat<br /><span className="pl-grad-text">at the table.</span></>}
          sub="The same data, framed for what each person actually needs to do."
        />

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {ROLES.map((r, i) => (
            <div key={r.name}
              className="pl-reveal pl-lift relative overflow-hidden rounded-3xl border border-border bg-white p-7"
              style={{ ['--rd' as string]: `${i * 90}ms` }}>
              <div className="absolute -right-12 -top-12 size-32 rounded-full opacity-60 blur-2xl" style={{ background: `hsl(var(${r.tone}) / 0.18)` }} />
              <div className="relative">
                <div className="mb-5 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-semibold"
                  style={{ background: `hsl(var(${r.tone}) / 0.12)`, color: `hsl(var(${r.tone}))` }}>
                  <r.icon className="size-3.5" /> {r.name}
                </div>
                <p className="mb-5 text-[15px] font-medium leading-snug">{r.tagline}</p>
                <ul className="space-y-2.5">
                  {r.items.map((it) => (
                    <li key={it} className="flex gap-2.5 text-[13px] leading-relaxed text-muted-foreground">
                      <Check className="mt-0.5 size-3.5 shrink-0" style={{ color: `hsl(var(${r.tone}))` }} /> {it}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ===================== stack / numbers ===================== */}
      <section id="stack" className="relative overflow-hidden bg-[hsl(var(--secondary))] py-24">
        <div className="relative mx-auto max-w-6xl px-5 md:px-8">
          <div className="grid items-center gap-14 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="pl-reveal">
              <Kicker>The stack</Kicker>
              <h2 className="mt-3 font-serif text-4xl tracking-tight md:text-[2.9rem] md:leading-[1.06]">
                Engineered to feel<br /><span className="pl-grad-text">weightless.</span>
              </h2>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                Next.js on Vercel talks straight to Supabase Postgres. Row-level
                security <i>is</i> the authorisation layer, server actions handle
                every mutation, and the whole thing runs comfortably on free tiers.
              </p>

              <div className="mt-8 grid grid-cols-3 gap-3">
                {[
                  { node: <CountUp to={10} />, label: 'Postgres tables' },
                  { node: <CountUp to={50} suffix="K" />, label: 'MAU on free tier' },
                  { node: <><span className="align-top text-2xl">$</span><CountUp to={0} /></>, label: 'Monthly cost' },
                ].map((s) => (
                  <div key={s.label} className="rounded-2xl border border-border bg-white p-4">
                    <div className="font-serif text-3xl text-primary md:text-4xl">{s.node}</div>
                    <div className="mt-1 text-[12px] leading-tight text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pl-reveal" style={{ ['--rd' as string]: '120ms' }}>
              <StackPipeline />
            </div>
          </div>
        </div>
      </section>

      {/* ===================== final CTA ===================== */}
      <section className="relative mx-auto max-w-5xl px-5 py-24 md:px-8">
        <div className="pl-reveal relative overflow-hidden rounded-[2.25rem] border border-primary/20 p-10 text-center md:p-16"
          style={{ background: 'linear-gradient(135deg, hsl(264 82% 97%), hsl(8 90% 97%) 60%, #fff)' }}>
          <div className="pl-aurora pointer-events-none absolute inset-0 opacity-80" />
          <div className="relative">
            <Brandmark className="mx-auto mb-6 size-14 rounded-2xl" iconClass="size-7" />
            <h2 className="font-serif text-4xl tracking-tight md:text-[3.4rem] md:leading-[1.05]">
              Ready to make goals<br />feel light?
            </h2>
            <p className="mx-auto mt-4 max-w-md text-[15px] text-muted-foreground">
              Pre-seeded accounts across every role and workflow state. One click each — no password.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button size="lg" onClick={openDirectory} className="h-12 rounded-full px-7 text-[15px] font-semibold shadow-lg shadow-primary/25">
                Open the demo <ArrowRight className="size-4" />
              </Button>
              <a href="https://github.com/Vansh150705/Plumeo" target="_blank" rel="noreferrer"
                className="inline-flex h-12 items-center gap-2 rounded-full border border-border bg-white px-6 text-sm font-medium transition hover:bg-accent">
                <Github className="size-4" /> View source
              </a>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
              {[
                { role: 'Admin', name: 'Priya Shah', tone: '--coral' },
                { role: 'Manager', name: 'Arjun Mehta', tone: '--plum' },
                { role: 'Employee', name: 'Kabir Malhotra', tone: '--peri' },
              ].map((p) => (
                <span key={p.name} className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-3 py-1.5 text-xs">
                  <span className="size-2 rounded-full" style={{ background: `hsl(var(${p.tone}))` }} />
                  <span className="font-semibold" style={{ color: `hsl(var(${p.tone}))` }}>{p.role}</span>
                  <span className="text-muted-foreground">{p.name}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===================== footer ===================== */}
      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-5 py-12 md:px-8">
          <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-2.5">
                <Brandmark />
                <span className="text-[17px] font-semibold tracking-tight">Plumeo</span>
              </div>
              <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
                A lighter way to set, align, and track goals across a whole team.
                Built on Next.js, Supabase, and Vercel.
              </p>
            </div>
            <FooterCol title="Product" links={[['Features', '#features'], ['How it works', '#how'], ['For teams', '#roles'], ['The stack', '#stack']]} />
            <FooterCol title="Build" links={[['GitHub', 'https://github.com/Vansh150705/Plumeo'], ['Architecture', '/docs/architecture.svg'], ['Sign in', '#top']]} />
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6 text-[12px] text-muted-foreground">
            <span>© {new Date().getFullYear()} Plumeo · formerly AtomQuest</span>
            <span>Next.js · Supabase · Vercel</span>
          </div>
        </div>
      </footer>

      {/* sign-in modal lives at the end so it overlays everything */}
      {directory && (
        <SignInModal
          directory={directory}
          pending={pending}
          loadingOid={loadingOid}
          onPick={signIn}
          onClose={() => setDirectory(null)}
        />
      )}
    </div>
  );
}

/* ----------------------------- small bits ----------------------------- */

// the little feather logo, reused in the nav, CTA and footer
function Brandmark({ className = 'size-9', iconClass = 'size-5' }: { className?: string; iconClass?: string }) {
  return (
    <span className={`relative grid place-items-center rounded-xl shadow-sm ${className}`}
      style={{ background: 'linear-gradient(135deg, hsl(264 82% 58%), hsl(8 90% 64%))' }}>
      <Feather className={`${iconClass} text-white`} />
    </span>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-primary">{children}</div>;
}

function SectionHead({ kicker, title, sub }: { kicker: string; title: React.ReactNode; sub: string }) {
  return (
    <div className="pl-reveal mx-auto max-w-2xl text-center">
      <Kicker>{kicker}</Kicker>
      <h2 className="mt-3 font-serif text-4xl tracking-tight md:text-[3.1rem] md:leading-[1.05]">{title}</h2>
      <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-muted-foreground">{sub}</p>
    </div>
  );
}

function BentoCard({ icon: Icon, title, desc, children, className = '' }: {
  icon: React.ComponentType<{ className?: string }>; title: string; desc: string;
  children?: React.ReactNode; className?: string;
}) {
  return (
    <div className={`pl-reveal pl-lift group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-white p-6 hover:border-primary/40 hover:shadow-[0_30px_70px_-40px_hsl(264_82%_50%/0.5)] ${className}`}>
      <div className="mb-4 grid size-11 place-items-center rounded-xl border border-primary/20 bg-[hsl(var(--secondary))] text-primary transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110">
        <Icon className="size-5" />
      </div>
      <div className="mb-1.5 text-[16px] font-semibold tracking-tight">{title}</div>
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">{desc}</p>
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-foreground/70">{title}</div>
      <ul className="space-y-2">
        {links.map(([label, href]) => (
          <li key={label}>
            <a href={href} className="inline-flex items-center gap-1 text-[13px] text-muted-foreground transition hover:text-foreground">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------- hero visuals ----------------------------- */

// a big, soft feather floating behind the headline. the strokes draw in on load.
function PlumeBackdrop() {
  return (
    <svg className="pl-draw pointer-events-none absolute left-1/2 top-2 z-0 hidden w-[760px] -translate-x-1/2 opacity-[0.16] md:block"
      viewBox="0 0 400 520" fill="none" aria-hidden>
      <defs>
        <linearGradient id="plume" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(264 82% 58%)" />
          <stop offset="1" stopColor="hsl(8 90% 64%)" />
        </linearGradient>
      </defs>
      {/* central rachis */}
      <path d="M200 20 C 196 180 196 360 188 500" stroke="url(#plume)" strokeWidth="3" strokeLinecap="round" />
      {/* barbs, mirrored down each side */}
      {Array.from({ length: 11 }).map((_, i) => {
        const y = 70 + i * 38;
        const len = 120 - i * 6;
        return (
          <g key={i}>
            <path d={`M198 ${y} C ${198 - len * 0.5} ${y - 6}, ${198 - len * 0.8} ${y + 20}, ${198 - len} ${y + 40}`} stroke="url(#plume)" strokeWidth="2" strokeLinecap="round" />
            <path d={`M200 ${y} C ${200 + len * 0.5} ${y - 6}, ${200 + len * 0.8} ${y + 20}, ${200 + len} ${y + 40}`} stroke="url(#plume)" strokeWidth="2" strokeLinecap="round" />
          </g>
        );
      })}
    </svg>
  );
}

// the tilted product shot: a goal-overview screen, with two chips floating off it.
function ProductShowcase() {
  return (
    <div className="pl-scene relative">
      <div className="pointer-events-none absolute inset-x-10 -bottom-6 top-10 -z-10 rounded-[3rem] opacity-70 blur-3xl"
        style={{ background: 'linear-gradient(120deg, hsl(264 82% 60% / 0.25), hsl(8 90% 64% / 0.22))' }} />

      <div className="pl-tilt overflow-hidden rounded-2xl border border-border bg-white shadow-[0_50px_120px_-50px_hsl(264_40%_20%/0.55)]">
        {/* window chrome */}
        <div className="flex items-center gap-2 border-b border-border bg-[hsl(var(--secondary))] px-4 py-3">
          <span className="size-2.5 rounded-full" style={{ background: 'hsl(8 90% 70%)' }} />
          <span className="size-2.5 rounded-full" style={{ background: 'hsl(38 92% 65%)' }} />
          <span className="size-2.5 rounded-full" style={{ background: 'hsl(264 60% 72%)' }} />
          <div className="mx-3 flex-1 truncate rounded-md border border-border bg-white px-3 py-1 text-center font-mono text-[10px] text-muted-foreground">
            app.plumeo.io / my-goals
          </div>
        </div>

        {/* sheet header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Goal sheet · FY 2026-27</div>
            <div className="font-serif text-xl">Kabir Malhotra</div>
          </div>
          <div className="flex items-center gap-2">
            <Chip tone="--plum">Approved</Chip>
            <Chip tone="--grape"><Lock className="size-2.5" /> Locked</Chip>
          </div>
        </div>

        {/* body: ring + bars + goals */}
        <div className="grid gap-5 p-6 sm:grid-cols-[auto_1fr]">
          <div className="flex items-center gap-5">
            <WeightRing />
            <div className="grid grid-cols-1 gap-3 sm:hidden">
              <Stat label="Goals" value="6" />
              <Stat label="Q2 score" value="98" tone="--coral" />
            </div>
          </div>

          <div className="space-y-2">
            {[
              { area: 'Innovation', title: 'Ship payments redesign by Q3', w: 25, status: 'On Track', tone: '--peri', score: 100 },
              { area: 'Safety', title: 'Zero P0 incidents owned', w: 20, status: 'Completed', tone: '--plum', score: 100 },
              { area: 'Ops', title: 'PR cycle time ≤ 24h', w: 20, status: 'On Track', tone: '--peri', score: 91 },
            ].map((g) => (
              <div key={g.title} className="flex items-center gap-3 rounded-xl border border-border bg-white px-3 py-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-[hsl(var(--secondary))] font-serif text-base tabular-nums text-primary">{g.w}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] text-muted-foreground">{g.area}</div>
                  <div className="truncate text-[13px] font-medium">{g.title}</div>
                </div>
                <Chip tone={g.tone}>{g.status}</Chip>
                <span className="w-8 shrink-0 text-right font-mono text-[13px] tabular-nums text-primary">{g.score}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border bg-[hsl(var(--secondary))] px-6 py-3 text-[10px]">
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <span className="pl-blink size-1.5 rounded-full" style={{ background: 'hsl(var(--plum))' }} />
            Auto-saved · audit entry written
          </span>
          <span className="font-mono text-muted-foreground">RLS · 12ms</span>
        </div>
      </div>

      {/* floating chips */}
      <div className="pl-float absolute -right-3 top-12 hidden rounded-2xl border border-border bg-white/95 px-4 py-3 shadow-xl backdrop-blur sm:block">
        <div className="text-[10px] text-muted-foreground">Q2 vs Q1</div>
        <div className="font-serif text-2xl" style={{ color: 'hsl(var(--coral))' }}>+6%</div>
      </div>
      <div className="pl-float2 absolute -left-4 bottom-10 hidden items-center gap-2 rounded-2xl border border-border bg-white/95 px-3.5 py-2.5 shadow-xl backdrop-blur sm:flex">
        <span className="grid size-7 place-items-center rounded-lg" style={{ background: 'hsl(var(--plum) / 0.12)' }}>
          <Bell className="size-3.5" style={{ color: 'hsl(var(--plum))' }} />
        </span>
        <div>
          <div className="text-[11px] font-semibold leading-none">Sheet approved</div>
          <div className="text-[10px] text-muted-foreground">2 min ago</div>
        </div>
      </div>
    </div>
  );
}

// a coloured status chip used all over the product shot
function Chip({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ background: `hsl(var(${tone}) / 0.12)`, color: `hsl(var(${tone}))` }}>
      {children}
    </span>
  );
}

function Stat({ label, value, tone = '--plum' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="font-serif text-xl tabular-nums" style={{ color: `hsl(var(${tone}))` }}>{value}</div>
    </div>
  );
}

// the 100% weightage ring in the product shot
function WeightRing() {
  const c = 2 * Math.PI * 34;
  return (
    <div className="relative size-24 shrink-0">
      <svg viewBox="0 0 80 80" className="size-24 -rotate-90">
        <circle cx="40" cy="40" r="34" fill="none" stroke="hsl(264 30% 92%)" strokeWidth="7" />
        <circle cx="40" cy="40" r="34" fill="none" strokeWidth="7" strokeLinecap="round"
          stroke="url(#ring)" strokeDasharray={c} strokeDashoffset={0} />
        <defs>
          <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="hsl(264 82% 58%)" />
            <stop offset="1" stopColor="hsl(8 90% 64%)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-serif text-2xl leading-none tabular-nums text-foreground">100<span className="text-sm">%</span></div>
          <div className="mt-0.5 text-[8px] uppercase tracking-[0.16em] text-muted-foreground">weight</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------- bento mini-visuals ------------------------- */

// Draft → Submit → Approve → Lock, shown as connected pills
function LifecycleStrip() {
  const steps = [
    { label: 'Draft', tone: '--peri' },
    { label: 'Submit', tone: '--plum' },
    { label: 'Approve', tone: '--grape' },
    { label: 'Lock', tone: '--coral' },
  ];
  return (
    <div className="flex items-center gap-1.5">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center gap-1.5">
          <span className="rounded-full px-3 py-1 text-[11px] font-semibold"
            style={{ background: `hsl(var(${s.tone}) / 0.12)`, color: `hsl(var(${s.tone}))` }}>{s.label}</span>
          {i < steps.length - 1 && <ArrowRight className="size-3 text-muted-foreground/50" />}
        </div>
      ))}
    </div>
  );
}

// a tiny quarter-over-quarter bar chart
function MiniBars() {
  const bars = [
    { q: 'Q1', h: 46, tone: '--peri' },
    { q: 'Q2', h: 64, tone: '--plum' },
    { q: 'Q3', h: 82, tone: '--grape' },
    { q: 'Q4', h: 96, tone: '--coral' },
  ];
  return (
    <div>
      <div className="flex h-32 items-end gap-3">
        {bars.map((b) => (
          <div key={b.q} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="flex w-full items-end justify-center" style={{ height: '100%' }}>
              <div className="w-full rounded-t-md" style={{ height: `${b.h}%`, background: `hsl(var(${b.tone}))` }} />
            </div>
            <span className="text-[10px] text-muted-foreground">{b.q}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Weighted score</span>
        <span className="font-semibold" style={{ color: 'hsl(var(--coral))' }}>↑ 27% YoY</span>
      </div>
    </div>
  );
}

// the four units of measure as labelled chips
function FormulaChips() {
  const f = [
    { k: 'Numeric', tone: '--peri' },
    { k: 'Percentage', tone: '--plum' },
    { k: 'Timeline', tone: '--grape' },
    { k: 'Zero-based', tone: '--coral' },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {f.map((x) => (
        <span key={x.k} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium"
          style={{ borderColor: `hsl(var(${x.tone}) / 0.3)`, color: `hsl(var(${x.tone}))`, background: `hsl(var(${x.tone}) / 0.06)` }}>
          <span className="size-1.5 rounded-full" style={{ background: `hsl(var(${x.tone}))` }} /> {x.k}
        </span>
      ))}
    </div>
  );
}

// horizontal client → edge → database pipeline for the stack section
function StackPipeline() {
  const tiers = [
    { label: 'Client', tone: '--peri', items: ['Web browser', 'Employees · Managers · HR'] },
    { label: 'Vercel Edge', tone: '--plum', items: ['Next.js 14 SSR', 'Server actions · API · cron'] },
    { label: 'Supabase', tone: '--coral', items: ['Postgres + RLS', 'Auth · notifications queue'] },
  ];
  return (
    <div className="rounded-3xl border border-border bg-white p-6 shadow-[0_30px_70px_-50px_hsl(264_40%_20%/0.4)] md:p-8">
      <div className="space-y-3">
        {tiers.map((t, i) => (
          <div key={t.label}>
            <div className="flex items-center gap-4 rounded-2xl border border-border p-4"
              style={{ background: `hsl(var(${t.tone}) / 0.05)` }}>
              <span className="grid size-10 shrink-0 place-items-center rounded-xl text-white"
                style={{ background: `hsl(var(${t.tone}))` }}>
                <span className="font-serif text-lg">{i + 1}</span>
              </span>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{t.label}</div>
                <div className="text-[14px] font-semibold">{t.items[0]}</div>
                <div className="text-[12px] text-muted-foreground">{t.items[1]}</div>
              </div>
              <span className="ml-auto font-mono text-[11px]" style={{ color: `hsl(var(${t.tone}))` }}>$0</span>
            </div>
            {i < tiers.length - 1 && (
              <div className="flex justify-center py-1">
                <ArrowDown className="size-4 text-muted-foreground/40" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- sign-in modal ----------------------------- */

// the real Microsoft account picker. picking a tile calls ssoSignIn() and lands
// you in the matching dashboard — this is the actual auth flow, not a mock-up.
function SignInModal({ directory, pending, loadingOid, onPick, onClose }: {
  directory: Entry[]; pending: boolean; loadingOid: string | null;
  onPick: (oid: string) => void; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="plumeo fixed inset-0 z-[100] grid place-items-center p-4">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'hsl(263 34% 13% / 0.45)' }} onClick={onClose} />
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border bg-[hsl(var(--secondary))] px-5 py-4">
          <span className="grid size-7 shrink-0 place-items-center rounded text-[10px] font-bold text-white" style={{ background: 'hsl(263 34% 18%)' }}>MS</span>
          <div>
            <div className="text-sm font-semibold">Sign in to Plumeo</div>
            <div className="text-[10px] text-muted-foreground">Pick a demo account — no password</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="ml-auto grid size-7 place-items-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-3">
          <div className="space-y-0.5">
            {directory.map((entry) => {
              const role = entry.memberOf.includes('HR-Admins') ? 'Admin'
                : entry.memberOf.includes('Managers-L1') ? 'Manager' : 'Employee';
              const tone = role === 'Admin' ? '--coral' : role === 'Manager' ? '--plum' : '--peri';
              return (
                <button key={entry.oid} disabled={pending} onClick={() => onPick(entry.oid)}
                  className="relative flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition hover:bg-accent disabled:opacity-50">
                  <Avatar name={entry.displayName} id={entry.oid} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{entry.displayName}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{entry.upn}</div>
                  </div>
                  <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                    style={{ background: `hsl(var(${tone}) / 0.12)`, color: `hsl(var(${tone}))` }}>{role}</span>
                  {loadingOid === entry.oid && (
                    <div className="absolute inset-0 grid place-items-center rounded-xl bg-white/80">
                      <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="border-t border-border bg-[hsl(var(--secondary))] px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Mocked for demo —</span> the response mirrors Microsoft Graph{' '}
          <code className="rounded bg-accent px-1 py-0.5 font-mono text-foreground">/me</code>; roles come from group membership.
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- content ----------------------------- */

const MARQUEE = [
  'Goal lifecycle', 'Manager approval', 'Shared goals', 'Quarterly check-ins',
  'Live analytics', 'Immutable audit', 'Entra ID SSO', 'Rule-based escalations', 'CSV export',
];

const STEPS = [
  { icon: FileCheck, tone: '--peri', title: 'Employees draft & submit',
    desc: 'Pick thrust areas, set weightage, choose a unit of measure. Live validation keeps each sheet at 100% across at most eight goals.' },
  { icon: ShieldCheck, tone: '--plum', title: 'Managers review & lock',
    desc: 'Inline-edit, return for rework, or approve and lock. Shared goals cascade one KPI to many reports in a single push.' },
  { icon: BarChart3, tone: '--coral', title: 'Everyone tracks quarterly',
    desc: 'Planned vs actual per quarter, weighted scores recomputed on every check-in, and analytics for HR across the whole org.' },
];

const ROLES = [
  { name: 'Employee', tone: '--peri', icon: FileCheck, tagline: 'Own your sheet, watch it add up.',
    items: ['Draft goals with live weightage validation', 'Capture planned vs actual each quarter', 'See your weighted score update instantly'] },
  { name: 'Manager', tone: '--plum', icon: ShieldCheck, tagline: 'Approve, align, and keep teams on track.',
    items: ['Inline-edit or return sheets for rework', 'Push shared goals to many reports at once', 'Leave structured check-in comments'] },
  { name: 'Admin / HR', tone: '--coral', icon: Users, tagline: 'See the whole org at a glance.',
    items: ['Analytics: trends, heatmaps, effectiveness', 'Rule-based escalations on stale approvals', 'Audit log + CSV achievement export'] },
];
