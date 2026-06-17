'use client';

import { useState, useTransition, useEffect, useRef, type ReactNode } from 'react';
import {
  motion, useMotionValue, useSpring, useTransform, useScroll,
  useInView, AnimatePresence, type Variants,
} from 'framer-motion';
import { getMockDirectory, ssoSignIn } from '@/lib/auth';
import { Avatar } from '@/components/ui/avatar';
import {
  Feather, ArrowRight, Github, Check, X, ArrowUpRight,
  FileCheck, ShieldCheck, Users, BarChart3, Bell,
  Lock, Target, GitBranch, ClipboardList, Sparkles,
} from 'lucide-react';

type Entry = Awaited<ReturnType<typeof getMockDirectory>>[number];

const EASE = [0.22, 1, 0.36, 1] as const;

/* ===================================================================== */
/*  Motion primitives                                                    */
/* ===================================================================== */

// generic "rise + fade as it enters view" wrapper. delay staggers siblings.
function Reveal({ children, delay = 0, y = 22, className }: {
  children: ReactNode; delay?: number; y?: number; className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-12% 0px' }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

// buttons that lean toward the cursor — subtle, springy, premium.
function Magnetic({ children, className, strength = 0.4 }: {
  children: ReactNode; className?: string; strength?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(0, { stiffness: 220, damping: 16 });
  const y = useSpring(0, { stiffness: 220, damping: 16 });

  function move(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  }
  return (
    <motion.div ref={ref} onMouseMove={move} onMouseLeave={() => { x.set(0); y.set(0); }}
      style={{ x, y }} className={className}>
      {children}
    </motion.div>
  );
}

// card with a violet glow that tracks the cursor (feeds the .pl-spot vars).
function SpotlightCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  function move(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  }
  return <div onMouseMove={move} className={`pl-spot ${className}`}>{children}</div>;
}

// number that springs up from zero the first time it's seen.
function CountUp({ to, suffix = '', prefix = '' }: { to: number; suffix?: string; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-20% 0px' });
  const [val, setVal] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setVal(to); return; }
    let raf = 0; const start = performance.now(); const dur = 1300;
    const tick = (now: number) => {
      const p = Math.min((now - start) / dur, 1);
      setVal(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to]);

  return <span ref={ref} className="tabular-nums">{prefix}{val}{suffix}</span>;
}

/* ===================================================================== */
/*  Page                                                                 */
/* ===================================================================== */

export function LandingClient() {
  const [directory, setDirectory] = useState<Entry[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [loadingOid, setLoadingOid] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);

  // page scroll progress drives the top loader bar
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = directory ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [directory]);

  async function openDirectory() { setDirectory(await getMockDirectory()); }
  function signIn(oid: string) {
    setLoadingOid(oid);
    startTransition(async () => {
      try { await ssoSignIn(oid); } catch (err) { console.error(err); setLoadingOid(null); }
    });
  }

  return (
    <div className="plumeo pl-noise min-h-screen font-sans">
      {/* scroll progress bar */}
      <motion.div className="fixed inset-x-0 top-0 z-[60] h-0.5 origin-left"
        style={{ scaleX: progress, background: 'linear-gradient(90deg, hsl(var(--g1)), hsl(var(--g2)), hsl(var(--g3)))' }} />

      {/* ---- nav ---- */}
      <motion.header
        initial={{ y: -24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.6, ease: EASE }}
        className={`sticky top-0 z-50 transition-colors duration-300 ${scrolled ? 'border-b border-border bg-white/70 backdrop-blur-xl' : 'border-b border-transparent'}`}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:px-8">
          <a href="#top" className="flex items-center gap-2">
            <Brandmark />
            <span className="text-[15px] font-semibold tracking-tight">Plumeo</span>
          </a>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map(([label, href]) => (
              <a key={href} href={href}
                className="rounded-full px-3.5 py-1.5 text-[13.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2.5">
            <a href="https://github.com/Vansh150705/Plumeo" target="_blank" rel="noreferrer"
              className="hidden text-[13.5px] text-muted-foreground transition-colors hover:text-foreground sm:inline">GitHub</a>
            <Magnetic strength={0.25}>
              <button onClick={openDirectory}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13.5px] font-medium text-white pl-shadow-sm transition-transform">
                Get started <ArrowRight className="size-3.5" />
              </button>
            </Magnetic>
          </div>
        </div>
      </motion.header>

      <Hero onStart={openDirectory} />

      <KeywordRail />

      <Features />

      <HowItWorks />

      <Stats />

      <Teams />

      <FinalCTA onStart={openDirectory} />

      <Footer />

      <AnimatePresence>
        {directory && (
          <SignInModal directory={directory} pending={pending} loadingOid={loadingOid}
            onPick={signIn} onClose={() => setDirectory(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ===================================================================== */
/*  Hero                                                                 */
/* ===================================================================== */

function Hero({ onStart }: { onStart: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const yBg = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  const words = ['Goals', 'that', 'move', 'at', 'the', 'speed', 'of'];
  const container: Variants = { show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } } };
  const word: Variants = {
    hidden: { opacity: 0, y: '0.5em', filter: 'blur(6px)' },
    show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.7, ease: EASE } },
  };

  return (
    <section id="top" ref={ref} className="relative overflow-hidden">
      {/* animated aurora + grid, gently parallaxed on scroll */}
      <motion.div style={{ y: yBg, opacity: fade }} className="pointer-events-none absolute inset-0">
        <div className="pl-aurora">
          <i style={{ top: '-6%', left: '14%', width: 380, height: 380, background: 'hsl(var(--g1) / 0.30)', ['--d' as string]: '24s' }} />
          <i style={{ top: '2%', right: '8%', width: 320, height: 320, background: 'hsl(var(--g3) / 0.22)', ['--d' as string]: '28s', animationDelay: '-8s' }} />
          <i style={{ top: '34%', left: '40%', width: 360, height: 300, background: 'hsl(var(--g2) / 0.18)', ['--d' as string]: '32s', animationDelay: '-14s' }} />
        </div>
        <div className="pl-grid absolute inset-x-0 top-0 h-[680px]" />
      </motion.div>

      <div className="relative mx-auto max-w-3xl px-5 pb-10 pt-20 text-center md:pt-28">
        <motion.a href="https://github.com/Vansh150705/Plumeo" target="_blank" rel="noreferrer"
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}
          className="pl-gborder group mb-8 inline-flex items-center gap-2 rounded-full bg-white/80 py-1.5 pl-2 pr-3.5 text-[12.5px] backdrop-blur">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            <Sparkles className="size-3" /> New
          </span>
          <span className="text-muted-foreground">Goal management, reimagined</span>
          <ArrowRight className="size-3 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </motion.a>

        <h1 className="text-[clamp(2.7rem,7vw,5rem)] font-semibold leading-[1.02] tracking-tight">
          <motion.span variants={container} initial="hidden" animate="show" className="inline-block">
            {words.map((w, i) => (
              <motion.span key={i} variants={word} className="inline-block">
                {w}&nbsp;
              </motion.span>
            ))}
          </motion.span>
          <motion.span variants={word} initial="hidden" animate="show"
            transition={{ delay: 0.1 + words.length * 0.07, duration: 0.8, ease: EASE }}
            className="pl-grad inline-block">
            your team.
          </motion.span>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.7, ease: EASE }}
          className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
          Plumeo runs the full goal lifecycle — drafting, manager approval,
          quarterly check-ins, and an audit trail that never forgets. One calm,
          fast surface for objectives, instead of a folder of spreadsheets.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.68, duration: 0.7, ease: EASE }}
          className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Magnetic>
            <button onClick={onStart}
              className="group inline-flex h-12 items-center gap-2 rounded-full bg-primary px-6 text-[15px] font-medium text-white pl-shadow-lg">
              Start for free <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </button>
          </Magnetic>
          <Magnetic strength={0.2}>
            <a href="#features"
              className="inline-flex h-12 items-center gap-2 rounded-full border border-border bg-white/70 px-6 text-[15px] font-medium backdrop-blur transition-colors hover:bg-white">
              Explore features
            </a>
          </Magnetic>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9, duration: 0.8 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
          {['Role-based access', 'Immutable audit log', 'Runs on free tier'].map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <Check className="size-3.5 text-primary" /> {t}
            </span>
          ))}
        </motion.div>
      </div>

      <ProductScene />
    </section>
  );
}

/* ----- the 3D, pointer-driven product scene ----- */
function ProductScene() {
  const wrap = useRef<HTMLDivElement>(null);
  const rx = useSpring(0, { stiffness: 140, damping: 18 });
  const ry = useSpring(0, { stiffness: 140, damping: 18 });
  // depth values for the floating glass cards (parallax against the tilt)
  const px = useSpring(0, { stiffness: 120, damping: 20 });
  const py = useSpring(0, { stiffness: 120, damping: 20 });

  function move(e: React.MouseEvent) {
    const el = wrap.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    rx.set(-ny * 6); ry.set(nx * 8);
    px.set(nx * 22); py.set(ny * 22);
  }
  function leave() { rx.set(0); ry.set(0); px.set(0); py.set(0); }

  return (
    <div className="relative mx-auto max-w-5xl px-5 pb-20 md:px-8">
      <motion.div
        initial={{ opacity: 0, y: 60, scale: 0.97 }} whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true }} transition={{ duration: 0.9, ease: EASE }}
        ref={wrap} onMouseMove={move} onMouseLeave={leave}
        style={{ perspective: 1400 }} className="relative">
        <motion.div style={{ rotateX: rx, rotateY: ry, transformStyle: 'preserve-3d' }}>
          <ProductFrame />

          {/* floating glass cards parallaxing in front of the app */}
          <motion.div style={{ x: px, y: py, translateZ: 80 }}
            className="absolute -right-4 top-16 hidden w-44 rounded-2xl border border-white/60 bg-white/80 p-3.5 pl-shadow-lg backdrop-blur-md sm:block">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Q2 vs Q1</span>
              <ArrowUpRight className="size-3.5 text-primary" />
            </div>
            <div className="mt-1 text-[26px] font-semibold tracking-tight">+27%</div>
            <div className="mt-2 flex h-8 items-end gap-1">
              {[40, 55, 48, 70, 62, 88].map((h, i) => (
                <span key={i} className="flex-1 rounded-sm bg-primary/25" style={{ height: `${h}%`, background: i === 5 ? 'hsl(var(--g1))' : undefined }} />
              ))}
            </div>
          </motion.div>

          <motion.div style={{ x: useTransform(px, (v) => -v * 0.8), y: useTransform(py, (v) => -v * 0.8), translateZ: 60 }}
            className="absolute -left-5 bottom-20 hidden items-center gap-2.5 rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 pl-shadow-lg backdrop-blur-md sm:flex">
            <span className="grid size-8 place-items-center rounded-lg bg-primary/10">
              <Bell className="size-4 text-primary" />
            </span>
            <div>
              <div className="text-[12px] font-semibold leading-none">Sheet approved</div>
              <div className="mt-1 text-[10.5px] text-muted-foreground">by Arjun · just now</div>
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}

// the actual goal-sheet mock inside the scene
function ProductFrame() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white pl-shadow-lg">
      <div className="flex items-center gap-2 border-b border-border bg-secondary/70 px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
        </div>
        <div className="mx-auto flex items-center gap-1.5 rounded-md border border-border bg-white px-3 py-1 font-mono text-[10.5px] text-muted-foreground">
          <Lock className="size-3" /> app.plumeo.io / my-goals
        </div>
      </div>

      <div className="grid grid-cols-[176px_1fr] max-[640px]:grid-cols-1">
        <aside className="border-r border-border bg-secondary/40 p-3 max-[640px]:hidden">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <Brandmark className="size-6" iconClass="size-3.5" />
            <span className="text-[13px] font-semibold">Plumeo</span>
          </div>
          <nav className="mt-3 space-y-0.5">
            {[
              { icon: ClipboardList, label: 'My goals', active: true },
              { icon: BarChart3, label: 'Check-ins' },
              { icon: Bell, label: 'Notifications' },
              { icon: Users, label: 'Team' },
            ].map((n) => (
              <div key={n.label} className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12.5px] ${n.active ? 'bg-white font-medium text-foreground pl-shadow-sm' : 'text-muted-foreground'}`}>
                <n.icon className="size-3.5" /> {n.label}
              </div>
            ))}
          </nav>
        </aside>

        <div className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Goal sheet · FY 2026-27</div>
              <div className="mt-0.5 text-[17px] font-semibold tracking-tight">Kabir Malhotra</div>
            </div>
            <div className="flex items-center gap-1.5">
              <Chip>Approved</Chip>
              <Chip><Lock className="size-2.5" /> Locked</Chip>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              { label: 'Goals', value: '6 / 8' },
              { label: 'Weightage', value: '100%', accent: true },
              { label: 'Q2 score', value: '98' },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-border p-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{s.label}</div>
                <div className={`mt-1 text-[20px] font-semibold tabular-nums tracking-tight ${s.accent ? 'pl-grad' : ''}`}>{s.value}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 space-y-1.5">
            {[
              { area: 'Innovation', title: 'Ship payments redesign by Q3', w: 25, status: 'On Track', score: 100, pct: 100 },
              { area: 'Safety', title: 'Zero P0 incidents owned', w: 20, status: 'Completed', score: 100, pct: 100 },
              { area: 'Ops', title: 'PR cycle time under 24h', w: 20, status: 'On Track', score: 91, pct: 91 },
            ].map((g) => (
              <div key={g.title} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-[12px] font-semibold tabular-nums text-foreground/70">{g.w}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">{g.area}</div>
                  <div className="truncate text-[12.5px] font-medium">{g.title}</div>
                </div>
                <div className="hidden w-20 sm:block">
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <motion.div className="h-full rounded-full" style={{ background: 'linear-gradient(90deg, hsl(var(--g1)), hsl(var(--g2)))' }}
                      initial={{ width: 0 }} whileInView={{ width: `${g.pct}%` }} viewport={{ once: true }}
                      transition={{ duration: 1, ease: EASE, delay: 0.3 }} />
                  </div>
                </div>
                <Chip>{g.status}</Chip>
                <span className="w-7 shrink-0 text-right font-mono text-[12.5px] tabular-nums text-foreground/70">{g.score}</span>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between text-[10.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Check className="size-3 text-primary" /> Auto-saved · audit entry written</span>
            <span className="font-mono">RLS · 12ms</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-0.5 text-[10.5px] font-medium text-foreground/70">
      {children}
    </span>
  );
}

/* ===================================================================== */
/*  Keyword rail                                                         */
/* ===================================================================== */

function KeywordRail() {
  return (
    <div className="border-y border-border bg-white">
      <div className="pl-marquee relative overflow-hidden py-5"
        style={{ WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)', maskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)' }}>
        <div className="pl-marquee-track">
          {[0, 1].map((dup) => (
            <div key={dup} className="flex shrink-0 items-center" aria-hidden={dup === 1}>
              {RAIL.map((m) => (
                <span key={m} className="mx-7 inline-flex items-center gap-2 text-[13px] font-medium uppercase tracking-[0.13em] text-muted-foreground/70">
                  <Feather className="size-3.5 text-primary/60" /> {m}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ===================================================================== */
/*  Features (bento)                                                     */
/* ===================================================================== */

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-32">
      <SectionHead kicker="Features" title={<>Everything the workflow needs,<br />in one fast surface.</>}
        sub="Real database, real auth, real role separation at the row level — eight capabilities, shipped end to end." />

      <div className="mt-14 grid gap-4 md:grid-cols-6 md:grid-rows-2">
        {/* lead tile */}
        <Reveal className="md:col-span-4 md:row-span-1">
          <SpotlightCard className="group flex h-full flex-col justify-between overflow-hidden rounded-3xl border border-border bg-white p-7 pl-shadow-sm transition-shadow hover:pl-shadow-lg md:p-9">
            <div>
              <FeatureIcon icon={FileCheck} />
              <h3 className="mt-5 text-[22px] font-semibold tracking-tight">A lifecycle with real gates</h3>
              <p className="mt-2.5 max-w-md text-[14.5px] leading-relaxed text-muted-foreground">
                Draft, submit, approve, lock. Managers inline-edit or send a sheet
                back for rework — and every change after lock lands in the audit log
                with a before/after diff.
              </p>
            </div>
            <LifecycleVisual />
          </SpotlightCard>
        </Reveal>

        {/* tall analytics tile */}
        <Reveal delay={0.06} className="md:col-span-2 md:row-span-2">
          <SpotlightCard className="flex h-full flex-col rounded-3xl border border-border bg-white p-7 pl-shadow-sm transition-shadow hover:pl-shadow-lg">
            <FeatureIcon icon={BarChart3} />
            <h3 className="mt-5 text-[18px] font-semibold tracking-tight">Analytics that land</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
              Quarter-over-quarter trends and manager effectiveness, recomputed on every check-in.
            </p>
            <QuarterBars />
          </SpotlightCard>
        </Reveal>

        {/* two small tiles */}
        {[
          { icon: Users, title: 'Shared goals', desc: 'Cascade a department KPI to many reports at once — weightage adjustable, target kept in sync.' },
          { icon: Target, title: 'Four scoring models', desc: 'Numeric, percentage, timeline, zero-based — each with its own formula, validated twice.' },
        ].map((f, i) => (
          <Reveal key={f.title} delay={0.04 + i * 0.04} className="md:col-span-2">
            <SpotlightCard className="flex h-full flex-col rounded-3xl border border-border bg-white p-6 pl-shadow-sm transition-shadow hover:pl-shadow-lg">
              <FeatureIcon icon={f.icon} />
              <h3 className="mt-4 text-[15.5px] font-semibold tracking-tight">{f.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{f.desc}</p>
            </SpotlightCard>
          </Reveal>
        ))}
      </div>

      {/* secondary strip */}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {[
          { icon: Bell, title: 'Notifications', desc: 'Email, Teams, and in-app — deep-linked back into the sheet.' },
          { icon: GitBranch, title: 'Escalations', desc: 'Rules on stale approvals, routed up the org hierarchy.' },
          { icon: Lock, title: 'Audit trail', desc: 'Before/after JSON diff with one-click CSV export.' },
        ].map((f, i) => (
          <Reveal key={f.title} delay={i * 0.05}>
            <SpotlightCard className="flex h-full items-start gap-3.5 rounded-2xl border border-border bg-white p-5 pl-shadow-sm transition-shadow hover:pl-shadow-lg">
              <FeatureIcon icon={f.icon} small />
              <div>
                <h3 className="text-[14.5px] font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{f.desc}</p>
              </div>
            </SpotlightCard>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function LifecycleVisual() {
  const steps = ['Draft', 'Submit', 'Approve', 'Lock'];
  return (
    <div className="mt-7 flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <motion.span
            initial={{ opacity: 0, scale: 0.8 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
            transition={{ delay: 0.2 + i * 0.12, duration: 0.5, ease: EASE }}
            className={`rounded-full px-3 py-1 text-[11.5px] font-medium ${i < 3 ? 'bg-primary/10 text-primary' : 'border border-dashed border-border text-muted-foreground'}`}>
            {s}
          </motion.span>
          {i < steps.length - 1 && (
            <motion.span initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }}
              transition={{ delay: 0.26 + i * 0.12, duration: 0.3 }} className="h-px w-5 origin-left bg-border" />
          )}
        </div>
      ))}
    </div>
  );
}

function QuarterBars() {
  const bars = [{ q: 'Q1', h: 44 }, { q: 'Q2', h: 60 }, { q: 'Q3', h: 78 }, { q: 'Q4', h: 96 }];
  return (
    <div className="mt-auto pt-8">
      <div className="flex h-36 items-end gap-3">
        {bars.map((b, i) => (
          <div key={b.q} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex w-full flex-1 items-end">
              <motion.div className="w-full rounded-t-md"
                style={{ background: i === bars.length - 1 ? 'linear-gradient(180deg, hsl(var(--g1)), hsl(var(--g2)))' : 'hsl(var(--secondary))', border: i === bars.length - 1 ? 'none' : '1px solid hsl(var(--border))' }}
                initial={{ height: 0 }} whileInView={{ height: `${b.h}%` }} viewport={{ once: true }}
                transition={{ delay: 0.15 + i * 0.1, duration: 0.7, ease: EASE }} />
            </div>
            <span className="text-[11px] text-muted-foreground">{b.q}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-[12px]">
        <span className="text-muted-foreground">Weighted score</span>
        <span className="font-semibold text-primary">↑ 27% YoY</span>
      </div>
    </div>
  );
}

/* ===================================================================== */
/*  How it works                                                        */
/* ===================================================================== */

function HowItWorks() {
  return (
    <section id="how" className="border-y border-border bg-secondary/50">
      <div className="relative mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-32">
        <div className="pl-dots pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative">
          <SectionHead kicker="How it works" title={<>Three roles,<br />one source of truth.</>}
            sub="Every goal travels the same disciplined path — and nothing important happens off the record." />

          <div className="relative mt-16 grid gap-8 md:grid-cols-3">
            <motion.div
              initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }}
              transition={{ duration: 1.1, ease: EASE }}
              className="absolute left-[16%] right-[16%] top-7 hidden h-px origin-left md:block"
              style={{ background: 'linear-gradient(90deg, hsl(var(--g1)/0.4), hsl(var(--g3)/0.4))' }} />
            {STEPS.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.1}>
                <div className="relative">
                  <div className="pl-gborder mb-5 grid size-14 place-items-center rounded-2xl bg-white text-[16px] font-semibold pl-shadow-sm">
                    {i + 1}
                  </div>
                  <h3 className="flex items-center gap-2 text-[16.5px] font-semibold tracking-tight">
                    <s.icon className="size-4 text-primary" /> {s.title}
                  </h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ===================================================================== */
/*  Stats                                                               */
/* ===================================================================== */

function Stats() {
  const items = [
    { node: <CountUp to={3} />, label: 'Distinct roles', sub: 'Employee · Manager · Admin' },
    { node: <CountUp to={4} />, label: 'Scoring models', sub: 'each spec-exact' },
    { node: <CountUp to={100} suffix="%" />, label: 'Weightage enforced', sub: 'client + server' },
    { node: <CountUp prefix="$" to={0} />, label: 'Monthly cost', sub: 'free-tier serverless' },
  ];
  return (
    <section className="mx-auto max-w-6xl px-5 py-24 md:px-8">
      <div className="grid gap-px overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {items.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.06}>
            <div className="h-full bg-white p-7">
              <div className="pl-grad text-[44px] font-semibold leading-none tracking-tight md:text-[52px]">{s.node}</div>
              <div className="mt-3 text-[14.5px] font-medium">{s.label}</div>
              <div className="mt-0.5 text-[12.5px] text-muted-foreground">{s.sub}</div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ===================================================================== */
/*  Teams                                                               */
/* ===================================================================== */

function Teams() {
  return (
    <section id="teams" className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-32">
      <SectionHead kicker="For teams" title={<>Framed for every seat<br />at the table.</>}
        sub="The same underlying data, shaped around what each person actually needs to do." />

      <div className="mt-14 grid gap-4 md:grid-cols-3">
        {ROLES.map((r, i) => (
          <Reveal key={r.name} delay={i * 0.08}>
            <SpotlightCard className="flex h-full flex-col rounded-3xl border border-border bg-white p-7 pl-shadow-sm transition-shadow hover:pl-shadow-lg">
              <div className="flex items-center gap-2.5">
                <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
                  <r.icon className="size-4" />
                </span>
                <span className="text-[14px] font-semibold tracking-tight">{r.name}</span>
              </div>
              <p className="mt-4 text-[15px] font-medium leading-snug">{r.tagline}</p>
              <ul className="mt-4 space-y-2.5 border-t border-border pt-4">
                {r.items.map((it) => (
                  <li key={it} className="flex gap-2.5 text-[13px] leading-relaxed text-muted-foreground">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-primary" /> {it}
                  </li>
                ))}
              </ul>
            </SpotlightCard>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ===================================================================== */
/*  Final CTA                                                           */
/* ===================================================================== */

function FinalCTA({ onStart }: { onStart: () => void }) {
  return (
    <section className="mx-auto max-w-5xl px-5 py-24 md:px-8">
      <Reveal>
        <div className="pl-gborder relative overflow-hidden rounded-[2.25rem] bg-white p-10 text-center pl-shadow-lg md:p-16">
          <div className="pl-aurora absolute inset-0 opacity-70">
            <i style={{ top: '-20%', left: '20%', width: 300, height: 300, background: 'hsl(var(--g1) / 0.25)', ['--d' as string]: '26s' }} />
            <i style={{ bottom: '-30%', right: '15%', width: 320, height: 320, background: 'hsl(var(--g3) / 0.2)', ['--d' as string]: '30s', animationDelay: '-10s' }} />
          </div>
          <div className="relative">
            <Brandmark className="mx-auto mb-6 size-14 rounded-2xl" iconClass="size-7" />
            <h2 className="text-balance text-[2.5rem] font-semibold leading-[1.05] tracking-tight md:text-[3.4rem]">
              Make goals feel<br /><span className="pl-grad">lighter to run.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-md text-[15px] text-muted-foreground">
              Pre-seeded accounts across every role and workflow state. One click each — no password.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Magnetic>
                <button onClick={onStart}
                  className="group inline-flex h-12 items-center gap-2 rounded-full bg-primary px-7 text-[15px] font-medium text-white pl-shadow-lg">
                  Open the demo <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </button>
              </Magnetic>
              <a href="https://github.com/Vansh150705/Plumeo" target="_blank" rel="noreferrer"
                className="inline-flex h-12 items-center gap-2 rounded-full border border-border bg-white px-6 text-[15px] font-medium transition-colors hover:bg-secondary">
                <Github className="size-4" /> View source
              </a>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ===================================================================== */
/*  Footer                                                              */
/* ===================================================================== */

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-5 py-14 md:px-8">
        <div className="grid gap-10 md:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2">
              <Brandmark />
              <span className="text-[15px] font-semibold tracking-tight">Plumeo</span>
            </div>
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
              A lighter way to set, align, and track goals across a whole team.
            </p>
          </div>
          <FooterCol title="Product" links={[['Features', '#features'], ['How it works', '#how'], ['For teams', '#teams']]} />
          <FooterCol title="Build" links={[['GitHub', 'https://github.com/Vansh150705/Plumeo'], ['Architecture', '/docs/architecture.svg']]} />
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6 text-[12px] text-muted-foreground">
          <span>© {new Date().getFullYear()} Plumeo</span>
          <span>Next.js · Supabase · Vercel</span>
        </div>
      </div>
    </footer>
  );
}

/* ===================================================================== */
/*  Sign-in modal — real Entra flow                                     */
/* ===================================================================== */

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
    <motion.div className="pl-scope fixed inset-0 z-[100] grid place-items-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }} transition={{ duration: 0.3, ease: EASE }}
        className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-white pl-shadow-lg">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className="grid size-7 shrink-0 place-items-center rounded bg-foreground text-[10px] font-bold text-white">MS</span>
          <div>
            <div className="text-[14px] font-semibold">Sign in to Plumeo</div>
            <div className="text-[11px] text-muted-foreground">Pick a demo account — no password</div>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="ml-auto grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[58vh] overflow-y-auto p-2.5">
          <div className="space-y-0.5">
            {directory.map((entry) => {
              const role = entry.memberOf.includes('HR-Admins') ? 'Admin'
                : entry.memberOf.includes('Managers-L1') ? 'Manager' : 'Employee';
              return (
                <button key={entry.oid} disabled={pending} onClick={() => onPick(entry.oid)}
                  className="relative flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-secondary disabled:opacity-50">
                  <Avatar name={entry.displayName} id={entry.oid} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium">{entry.displayName}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{entry.upn}</div>
                  </div>
                  <span className="shrink-0 rounded-md border border-border bg-secondary px-2 py-0.5 text-[10.5px] font-medium text-foreground/70">{role}</span>
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
        <div className="border-t border-border bg-secondary px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Mocked for demo —</span> the response mirrors Microsoft Graph{' '}
          <code className="rounded bg-accent px-1 py-0.5 font-mono text-foreground">/me</code>; roles come from group membership.
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ===================================================================== */
/*  Shared bits                                                         */
/* ===================================================================== */

function Brandmark({ className = 'size-7', iconClass = 'size-4' }: { className?: string; iconClass?: string }) {
  return (
    <span className={`grid place-items-center rounded-lg ${className}`}
      style={{ background: 'linear-gradient(135deg, hsl(var(--g1)), hsl(var(--g2)))' }}>
      <Feather className={`${iconClass} text-white`} />
    </span>
  );
}

function FeatureIcon({ icon: Icon, small }: { icon: React.ComponentType<{ className?: string }>; small?: boolean }) {
  return (
    <span className={`grid place-items-center rounded-xl border border-border bg-secondary text-primary ${small ? 'size-9' : 'size-11'}`}>
      <Icon className={small ? 'size-4' : 'size-[18px]'} />
    </span>
  );
}

function SectionHead({ kicker, title, sub }: { kicker: string; title: ReactNode; sub: string }) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-3 py-1 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-primary pl-shadow-sm">
        <span className="size-1.5 rounded-full bg-primary" /> {kicker}
      </div>
      <h2 className="mt-5 text-[2.2rem] font-semibold leading-[1.08] tracking-tight md:text-[2.9rem]">{title}</h2>
      <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-muted-foreground">{sub}</p>
    </Reveal>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.13em] text-foreground/60">{title}</div>
      <ul className="space-y-2.5">
        {links.map(([label, href]) => (
          <li key={label}>
            <a href={href} className="text-[13.5px] text-muted-foreground transition-colors hover:text-foreground">{label}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ===================================================================== */
/*  Content                                                             */
/* ===================================================================== */

const NAV: [string, string][] = [
  ['Features', '#features'], ['How it works', '#how'], ['Teams', '#teams'],
];

const RAIL = [
  'Goal lifecycle', 'Manager approval', 'Shared goals', 'Quarterly check-ins',
  'Analytics', 'Immutable audit', 'Entra ID SSO', 'CSV export',
];

const STEPS = [
  { icon: FileCheck, title: 'Employees draft & submit',
    desc: 'Pick thrust areas, set weightage, choose a unit of measure. Live validation keeps each sheet at 100% across at most eight goals.' },
  { icon: ShieldCheck, title: 'Managers review & lock',
    desc: 'Inline-edit, return for rework, or approve and lock. Shared goals cascade one KPI to many reports in a single push.' },
  { icon: BarChart3, title: 'Everyone tracks quarterly',
    desc: 'Planned vs actual per quarter, weighted scores recomputed on every check-in, and org-wide analytics for HR.' },
];

const ROLES = [
  { name: 'Employee', icon: FileCheck, tagline: 'Own your sheet, watch it add up.',
    items: ['Draft goals with live weightage validation', 'Capture planned vs actual each quarter', 'See your weighted score update instantly'] },
  { name: 'Manager', icon: ShieldCheck, tagline: 'Approve, align, keep teams on track.',
    items: ['Inline-edit or return sheets for rework', 'Push shared goals to many reports at once', 'Leave structured check-in comments'] },
  { name: 'Admin / HR', icon: Users, tagline: 'See the whole org at a glance.',
    items: ['Analytics: trends, heatmaps, effectiveness', 'Rule-based escalations on stale approvals', 'Audit log and CSV achievement export'] },
];
