'use client';

import { useState, useTransition, useEffect, useRef, type ReactNode } from 'react';
import { motion, useSpring, useInView, AnimatePresence } from 'framer-motion';
import { getMockDirectory, ssoSignIn } from '@/lib/auth';
import { Avatar } from '@/components/ui/avatar';
import {
  Feather, ArrowRight, Check, X, Github,
  FileCheck, ShieldCheck, Users, BarChart3, Bell, GitBranch, Lock, Target,
} from 'lucide-react';

type Entry = Awaited<ReturnType<typeof getMockDirectory>>[number];

const EASE = [0.22, 1, 0.36, 1] as const;

// illustration palette (kept here so every character stays on-brand)
const C = {
  navy: 'hsl(218 56% 16%)',
  navySoft: 'hsl(218 36% 32%)',
  gold: 'hsl(38 56% 46%)',
  goldSoft: 'hsl(42 72% 86%)',
  cream: 'hsl(40 46% 95%)',
  skin: 'hsl(28 48% 80%)',
  skin2: 'hsl(26 42% 70%)',
  ink: 'hsl(218 54% 14%)',
  line: 'hsl(218 22% 88%)',
  white: '#ffffff',
};

/* ===================================================================== */
/*  Motion helpers                                                       */
/* ===================================================================== */

function Reveal({ children, delay = 0, y = 20, className }: {
  children: ReactNode; delay?: number; y?: number; className?: string;
}) {
  return (
    <motion.div className={className}
      initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-12% 0px' }}
      transition={{ duration: 0.7, ease: EASE, delay }}>
      {children}
    </motion.div>
  );
}

// buttons lean gently toward the cursor — subtle, never bouncy
function Magnetic({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(0, { stiffness: 200, damping: 18 });
  const y = useSpring(0, { stiffness: 200, damping: 18 });
  function move(e: React.MouseEvent) {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * 0.3);
    y.set((e.clientY - (r.top + r.height / 2)) * 0.3);
  }
  return (
    <motion.div ref={ref} onMouseMove={move} onMouseLeave={() => { x.set(0); y.set(0); }}
      style={{ x, y }} className={className}>{children}</motion.div>
  );
}

function CountUp({ to, suffix = '', prefix = '' }: { to: number; suffix?: string; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-20% 0px' });
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!inView) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setVal(to); return; }
    let raf = 0; const start = performance.now(); const dur = 1200;
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
/*  Buttons                                                              */
/* ===================================================================== */

function PrimaryButton({ children, onClick, className = '' }: { children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <Magnetic>
      <button onClick={onClick}
        className={`group inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-[14.5px] font-medium text-primary-foreground pl-shadow-sm transition-[background,transform] hover:bg-[hsl(218_52%_22%)] ${className}`}>
        {children}
      </button>
    </Magnetic>
  );
}

function GhostButton({ children, href }: { children: ReactNode; href: string }) {
  return (
    <a href={href}
      className="inline-flex h-12 items-center gap-2 rounded-xl border border-border bg-white px-6 text-[14.5px] font-medium text-foreground transition-colors hover:border-foreground/25 hover:bg-secondary">
      {children}
    </a>
  );
}

/* ===================================================================== */
/*  Page                                                                 */
/* ===================================================================== */

export function LandingClient() {
  const [directory, setDirectory] = useState<Entry[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [loadingOid, setLoadingOid] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);

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
    <div className="plumeo min-h-screen font-sans">
      {/* ---- nav ---- */}
      <header className={`sticky top-0 z-50 transition-colors duration-300 ${scrolled ? 'border-b border-border bg-white/85 backdrop-blur-xl' : 'border-b border-transparent'}`}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:px-8">
          <a href="#top" className="flex items-center gap-2.5">
            <Brandmark />
            <span className="font-display text-[19px] font-medium tracking-tight">Plumeo</span>
          </a>
          <nav className="hidden items-center gap-8 md:flex">
            {NAV.map(([label, href]) => (
              <a key={href} href={href} className="text-[14px] text-muted-foreground transition-colors hover:text-foreground">{label}</a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <a href="https://github.com/Vansh150705/Plumeo" target="_blank" rel="noreferrer"
              className="hidden text-[14px] text-muted-foreground transition-colors hover:text-foreground sm:inline">Sign in</a>
            <button onClick={openDirectory}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-[13.5px] font-medium text-primary-foreground transition-colors hover:bg-[hsl(218_52%_22%)]">
              Get started
            </button>
          </div>
        </div>
      </header>

      <Hero onStart={openDirectory} />
      <KeywordRail />
      <Features />
      <HowItWorks />
      <Roles />
      <Stats />
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
  const stagger = {
    hidden: {},
    show: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
  };
  const item = {
    hidden: { opacity: 0, y: 18 },
    show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
  };
  return (
    <section id="top" className="relative">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-16 md:px-8 md:pt-24 lg:grid-cols-[1.02fr_0.98fr]">
        <motion.div variants={stagger} initial="hidden" animate="show">
          <motion.div variants={item} className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-white px-3 py-1.5 text-[12px] font-medium pl-shadow-sm">
            <span className="size-1.5 rounded-full" style={{ background: C.gold }} />
            <span className="uppercase tracking-[0.14em] text-muted-foreground">Goal setting, made human</span>
          </motion.div>

          <motion.h1 variants={item} className="font-display text-[clamp(2.6rem,5.2vw,4.4rem)] font-medium leading-[1.04]">
            Set goals your team
            <br />
            <span className="relative inline-block">
              actually loves.
              <GoldUnderline />
            </span>
          </motion.h1>

          <motion.p variants={item} className="mt-7 max-w-md text-[16.5px] leading-relaxed text-muted-foreground">
            Plumeo runs the whole goal lifecycle — drafting, manager approval,
            quarterly check-ins, and an audit trail that never forgets — in one
            calm, beautifully simple place.
          </motion.p>

          <motion.div variants={item} className="mt-9 flex flex-wrap items-center gap-3">
            <PrimaryButton onClick={onStart}>Start for free <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></PrimaryButton>
            <GhostButton href="#how">See how it works</GhostButton>
          </motion.div>

          <motion.div variants={item} className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
            {['Role-based access', 'Immutable audit log', 'Free to run'].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <Check className="size-3.5" style={{ color: C.gold }} /> {t}
              </span>
            ))}
          </motion.div>
        </motion.div>

        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.15 }}>
          <HeroScene />
        </motion.div>
      </div>
    </section>
  );
}

function GoldUnderline() {
  return (
    <svg className="absolute -bottom-1.5 left-0 h-3 w-full" viewBox="0 0 300 12" fill="none" preserveAspectRatio="none" aria-hidden>
      <motion.path d="M4 8 C 70 3, 230 3, 296 7" stroke={C.gold} strokeWidth="4" strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, delay: 0.9, ease: EASE }} />
    </svg>
  );
}

// the hero illustration: a goal card with three teammates gathered around it,
// plus a couple of small floating notes. grounded in a cream "stage" so the page
// itself stays plain white.
function HeroScene() {
  return (
    <div className="relative mx-auto w-full max-w-[460px]">
      <div className="relative rounded-[2.25rem] border border-border p-6 sm:p-8" style={{ background: C.cream }}>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Team goals · FY 2026</span>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: C.gold }}>
            <span className="size-1.5 rounded-full" style={{ background: C.gold }} /> On track
          </span>
        </div>

        {/* the goal card */}
        <div className="rounded-2xl border border-border bg-white p-5 pl-shadow-sm">
          <div className="flex items-center gap-5">
            <Ring value={100} />
            <div className="flex-1 space-y-2.5">
              {[
                { w: 25, label: 'Payments redesign', done: true },
                { w: 20, label: 'Zero P0 incidents', done: true },
                { w: 20, label: 'PR cycle time', done: false },
              ].map((r) => (
                <div key={r.label} className="flex items-center gap-2.5">
                  <span className="grid size-6 shrink-0 place-items-center rounded-md text-[10px] font-semibold tabular-nums"
                    style={{ background: C.cream, color: C.navy }}>{r.w}</span>
                  <span className="flex-1 truncate text-[12px] font-medium" style={{ color: C.ink }}>{r.label}</span>
                  <span className="grid size-4 place-items-center rounded-full"
                    style={{ background: r.done ? C.gold : 'transparent', border: r.done ? 'none' : `1.5px solid ${C.line}` }}>
                    {r.done && <Check className="size-2.5 text-white" />}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* two summary tiles */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-white px-3.5 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Goals</div>
            <div className="font-display text-[18px] font-medium" style={{ color: C.ink }}>6 / 8</div>
          </div>
          <div className="rounded-xl border border-border bg-white px-3.5 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Q2 score</div>
            <div className="font-display text-[18px] font-medium" style={{ color: C.gold }}>98</div>
          </div>
        </div>
      </div>

      {/* teammates gathered around the goals */}
      <div className="pl-float absolute -left-5 -top-6 size-[72px] overflow-hidden rounded-full border-[3px] border-white bg-white pl-shadow-sm">
        <Persona variant="employee" />
      </div>
      <div className="pl-float-2 absolute -right-6 top-16 size-[60px] overflow-hidden rounded-full border-[3px] border-white bg-white pl-shadow-sm">
        <Persona variant="manager" />
      </div>
      <div className="pl-float absolute -bottom-5 left-20 size-[58px] overflow-hidden rounded-full border-[3px] border-white bg-white pl-shadow-sm">
        <Persona variant="admin" />
      </div>

      {/* a floating note */}
      <div className="pl-float-2 absolute -right-3 -bottom-3 flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 pl-shadow-sm">
        <span className="grid size-6 place-items-center rounded-full" style={{ background: C.gold }}>
          <Check className="size-3.5 text-white" />
        </span>
        <span className="text-[11.5px] font-semibold" style={{ color: C.ink }}>Sheet approved</span>
      </div>

      {/* gold sparkles */}
      <Sparkle className="absolute -left-2 bottom-24" size={18} />
      <Sparkle className="absolute right-2 -top-3" size={13} />
    </div>
  );
}

function Ring({ value }: { value: number }) {
  const r = 26; const c = 2 * Math.PI * r;
  return (
    <div className="relative size-[72px] shrink-0">
      <svg viewBox="0 0 64 64" className="size-[72px] -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke={C.line} strokeWidth="6" />
        <motion.circle cx="32" cy="32" r={r} fill="none" stroke={C.gold} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} whileInView={{ strokeDashoffset: c * (1 - value / 100) }}
          viewport={{ once: true }} transition={{ duration: 1.1, ease: EASE, delay: 0.4 }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="font-display text-[16px] font-medium" style={{ color: C.ink }}>{value}%</span>
      </div>
    </div>
  );
}

function Sparkle({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 0 C 13 8, 16 11, 24 12 C 16 13, 13 16, 12 24 C 11 16, 8 13, 0 12 C 8 11, 11 8, 12 0 Z" fill={C.gold} opacity="0.9" />
    </svg>
  );
}

/* ===================================================================== */
/*  Character illustrations                                              */
/* ===================================================================== */

// a clean, flat avatar bust. three variants keep the same calm style so the cast
// feels like one team. minimal features on purpose — classy, not cartoonish.
function Persona({ variant }: { variant: 'employee' | 'manager' | 'admin' }) {
  const cfg = {
    employee: { skin: C.skin, hair: C.navy, top: C.navy, collar: C.cream },
    manager: { skin: C.skin2, hair: C.navy, top: C.gold, collar: C.navy },
    admin: { skin: C.skin, hair: C.navy, top: C.navy, collar: C.cream },
  }[variant];

  return (
    <svg viewBox="0 0 120 120" className="size-full" aria-hidden>
      <defs>
        <clipPath id={`clip-${variant}`}><circle cx="60" cy="60" r="60" /></clipPath>
      </defs>
      <g clipPath={`url(#clip-${variant})`}>
        <rect width="120" height="120" fill={C.cream} />
        {/* shoulders / top */}
        <path d="M14 120 C14 94 36 83 60 83 C84 83 106 94 106 120 Z" fill={cfg.top} />
        {/* collar */}
        <path d="M48 85 L60 99 L72 85 L66 83 L60 90 L54 83 Z" fill={cfg.collar} />
        {variant === 'manager' && <path d="M60 90 L60 120" stroke={C.gold} strokeWidth="2" opacity="0.5" />}
        {/* neck */}
        <rect x="53" y="72" width="14" height="16" rx="7" fill={cfg.skin} />
        {/* hair volume behind head */}
        {variant === 'manager' && <circle cx="60" cy="33" r="11" fill={cfg.hair} />}
        <ellipse cx="60" cy="52" rx="27" ry="26" fill={cfg.hair} />
        {/* head */}
        <circle cx="60" cy="56" r="22" fill={cfg.skin} />
        {/* fringe */}
        <path d="M38 53 Q60 31 82 53 Q72 45 60 45 Q48 45 38 53 Z" fill={cfg.hair} />
        {/* face */}
        <circle cx="52" cy="58" r="2.1" fill={C.ink} />
        <circle cx="68" cy="58" r="2.1" fill={C.ink} />
        <path d="M54 66 Q60 70 66 66" stroke={C.ink} strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* glasses for admin */}
        {variant === 'admin' && (
          <g stroke={C.gold} strokeWidth="2" fill="none">
            <circle cx="52" cy="58" r="6" /><circle cx="68" cy="58" r="6" />
            <path d="M58 58 H62" /><path d="M46 56 L42 54" /><path d="M74 56 L78 54" />
          </g>
        )}
      </g>
      <circle cx="60" cy="60" r="59" fill="none" stroke={C.line} />
    </svg>
  );
}

/* ===================================================================== */
/*  Keyword rail                                                         */
/* ===================================================================== */

function KeywordRail() {
  return (
    <div className="border-y border-border">
      <div className="pl-marquee overflow-hidden py-5"
        style={{ WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)', maskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)' }}>
        <div className="pl-marquee-track">
          {[0, 1].map((dup) => (
            <div key={dup} className="flex shrink-0 items-center" aria-hidden={dup === 1}>
              {RAIL.map((m) => (
                <span key={m} className="mx-7 inline-flex items-center gap-2 text-[12.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  <Feather className="size-3.5" style={{ color: C.gold }} /> {m}
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
/*  Features                                                             */
/* ===================================================================== */

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-28">
      <SectionHead kicker="Features" title={<>Everything the workflow needs,<br />nothing it doesn&rsquo;t.</>}
        sub="Real database, real auth, real role separation at the row level. Eight capabilities, shipped end to end." />

      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 3) * 0.08}>
            <div className="group h-full rounded-2xl border border-border bg-white p-6 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-foreground/15 hover:pl-shadow-lg">
              <span className="grid size-11 place-items-center rounded-xl border border-border transition-colors group-hover:border-transparent"
                style={{ background: C.cream }}>
                <f.icon className="size-[18px]" style={{ color: C.navy }} />
              </span>
              <h3 className="mt-5 text-[15.5px] font-semibold tracking-tight">{f.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{f.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ===================================================================== */
/*  How it works — uses the characters                                  */
/* ===================================================================== */

function HowItWorks() {
  return (
    <section id="how" className="border-y border-border">
      <div className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-28">
        <SectionHead kicker="How it works" title={<>Three roles,<br />one source of truth.</>}
          sub="Every goal travels the same disciplined path — and nothing important happens off the record." />

        <div className="mt-16 grid gap-10 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.1}>
              <div className="relative flex flex-col items-start">
                <div className="mb-5 flex items-center gap-3">
                  <span className="size-14 overflow-hidden rounded-full border border-border">
                    <Persona variant={s.persona} />
                  </span>
                  <span className="font-display text-[15px]" style={{ color: C.gold }}>0{i + 1}</span>
                </div>
                <h3 className="flex items-center gap-2 text-[16.5px] font-semibold tracking-tight">
                  <s.icon className="size-4" style={{ color: C.navy }} /> {s.title}
                </h3>
                <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{s.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ===================================================================== */
/*  Roles                                                                */
/* ===================================================================== */

function Roles() {
  return (
    <section id="teams" className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-28">
      <SectionHead kicker="For teams" title={<>Made for every seat<br />at the table.</>}
        sub="The same underlying data, shaped around what each person actually needs to do." />

      <div className="mt-14 grid gap-5 md:grid-cols-3">
        {ROLES.map((r, i) => (
          <Reveal key={r.name} delay={i * 0.08}>
            <div className="flex h-full flex-col rounded-2xl border border-border bg-white p-7 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:pl-shadow-lg">
              <div className="flex items-center gap-3">
                <span className="size-12 overflow-hidden rounded-full border border-border">
                  <Persona variant={r.persona} />
                </span>
                <div>
                  <div className="text-[14px] font-semibold tracking-tight">{r.name}</div>
                  <div className="text-[12px] text-muted-foreground">{r.tagline}</div>
                </div>
              </div>
              <ul className="mt-5 space-y-2.5 border-t border-border pt-5">
                {r.items.map((it) => (
                  <li key={it} className="flex gap-2.5 text-[13px] leading-relaxed text-muted-foreground">
                    <Check className="mt-0.5 size-3.5 shrink-0" style={{ color: C.gold }} /> {it}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ===================================================================== */
/*  Stats                                                                */
/* ===================================================================== */

function Stats() {
  const items = [
    { node: <CountUp to={3} />, label: 'Distinct roles' },
    { node: <CountUp to={4} />, label: 'Scoring models' },
    { node: <CountUp to={100} suffix="%" />, label: 'Weightage enforced' },
    { node: <CountUp prefix="$" to={0} />, label: 'Monthly cost' },
  ];
  return (
    <section className="border-y border-border">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-y-10 px-5 py-16 md:grid-cols-4 md:px-8">
        {items.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.06} className="text-center">
            <div className="font-display text-[44px] font-medium leading-none md:text-[52px]" style={{ color: C.navy }}>{s.node}</div>
            <div className="mt-2.5 text-[13px] text-muted-foreground">{s.label}</div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ===================================================================== */
/*  Final CTA                                                            */
/* ===================================================================== */

function FinalCTA({ onStart }: { onStart: () => void }) {
  return (
    <section className="mx-auto max-w-5xl px-5 py-24 md:px-8">
      <Reveal>
        <div className="relative overflow-hidden rounded-[2.25rem] border border-border p-10 text-center md:p-16" style={{ background: C.cream }}>
          {/* small character cast across the top */}
          <div className="mb-7 flex justify-center -space-x-3">
            {(['employee', 'manager', 'admin'] as const).map((v) => (
              <span key={v} className="size-12 overflow-hidden rounded-full border-[3px] border-white pl-shadow-sm">
                <Persona variant={v} />
              </span>
            ))}
          </div>
          <h2 className="font-display text-[2.4rem] font-medium leading-[1.06] md:text-[3.2rem]">
            Bring your team&rsquo;s goals
            <br />into the light.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-[15px] text-muted-foreground">
            Pre-seeded accounts across every role and workflow state. One click each — no password.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <PrimaryButton onClick={onStart}>Open the demo <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></PrimaryButton>
            <a href="https://github.com/Vansh150705/Plumeo" target="_blank" rel="noreferrer"
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-border bg-white px-6 text-[14.5px] font-medium transition-colors hover:bg-white/60">
              <Github className="size-4" /> View source
            </a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ===================================================================== */
/*  Footer                                                               */
/* ===================================================================== */

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-5 py-14 md:px-8">
        <div className="grid gap-10 md:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <Brandmark />
              <span className="font-display text-[19px] font-medium tracking-tight">Plumeo</span>
            </div>
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
              A lighter, more human way to set, align, and track goals across a whole team.
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
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'hsl(218 54% 12% / 0.4)' }} onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }} transition={{ duration: 0.3, ease: EASE }}
        className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-white pl-shadow-lg">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className="grid size-7 shrink-0 place-items-center rounded text-[10px] font-bold text-white" style={{ background: C.navy }}>MS</span>
          <div>
            <div className="text-[14px] font-semibold">Sign in to Plumeo</div>
            <div className="text-[11px] text-muted-foreground">Pick a demo account — no password</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="ml-auto grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
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
                  <span className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground" style={{ background: C.cream }}>{role}</span>
                  {loadingOid === entry.oid && (
                    <div className="absolute inset-0 grid place-items-center rounded-lg bg-white/80">
                      <span className="size-4 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: `${C.navy} transparent ${C.navy} ${C.navy}` }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="border-t border-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground" style={{ background: C.cream }}>
          <span className="font-medium text-foreground">Mocked for demo —</span> the response mirrors Microsoft Graph{' '}
          <code className="rounded bg-accent px-1 py-0.5 font-mono text-foreground">/me</code>; roles come from group membership.
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ===================================================================== */
/*  Shared bits                                                          */
/* ===================================================================== */

function Brandmark() {
  return (
    <span className="grid size-8 place-items-center rounded-lg" style={{ background: C.navy }}>
      <Feather className="size-[18px]" style={{ color: C.gold }} />
    </span>
  );
}

function SectionHead({ kicker, title, sub }: { kicker: string; title: ReactNode; sub: string }) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <div className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em]" style={{ color: C.gold }}>
        <span className="h-px w-6" style={{ background: C.gold }} /> {kicker} <span className="h-px w-6" style={{ background: C.gold }} />
      </div>
      <h2 className="mt-4 font-display text-[2.1rem] font-medium leading-[1.1] md:text-[2.8rem]">{title}</h2>
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
/*  Content                                                              */
/* ===================================================================== */

const NAV: [string, string][] = [
  ['Features', '#features'], ['How it works', '#how'], ['For teams', '#teams'],
];

const RAIL = [
  'Goal lifecycle', 'Manager approval', 'Shared goals', 'Quarterly check-ins',
  'Analytics', 'Immutable audit', 'Entra ID SSO', 'CSV export',
];

const FEATURES = [
  { icon: FileCheck, title: 'A lifecycle with real gates', desc: 'Draft, submit, approve, lock. Every change after lock lands in the audit log with a before/after diff.' },
  { icon: ShieldCheck, title: 'L1 approval that works', desc: 'Managers inline-edit, return for rework, or approve and lock — a real review flow, not a rubber stamp.' },
  { icon: Users, title: 'Shared goals, one push', desc: 'Cascade a department KPI to many reports at once. Weightage adjustable, target kept in sync.' },
  { icon: Target, title: 'Four scoring models', desc: 'Numeric, percentage, timeline, zero-based — each with its own formula, validated twice.' },
  { icon: BarChart3, title: 'Analytics that land', desc: 'Quarter-over-quarter trends, distribution by thrust area, and manager effectiveness.' },
  { icon: Bell, title: 'Notifications that reach', desc: 'Email, Teams, and in-app — fired on every lifecycle event and deep-linked back into the sheet.' },
  { icon: GitBranch, title: 'Rule-based escalations', desc: 'Configurable thresholds on stale approvals, routed up the org hierarchy automatically.' },
  { icon: Lock, title: 'An audit trail that lasts', desc: 'Who changed what and when, with a before/after JSON diff and one-click CSV export.' },
];

const STEPS = [
  { persona: 'employee' as const, icon: FileCheck, title: 'Employees draft & submit',
    desc: 'Pick thrust areas, set weightage, choose a unit of measure. Live validation keeps each sheet at 100% across at most eight goals.' },
  { persona: 'manager' as const, icon: ShieldCheck, title: 'Managers review & lock',
    desc: 'Inline-edit, return for rework, or approve and lock. Shared goals cascade one KPI to many reports in a single push.' },
  { persona: 'admin' as const, icon: BarChart3, title: 'Everyone tracks quarterly',
    desc: 'Planned vs actual per quarter, weighted scores recomputed on every check-in, and org-wide analytics for HR.' },
];

const ROLES = [
  { persona: 'employee' as const, name: 'Employee', tagline: 'Own your sheet, watch it add up.',
    items: ['Draft goals with live weightage validation', 'Capture planned vs actual each quarter', 'See your weighted score update instantly'] },
  { persona: 'manager' as const, name: 'Manager', tagline: 'Approve, align, keep teams on track.',
    items: ['Inline-edit or return sheets for rework', 'Push shared goals to many reports at once', 'Leave structured check-in comments'] },
  { persona: 'admin' as const, name: 'Admin / HR', tagline: 'See the whole org at a glance.',
    items: ['Analytics: trends, heatmaps, effectiveness', 'Rule-based escalations on stale approvals', 'Audit log and CSV achievement export'] },
];
