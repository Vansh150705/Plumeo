'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { getMockDirectory, ssoSignIn } from '@/lib/auth';

type Entry = Awaited<ReturnType<typeof getMockDirectory>>[number];

// ============================================================================
// Constants
// ============================================================================

const ADMIN_OIDS = ['aad-9001'];
const MANAGER_OIDS = ['aad-9002', 'aad-9003'];
const EMPLOYEE_OIDS = ['aad-9004', 'aad-9005', 'aad-9006', 'aad-9007'];

const PERSON_META: Record<string, { initials: string; context: string }> = {
  'aad-9001': { initials: 'PS', context: 'HR Director' },
  'aad-9002': { initials: 'AM', context: 'Sales · 2 reports' },
  'aad-9003': { initials: 'LR', context: 'Engineering · 2 reports' },
  'aad-9004': { initials: 'RK', context: 'Sales · Draft, 80% weight' },
  'aad-9005': { initials: 'NI', context: 'Sales · Submitted, pending' },
  'aad-9006': { initials: 'KM', context: 'Engineering · Approved & locked' },
  'aad-9007': { initials: 'AS', context: 'Engineering · Returned for rework' },
};

type ActivityIcon = 'submit' | 'checkin' | 'approve' | 'escalate';
type ActivityItem = { id: number; time: string; icon: ActivityIcon; who: string; what: string };

const ACTIVITY_TEMPLATES: { icon: ActivityIcon; who: string; what: string }[] = [
  { icon: 'submit', who: 'Ananya Sharma', what: 'submitted goal sheet for FY 2026-27' },
  { icon: 'checkin', who: 'Kabir Malhotra', what: 'updated Q2 actual: ₹4.2 Cr ARR' },
  { icon: 'approve', who: 'Lakshmi Raman', what: 'approved & locked sheet for Ananya' },
  { icon: 'submit', who: 'Rohan Kapoor', what: 'goal weightage rebalanced to 100%' },
  { icon: 'escalate', who: 'Notification dispatched', what: 'to manager via Teams + Email' },
  { icon: 'checkin', who: 'Priya Shah', what: 'exported achievement CSV (Q1)' },
  { icon: 'approve', who: 'Arjun Mehta', what: "returned Neha's sheet with comment" },
  { icon: 'submit', who: 'New cycle window opened', what: 'goal-setting open until 30 Jun' },
  { icon: 'checkin', who: 'Audit log', what: 'wrote 12 entries in the last hour' },
  { icon: 'approve', who: 'Lakshmi Raman', what: 'inline-edited a shared goal target' },
];

const SEED_ACTIVITY: ActivityItem[] = [
  { id: 1, time: '10:42', icon: 'submit', who: 'Neha Iyer', what: 'submitted Q1 goal sheet' },
  { id: 2, time: '10:38', icon: 'checkin', who: 'Kabir Malhotra', what: 'saved Q2 check-in (98/100)' },
  { id: 3, time: '10:31', icon: 'approve', who: 'Arjun Mehta', what: 'approved & locked sheet for Priya' },
  { id: 4, time: '10:22', icon: 'escalate', who: 'Escalation rule fired', what: "— Rohan's sheet 12d in Draft" },
  { id: 5, time: '10:19', icon: 'checkin', who: 'Lakshmi Raman', what: 'pushed shared goal to 2 reports' },
];

const ICON_CHAR: Record<ActivityIcon, string> = {
  submit: '→', checkin: '●', approve: '✓', escalate: '!',
};

type UomKey = 'numeric_max' | 'numeric_min' | 'percentage' | 'zero';
type UomConfig = {
  targetMin: number; targetMax: number; targetStep: number; targetDefault: number;
  actualMin: number; actualMax: number; actualStep: number; actualDefault: number;
  targetLabel: string; actualLabel: string;
  format: (v: number) => string;
  formula: { head: string; line1: string; line2: string };
  compute: (t: number, a: number) => number;
};

const UOM_CONFIGS: Record<UomKey, UomConfig> = {
  numeric_max: {
    targetMin: 1000000, targetMax: 50000000, targetStep: 500000, targetDefault: 10000000,
    actualMin: 0, actualMax: 50000000, actualStep: 100000, actualDefault: 8500000,
    targetLabel: 'Target', actualLabel: 'Achieved',
    format: (v) => '₹' + (v / 100000).toFixed(1) + ' L',
    formula: {
      head: '// Numeric, higher better',
      line1: 'score = Math.min(1, achievement / target) × 100',
      line2: 'contribution = score × (weightage / 100)',
    },
    compute: (t, a) => Math.min(100, (a / t) * 100),
  },
  numeric_min: {
    targetMin: 10, targetMax: 200, targetStep: 5, targetDefault: 50,
    actualMin: 5, actualMax: 300, actualStep: 1, actualDefault: 40,
    targetLabel: 'Max allowed', actualLabel: 'Actual',
    format: (v) => v.toFixed(0) + ' hrs',
    formula: {
      head: '// Numeric, lower better (cost, time)',
      line1: 'score = Math.min(1, target / Math.max(actual, 1)) × 100',
      line2: 'contribution = score × (weightage / 100)',
    },
    compute: (t, a) => Math.min(100, (t / Math.max(a, 1)) * 100),
  },
  percentage: {
    targetMin: 50, targetMax: 100, targetStep: 1, targetDefault: 85,
    actualMin: 0, actualMax: 100, actualStep: 1, actualDefault: 78,
    targetLabel: 'Target %', actualLabel: 'Achieved %',
    format: (v) => v.toFixed(0) + '%',
    formula: {
      head: '// Percentage (NPS, retention, etc.)',
      line1: 'score = Math.min(1, achievementPct / targetPct) × 100',
      line2: 'contribution = score × (weightage / 100)',
    },
    compute: (t, a) => Math.min(100, (a / t) * 100),
  },
  zero: {
    targetMin: 0, targetMax: 0, targetStep: 0, targetDefault: 0,
    actualMin: 0, actualMax: 5, actualStep: 1, actualDefault: 0,
    targetLabel: 'Acceptable', actualLabel: 'Incidents',
    format: (v) => (v === 0 ? '0 events' : v + ' event' + (v === 1 ? '' : 's')),
    formula: {
      head: '// Zero-based (safety, compliance)',
      line1: 'score = actual === 0 ? 100 : 0',
      line2: 'contribution = score × (weightage / 100)',
    },
    compute: (t, a) => (a === 0 ? 100 : 0),
  },
};

const FEATURES: { num: string; title: string; desc: string; variant: 'wide-blue' | 'sq-lime' | 'sq' | 'sq-orange' | 'med' | 'med-sky' | 'sq-blue' }[] = [
  { num: '01', title: '10 production-grade capabilities', desc: 'Goal lifecycle, manager approvals, shared cascade, four scoring formulas, quarterly check-ins, audit trail, escalation engine, Entra SSO, notifications, analytics. Each is a working page.', variant: 'wide-blue' },
  { num: '02', title: 'Live weightage donut', desc: 'Recomputes on every keystroke. Submit button stays locked until total = 100%.', variant: 'sq-lime' },
  { num: '03', title: 'Four scoring formulas', desc: 'Numeric ↑ / Numeric ↓ / Percentage / Zero — pure functions, identical client and server.', variant: 'sq' },
  { num: '04', title: 'Shared goals cascade', desc: 'One push → N reports. Title locked, weightage adjustable on recipient.', variant: 'sq-orange' },
  { num: '05', title: 'Row-level security', desc: 'Employees see own. Managers see team. Admins see all. Enforced in Postgres.', variant: 'sq' },
  { num: '06', title: 'Notifications fan out across 3 channels', desc: 'Every lifecycle event queues to Email + MS Teams + In-app. Production swaps to SendGrid + Graph API.', variant: 'med' },
  { num: '07', title: 'Rule-based escalation engine', desc: 'Configurable N-day thresholds. Cron runs nightly. Routes up org hierarchy automatically.', variant: 'med-sky' },
  { num: '08', title: 'Microsoft Entra ID SSO', desc: 'Mocked but shape-correct. Group → role mapping derived automatically.', variant: 'sq' },
  { num: '09', title: 'Analytics dashboard', desc: 'QoQ trend, heatmap, manager effectiveness, goal distribution. Five Recharts visualisations.', variant: 'sq-blue' },
  { num: '10', title: 'Immutable audit log', desc: 'Before/after JSON diff on every mutation. Exportable as CSV. Compliance-grade.', variant: 'sq' },
];

// ============================================================================
// MAIN
// ============================================================================

export function LandingClient() {
  const [directory, setDirectory] = useState<Entry[]>([]);
  const [pending, startTransition] = useTransition();
  const [loadingOid, setLoadingOid] = useState<string | null>(null);

  const [activity, setActivity] = useState<ActivityItem[]>(SEED_ACTIVITY);
  const [latency, setLatency] = useState(12);
  const activityCounter = useRef(SEED_ACTIVITY.length + 1);
  const tplIdx = useRef(0);

  const [uom, setUom] = useState<UomKey>('numeric_max');
  const config = UOM_CONFIGS[uom];
  const [target, setTarget] = useState(config.targetDefault);
  const [actual, setActual] = useState(config.actualDefault);
  const [weight, setWeight] = useState(25);

  useEffect(() => { getMockDirectory().then(setDirectory); }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(hover: none)').matches) return;
    const hero = document.getElementById('plm-hero');
    if (!hero) return;
    let raf = 0;
    function onMove(e: MouseEvent) {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = hero!.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        hero!.style.setProperty('--mx', x + '%');
        hero!.style.setProperty('--my', y + '%');
      });
    }
    hero.addEventListener('mousemove', onMove);
    return () => { hero.removeEventListener('mousemove', onMove); if (raf) cancelAnimationFrame(raf); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setLatency(8 + Math.floor(Math.random() * 11)), 2400);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    function pushItem() {
      const tpl = ACTIVITY_TEMPLATES[tplIdx.current % ACTIVITY_TEMPLATES.length];
      tplIdx.current++;
      const now = new Date();
      const time = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      setActivity(prev => [{ id: activityCounter.current++, time, icon: tpl.icon, who: tpl.who, what: tpl.what }, ...prev].slice(0, 6));
    }
    const start = setTimeout(() => { pushItem(); interval = setInterval(pushItem, 7000); }, 4000);
    return () => { clearTimeout(start); if (interval) clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const el = entry.target as HTMLElement;
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
          observer.unobserve(el);
        }
      });
    }, { threshold: 0.1 });
    document.querySelectorAll<HTMLElement>('.plm-reveal').forEach((el) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(40px)';
      el.style.transition = 'opacity 0.7s cubic-bezier(0.2, 0.7, 0.2, 1), transform 0.7s cubic-bezier(0.2, 0.7, 0.2, 1)';
      observer.observe(el);
    });
    return () => observer.disconnect();
  }, [directory.length]);

  useEffect(() => {
    setTarget(config.targetDefault);
    setActual(config.actualDefault);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uom]);

  function scrollToSignin() {
    document.getElementById('plm-signin')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function handleSignIn(oid: string) {
    setLoadingOid(oid);
    startTransition(async () => {
      try { await ssoSignIn(oid); }
      catch (err) { console.error(err); setLoadingOid(null); }
    });
  }

  const score = config.compute(target, actual);
  const contrib = (score * weight) / 100;
  const variance = uom === 'zero' ? (actual === 0 ? 0 : actual) : ((actual - target) / target) * 100;
  const statusText = score >= 95 ? 'Completed' : score >= 70 ? 'On Track' : score >= 40 ? 'At Risk' : 'Off Track';
  const statusBlurb = score >= 95 ? 'target hit or exceeded' : score >= 70 ? 'pacing close to target' : score >= 40 ? 'falling behind, manager flagged' : 'significant shortfall';

  const admins = directory.filter(d => ADMIN_OIDS.includes(d.oid));
  const managers = directory.filter(d => MANAGER_OIDS.includes(d.oid));
  const employees = directory.filter(d => EMPLOYEE_OIDS.includes(d.oid));

  return (
    <div className="plm-root">
      {/* HEADER */}
      <header className="plm-header">
        <div className="plm-header-row">
          <div className="plm-logo">
            <div className="plm-logo-mark">P</div>
            <span>Plumeo</span>
          </div>
          <nav className="plm-nav">
            <a href="#roles">Roles</a>
            <a href="#features">Features</a>
            <a href="#demo">Live demo</a>
            <a href="https://github.com/Vansh150705/Plumeo" target="_blank" rel="noreferrer">GitHub ↗</a>
          </nav>
          <button type="button" className="plm-nav-cta" onClick={scrollToSignin}>
            Sign in →
          </button>
        </div>
      </header>

      {/* HERO */}
      <section className="plm-hero" id="plm-hero">
        <div className="plm-spotlight" aria-hidden="true" />
        <div className="plm-floater plm-f1" />
        <div className="plm-floater plm-f2" />
        <div className="plm-floater plm-f3" />

        <div className="plm-container">
          <div className="plm-hero-grid">
            {/* LEFT */}
            <div>
              <div className="plm-hero-tag">
                <span className="plm-dot-pulse" />
                Personal project · Vansh Mahajan
              </div>

              <h1 className="plm-hero-title">
                Goals,<br />
                <span className="plm-highlight">accounted</span><br />
                for<span className="plm-period">.</span>
              </h1>

              <p className="plm-hero-lede">
                Every goal weighted. Every check-in scored. Every change audited.
                A working goal-setting portal <span className="plm-ital">— three roles, ten tables, one Postgres database.</span>
              </p>

              <div className="plm-hero-ctas">
                <button type="button" className="plm-btn-primary" onClick={scrollToSignin}>
                  Pick a role to try
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M3 9H15M15 9L9 3M15 9L9 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <a href="#features" className="plm-btn-secondary">See how it's built</a>
              </div>
            </div>

            {/* RIGHT — stacked preview cards */}
            <div className="plm-preview-stack">
              <div className="plm-pcard plm-pc-1">
                <div className="plm-pc-header">
                  <span>EMPLOYEE · LOCKED</span>
                  <span>Q2 / 2026-27</span>
                </div>
                <div className="plm-pc-title">Kabir's goal sheet</div>
                <div className="plm-pc-meta">6 goals · Engineering · Locked Mar 14</div>
                <div className="plm-donut">
                  <svg width="60" height="60" viewBox="0 0 60 60">
                    <circle cx="30" cy="30" r="24" stroke="#0a0a0a" strokeWidth="2" fill="none" opacity="0.15" />
                    <circle cx="30" cy="30" r="24" stroke="#0a0a0a" strokeWidth="6" fill="none" strokeLinecap="round" strokeDasharray="150.8" strokeDashoffset="0" transform="rotate(-90 30 30)" />
                  </svg>
                  <div>
                    <div className="plm-donut-num">100<span className="plm-donut-pct">%</span></div>
                    <div className="plm-donut-lbl">Weightage</div>
                  </div>
                </div>
                <div className="plm-row-pill">
                  <span className="plm-weight">25%</span>
                  <span className="plm-flex">Ship payments redesign</span>
                  <span className="plm-pc-score">100</span>
                </div>
                <div className="plm-row-pill">
                  <span className="plm-weight">20%</span>
                  <span className="plm-flex">Zero P0 incidents</span>
                  <span className="plm-pc-score">100</span>
                </div>
              </div>

              <div className="plm-pcard plm-pc-2">
                <div className="plm-pc-header plm-pc-header-light">
                  <span>MANAGER · APPROVALS</span>
                  <span>3 PENDING</span>
                </div>
                <div className="plm-pc-title plm-pc-title-italic">Neha's sheet awaits.</div>
                <div className="plm-pc-meta plm-pc-meta-light">5 goals · 100% balanced · Submitted 5d ago</div>
                <div className="plm-pc-actions">
                  <button type="button" className="plm-pc-approve">Approve →</button>
                  <button type="button" className="plm-pc-return">Return</button>
                </div>
              </div>

              <div className="plm-pcard plm-pc-3">
                <div className="plm-pc-header plm-pc-header-light">
                  <span>ADMIN · ESCALATIONS</span>
                  <span>+2 NEW</span>
                </div>
                <div className="plm-pc-title">Rohan — 12d in Draft</div>
                <div className="plm-pc-desc">Auto-routed to manager via rule "Goal submission overdue → L1."</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* MARQUEE */}
      <div className="plm-marquee">
        <div className="plm-marquee-track">
          {[...Array(2)].map((_, k) => (
            <span key={k}>
              <span>Built end-to-end<span className="plm-mq-dot" /></span>
              <span>3 roles<span className="plm-mq-dot" /></span>
              <span>4 scoring formulas<span className="plm-mq-dot" /></span>
              <span>10 Postgres tables<span className="plm-mq-dot" /></span>
              <span>Row-level security<span className="plm-mq-dot" /></span>
              <span>$0/mo hosted<span className="plm-mq-dot" /></span>
              <span>Next.js · Supabase · Vercel<span className="plm-mq-dot" /></span>
            </span>
          ))}
        </div>
      </div>

      {/* SYSTEM STATUS + ACTIVITY */}
      <section className="plm-section">
        <div className="plm-container">
          <div className="plm-section-tag plm-reveal">Live</div>
          <h2 className="plm-section-title plm-reveal">It's running <span className="plm-ital">right now.</span></h2>

          <div className="plm-live-grid plm-reveal">
            <div className="plm-system-panel">
              <div className="plm-system-head">
                <div className="plm-browser-dots"><span /><span /><span /></div>
                <div className="plm-system-url">plumeo-ai.vercel.app</div>
              </div>
              <div className="plm-system-status">
                <span className="plm-system-live-dot" />
                <span className="plm-system-live-text">Production</span>
                <span className="plm-system-meta">edge · {latency}ms</span>
              </div>
              <div className="plm-system-metrics">
                <div>
                  <div className="plm-metric-num">7</div>
                  <div className="plm-metric-label">Active users</div>
                </div>
                <div>
                  <div className="plm-metric-num">6 <span className="plm-metric-trend">+1</span></div>
                  <div className="plm-metric-label">Sheets in cycle</div>
                </div>
                <div>
                  <div className="plm-metric-num">2</div>
                  <div className="plm-metric-label">Escalations open</div>
                </div>
              </div>
            </div>

            <div className="plm-activity">
              <div className="plm-activity-head">
                <div className="plm-activity-title">Recent activity</div>
                <div className="plm-activity-counter">last 60 min</div>
              </div>
              <ul className="plm-activity-list">
                {activity.map((item, idx) => (
                  <li key={item.id} className={`plm-activity-item ${idx === 0 && item.id > SEED_ACTIVITY.length ? 'is-new' : ''}`}>
                    <span className="plm-activity-time">{item.time}</span>
                    <span className={`plm-activity-icon ${item.icon}`}>{ICON_CHAR[item.icon]}</span>
                    <span className="plm-activity-text">
                      <span className="plm-who">{item.who}</span>{' '}
                      <span className="plm-what">{item.what}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ROLES */}
      <section className="plm-section" id="roles">
        <div className="plm-container">
          <div className="plm-section-tag plm-reveal">Try it</div>
          <h2 className="plm-section-title plm-reveal">Three roles. One click <span className="plm-ital">each.</span></h2>
          <p className="plm-section-deck plm-reveal">No password. The mocked Entra ID directory mirrors Microsoft Graph's <span className="plm-mono">/me</span> response shape — pick a card to enter as that person.</p>

          <div className="plm-roles-grid">
            {admins.map((p, i) => <RoleCard key={p.oid} person={p} role="ADMIN" num="01" tone="lime" onSignIn={handleSignIn} loadingOid={loadingOid} pending={pending} delay={i} />)}
            {managers.map((p, i) => <RoleCard key={p.oid} person={p} role="MANAGER" num={`0${i + 2}`} tone="sky" onSignIn={handleSignIn} loadingOid={loadingOid} pending={pending} delay={i + 1} />)}
            <div className="plm-roles-subgroup plm-reveal">
              <div className="plm-roles-sublabel">Employees · 04</div>
              {employees.map((p, i) => (
                <button
                  key={p.oid} type="button" disabled={pending}
                  onClick={() => handleSignIn(p.oid)}
                  className="plm-emp-card"
                >
                  <div className="plm-emp-avatar">{PERSON_META[p.oid]?.initials || p.displayName.slice(0, 2).toUpperCase()}</div>
                  <div className="plm-emp-body">
                    <div className="plm-emp-name">{p.displayName}</div>
                    <div className="plm-emp-meta">{PERSON_META[p.oid]?.context || p.department}</div>
                  </div>
                  <div className="plm-emp-arrow">{loadingOid === p.oid ? '…' : '↗'}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES BENTO */}
      <section className="plm-section" id="features">
        <div className="plm-container">
          <div className="plm-section-tag plm-reveal">What's inside</div>
          <h2 className="plm-section-title plm-reveal">Built end-to-end. <span className="plm-ital">All of it.</span></h2>

          <div className="plm-bento">
            {FEATURES.map(f => (
              <div key={f.num} className={`plm-bento-card plm-b-${f.variant} plm-reveal`}>
                <div className="plm-num-badge">{f.num}</div>
                <h4>{f.title}</h4>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* LIVE DEMO — SCORING ENGINE */}
      <section className="plm-section" id="demo">
        <div className="plm-container">
          <div className="plm-section-tag plm-reveal">Live demo</div>
          <h2 className="plm-section-title plm-reveal">The scoring engine, <span className="plm-ital">actually running.</span></h2>
          <p className="plm-section-deck plm-reveal">Adjust the inputs. The score recomputes with the same pure function the server uses to validate every check-in. This is <span className="plm-mono">lib/goals.ts</span> executing in your browser.</p>

          <div className="plm-scoring plm-reveal">
            <div className="plm-scoring-head">
              <div className="plm-scoring-title">Try each scoring formula</div>
              <div className="plm-scoring-tag"><span /> Live · same code as server</div>
            </div>
            <div className="plm-scoring-body">
              <div className="plm-scoring-input">
                <div className="plm-uom-tabs">
                  {(['numeric_max', 'numeric_min', 'percentage', 'zero'] as UomKey[]).map(u => (
                    <button key={u} type="button" className={`plm-uom-tab ${uom === u ? 'active' : ''}`} onClick={() => setUom(u)}>
                      {u === 'numeric_max' ? 'Numeric ↑' : u === 'numeric_min' ? 'Numeric ↓' : u === 'percentage' ? 'Percentage' : 'Zero-based'}
                    </button>
                  ))}
                </div>

                {uom !== 'zero' && (
                  <div className="plm-scoring-field">
                    <div className="plm-scoring-field-label">
                      <span>{config.targetLabel}</span>
                      <span className="plm-val">{config.format(target)}</span>
                    </div>
                    <input type="range" className="plm-slider"
                      min={config.targetMin} max={config.targetMax} step={config.targetStep || 1}
                      value={target} onChange={(e) => setTarget(Number(e.target.value))} />
                  </div>
                )}

                <div className="plm-scoring-field">
                  <div className="plm-scoring-field-label">
                    <span>{config.actualLabel}</span>
                    <span className="plm-val">{config.format(actual)}</span>
                  </div>
                  <input type="range" className="plm-slider"
                    min={config.actualMin} max={config.actualMax} step={config.actualStep}
                    value={actual} onChange={(e) => setActual(Number(e.target.value))} />
                </div>

                <div className="plm-scoring-field">
                  <div className="plm-scoring-field-label">
                    <span>Weightage</span>
                    <span className="plm-val">{weight}%</span>
                  </div>
                  <input type="range" className="plm-slider"
                    min={10} max={40} step={5}
                    value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
                </div>

                <div className="plm-formula">
                  <span className="plm-com">{config.formula.head}</span><br />
                  {config.formula.line1}<br />
                  {config.formula.line2}
                </div>
              </div>

              <div className="plm-scoring-divider" />

              <div className="plm-scoring-output">
                <div className="plm-scoring-result-label">Computed score</div>
                <div className={`plm-result-num ${score >= 95 ? 'is-perfect' : score < 50 ? 'is-bad' : ''}`}>
                  {Math.round(score)}<span className="plm-pct">/100</span>
                </div>
                <div className="plm-result-bar-wrap">
                  <div className="plm-result-bar" style={{ width: `${score}%` }} />
                </div>
                <div className="plm-scoring-status">
                  <strong>{statusText}</strong>. {statusBlurb}. Weighted contribution toward total sheet score: <strong>{contrib.toFixed(2)}</strong> of <strong>100</strong>.
                </div>
                <div className="plm-callouts">
                  <div className="plm-callout">
                    <div className="plm-callout-label">Variance</div>
                    <div className="plm-callout-val">
                      {uom === 'zero' ? (actual === 0 ? '0' : `+${actual}`) : (variance >= 0 ? '+' : '') + variance.toFixed(0) + '%'}
                    </div>
                  </div>
                  <div className="plm-callout">
                    <div className="plm-callout-label">Status pill</div>
                    <div className="plm-callout-val">{statusText}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SIGN-IN PANEL */}
      <section className="plm-section" id="plm-signin">
        <div className="plm-container">
          <div className="plm-section-tag plm-reveal">Sign in</div>
          <h2 className="plm-section-title plm-reveal">Pick a person. <span className="plm-ital">No password.</span></h2>

          <div className="plm-signin plm-reveal">
            <div className="plm-signin-header">
              <div className="plm-ms-mark"><span /><span /><span /><span /></div>
              <div className="plm-signin-header-title">
                Sign in with Microsoft Entra ID
                <small>Pick any account. No password required.</small>
              </div>
              <div className="plm-signin-header-right">{directory.length || '7'} demo accounts</div>
            </div>

            <div className="plm-signin-groups">
              <PersonColumn label="Admin" count="01" people={admins} avatarClass="admin" onSignIn={handleSignIn} loadingOid={loadingOid} pending={pending} />
              <PersonColumn label="Managers · L1" count="02" people={managers} avatarClass="manager" onSignIn={handleSignIn} loadingOid={loadingOid} pending={pending} />
              <PersonColumn label="Employees" count="04" people={employees} avatarClass="employee" onSignIn={handleSignIn} loadingOid={loadingOid} pending={pending} />
            </div>
          </div>
        </div>
      </section>

      {/* ARCHITECTURE */}
      <section className="plm-arch-section">
        <div className="plm-container">
          <div className="plm-arch-grid">
            <div>
              <div className="plm-section-tag plm-tag-light plm-reveal">Architecture</div>
              <h2 className="plm-section-title plm-section-title-light plm-reveal">Serverless<br />from edge<br />to <span className="plm-ital-light">database.</span></h2>
              <p className="plm-reveal plm-arch-deck">Next.js 14 on Vercel's edge speaks directly to Supabase Postgres. RLS replaces a separate auth service. Server actions handle every mutation. An audit log captures every change.</p>

              <div className="plm-arch-stat plm-reveal">
                <div className="plm-arch-stat-num">3</div>
                <div className="plm-arch-stat-label">Production-grade services</div>
                <div className="plm-arch-stat-tag">all free tier</div>
              </div>
              <div className="plm-arch-stat plm-reveal">
                <div className="plm-arch-stat-num">$0</div>
                <div className="plm-arch-stat-label">Monthly cost up to 50k MAU</div>
                <div className="plm-arch-stat-tag">serverless</div>
              </div>
              <div className="plm-arch-stat plm-reveal">
                <div className="plm-arch-stat-num">25</div>
                <div className="plm-arch-stat-label">Routes, all server-rendered</div>
                <div className="plm-arch-stat-tag">SSR</div>
              </div>
            </div>

            <div className="plm-arch-diagram plm-reveal">
              <div className="plm-arch-divider">— TIER 01 · CLIENT —</div>
              <div className="plm-arch-row plm-arch-row-2">
                <div className="plm-arch-node">
                  <div className="plm-arch-node-title">Web browser</div>
                  <div className="plm-arch-node-sub">DESKTOP · MOBILE</div>
                </div>
                <div className="plm-arch-node">
                  <div className="plm-arch-node-title">Teams + Email</div>
                  <div className="plm-arch-node-sub">NOTIFICATION TARGETS</div>
                </div>
              </div>

              <div className="plm-arch-divider">— TIER 02 · VERCEL EDGE —</div>
              <div className="plm-arch-row plm-arch-row-3">
                <div className="plm-arch-node plm-tier-edge">
                  <div className="plm-arch-node-title">Next.js 14</div>
                  <div className="plm-arch-node-sub">SSR · RSC</div>
                </div>
                <div className="plm-arch-node plm-tier-edge">
                  <div className="plm-arch-node-title">Server Actions</div>
                  <div className="plm-arch-node-sub">MUTATIONS · AUDIT</div>
                </div>
                <div className="plm-arch-node plm-tier-edge">
                  <div className="plm-arch-node-title">API + Cron</div>
                  <div className="plm-arch-node-sub">CSV · ESCALATION</div>
                </div>
              </div>

              <div className="plm-arch-divider">— TIER 03 · SUPABASE —</div>
              <div className="plm-arch-row plm-arch-row-3">
                <div className="plm-arch-node plm-tier-data">
                  <div className="plm-arch-node-title">Postgres + RLS</div>
                  <div className="plm-arch-node-sub">10 TABLES · 8 POLICIES</div>
                </div>
                <div className="plm-arch-node plm-tier-data">
                  <div className="plm-arch-node-title">Supabase Auth</div>
                  <div className="plm-arch-node-sub">JWT · ENTRA MOCK</div>
                </div>
                <div className="plm-arch-node plm-tier-data">
                  <div className="plm-arch-node-title">Notifications</div>
                  <div className="plm-arch-node-sub">QUEUE · FAN-OUT</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="plm-section">
        <div className="plm-container">
          <div className="plm-cta plm-reveal">
            <div className="plm-section-tag">Done reading?</div>
            <h2 className="plm-cta-title">
              Sign in.<br />
              <span className="plm-ital-orange">Click around.</span>
            </h2>
            <button type="button" className="plm-btn-primary plm-cta-btn" onClick={scrollToSignin}>
              Open the Entra ID picker
              <svg width="20" height="20" viewBox="0 0 18 18" fill="none">
                <path d="M3 9H15M15 9L9 3M15 9L9 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <footer className="plm-footer">
            <div>Vansh Mahajan · <a href="https://github.com/Vansh150705/Plumeo" target="_blank" rel="noreferrer">github.com/Vansh150705/Plumeo</a></div>
            <div>Built on Next.js · Supabase · Vercel</div>
          </footer>
        </div>
      </section>

      <LandingStyles />
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function RoleCard({ person, role, num, tone, onSignIn, loadingOid, pending, delay }: {
  person: Entry; role: string; num: string; tone: 'lime' | 'sky' | 'orange';
  onSignIn: (oid: string) => void; loadingOid: string | null; pending: boolean; delay: number;
}) {
  const meta = PERSON_META[person.oid];
  const loading = loadingOid === person.oid;
  return (
    <button
      type="button" disabled={pending}
      onClick={() => onSignIn(person.oid)}
      className={`plm-role-card plm-role-${tone} plm-reveal`}
      style={{ transitionDelay: `${delay * 80}ms` }}
    >
      <div className="plm-role-num">{num} · {role}</div>
      <div className="plm-role-name">{person.displayName.split(' ').map((w, i) => <span key={i}>{w}<br /></span>)}</div>
      <div className="plm-role-title">{meta?.context || person.department} · {person.upn}</div>
      <div className="plm-role-state">
        {role === 'ADMIN' && 'Sees the org-wide dashboard, escalation rules, audit log, and analytics. Can run sweeps, sync Entra, export CSV.'}
        {role === 'MANAGER' && 'Has 2 direct reports. Submitted sheets await approval. Can inline-edit, return, or approve & lock.'}
      </div>
      <div className="plm-role-arrow">{loading ? '…' : '↗'}</div>
    </button>
  );
}

function PersonColumn({ label, count, people, avatarClass, onSignIn, loadingOid, pending }: {
  label: string; count: string; people: Entry[]; avatarClass: 'admin' | 'manager' | 'employee';
  onSignIn: (oid: string) => void; loadingOid: string | null; pending: boolean;
}) {
  return (
    <div className="plm-signin-group">
      <div className="plm-signin-group-label">{label} <span className="plm-signin-count">{count}</span></div>
      <div className="plm-signin-people">
        {people.map(p => {
          const meta = PERSON_META[p.oid];
          const loading = loadingOid === p.oid;
          return (
            <button key={p.oid} type="button" className="plm-person" disabled={pending} onClick={() => onSignIn(p.oid)}>
              <div className={`plm-person-avatar ${avatarClass}`}>{meta?.initials || p.displayName.slice(0, 2).toUpperCase()}</div>
              <div className="plm-person-body">
                <div className="plm-person-name">{p.displayName}</div>
                <div className="plm-person-meta">{meta?.context || p.department}</div>
              </div>
              <div className="plm-person-arrow">{loading ? '…' : '→'}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Styles
// ============================================================================

function LandingStyles() {
  return (
    <style jsx global>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap');

      .plm-root {
        --white: #ffffff;
        --paper: #ffffff;
        --soft: #fafafa;
        --ink: #0a0a0a;
        --electric: #2d4eff;
        --orange: #ff5418;
        --lime: #c3f53c;
        --sky: #b8d4ff;
        --muted: #5a5e6b;
        --hairline: #e5e5e4;
        background: var(--white);
        color: var(--ink);
        font-family: 'Space Grotesk', -apple-system, sans-serif;
        font-size: 15px;
        line-height: 1.5;
        min-height: 100vh;
        overflow-x: hidden;
      }
      .plm-root * { box-sizing: border-box; }
      .plm-container { max-width: 1320px; margin: 0 auto; padding: 0 32px; }
      .plm-ital { font-family: 'Instrument Serif', serif; font-style: italic; font-weight: 400; color: var(--electric); }
      .plm-mono { font-family: 'JetBrains Mono', monospace; font-size: 0.9em; background: var(--soft); padding: 1px 6px; border-radius: 3px; }

      /* HEADER */
      .plm-header { position: sticky; top: 0; z-index: 100; background: var(--white); border-bottom: 3px solid var(--ink); }
      .plm-header-row { display: flex; align-items: center; justify-content: space-between; padding: 14px 32px; max-width: 1320px; margin: 0 auto; }
      .plm-logo { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 18px; }
      .plm-logo-mark { width: 28px; height: 28px; background: var(--ink); color: var(--white); display: grid; place-items: center; border-radius: 4px; font-family: 'Instrument Serif', serif; font-size: 22px; font-style: italic; line-height: 1; transform: rotate(-3deg); transition: transform 0.3s; }
      .plm-logo:hover .plm-logo-mark { transform: rotate(8deg) scale(1.1); }
      .plm-nav { display: flex; gap: 4px; }
      .plm-nav a { padding: 6px 12px; font-size: 13px; color: var(--ink); text-decoration: none; border-radius: 999px; transition: all 0.15s; }
      .plm-nav a:hover { background: var(--ink); color: var(--white); }
      .plm-nav-cta { background: var(--ink); color: var(--white); padding: 10px 18px; border-radius: 999px; font-size: 13px; font-weight: 500; border: 0; cursor: pointer; font-family: inherit; transition: all 0.2s; display: inline-flex; align-items: center; gap: 6px; }
      .plm-nav-cta:hover { background: var(--electric); transform: translate(-2px, -2px); box-shadow: 4px 4px 0 var(--ink); }

      /* HERO */
      .plm-hero { padding: 80px 0 120px; position: relative; overflow: hidden; }
      .plm-spotlight { position: absolute; inset: 0; pointer-events: none; z-index: 0; background: radial-gradient(800px circle at var(--mx, 50%) var(--my, 30%), rgba(45, 78, 255, 0.05), transparent 60%); transition: background 0.3s ease-out; }
      @media (hover: none) { .plm-spotlight { display: none; } }

      .plm-floater { position: absolute; z-index: 1; pointer-events: none; }
      .plm-f1 { top: 120px; left: -40px; width: 80px; height: 80px; background: var(--orange); border-radius: 50%; animation: plm-float-a 8s ease-in-out infinite; }
      .plm-f2 { top: 60px; left: 45%; width: 60px; height: 60px; background: var(--electric); transform: rotate(45deg); animation: plm-float-b 6s ease-in-out infinite; }
      .plm-f3 { top: 460px; left: 10%; width: 120px; height: 12px; background: var(--lime); border: 2px solid var(--ink); border-radius: 999px; transform: rotate(-12deg); animation: plm-float-a 10s ease-in-out infinite reverse; }
      @keyframes plm-float-a { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-30px) rotate(15deg); } }
      @keyframes plm-float-b { 0%, 100% { transform: translateY(0) rotate(45deg); } 50% { transform: translateY(20px) rotate(60deg); } }

      .plm-hero-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 60px; align-items: start; position: relative; z-index: 2; }
      .plm-hero-tag { display: inline-flex; align-items: center; gap: 8px; background: var(--lime); border: 2px solid var(--ink); padding: 6px 14px; border-radius: 999px; font-family: 'JetBrains Mono', monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; transform: rotate(-1.5deg); margin-bottom: 32px; box-shadow: 4px 4px 0 var(--ink); transition: transform 0.3s; }
      .plm-hero-tag:hover { transform: rotate(0deg) scale(1.05); }
      .plm-dot-pulse { width: 8px; height: 8px; background: var(--orange); border-radius: 50%; animation: plm-pulse-dot 1.5s ease-in-out infinite; }
      @keyframes plm-pulse-dot { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.4); opacity: 0.6; } }

      .plm-hero-title { font-size: clamp(64px, 9vw, 152px); line-height: 0.88; letter-spacing: -0.045em; font-weight: 700; margin: 0 0 36px; }
      .plm-highlight { background: var(--lime); padding: 0 8px; display: inline-block; transform: skew(-3deg); box-shadow: 6px 6px 0 var(--ink); border: 3px solid var(--ink); }
      .plm-period { font-family: 'Instrument Serif', serif; font-style: italic; color: var(--electric); }
      .plm-hero-lede { font-size: 22px; line-height: 1.4; max-width: 540px; margin-bottom: 40px; }

      .plm-hero-ctas { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }
      .plm-btn-primary { background: var(--ink); color: var(--white); padding: 18px 28px; border: 3px solid var(--ink); border-radius: 999px; font-size: 16px; font-weight: 500; text-decoration: none; display: inline-flex; align-items: center; gap: 10px; transition: all 0.2s; cursor: pointer; box-shadow: 6px 6px 0 var(--orange); font-family: inherit; }
      .plm-btn-primary:hover { transform: translate(-3px, -3px); box-shadow: 9px 9px 0 var(--orange); }
      .plm-btn-secondary { background: transparent; color: var(--ink); padding: 18px 28px; border: 3px solid var(--ink); border-radius: 999px; font-size: 16px; font-weight: 500; text-decoration: none; transition: all 0.2s; cursor: pointer; font-family: inherit; }
      .plm-btn-secondary:hover { background: var(--ink); color: var(--white); }

      /* Preview cards */
      .plm-preview-stack { position: relative; height: 540px; }
      .plm-pcard { position: absolute; background: var(--white); border: 3px solid var(--ink); border-radius: 18px; box-shadow: 8px 8px 0 var(--ink); padding: 18px; transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
      .plm-pc-1 { top: 0; right: 40px; transform: rotate(2.5deg); z-index: 3; width: 380px; }
      .plm-pc-1:hover { transform: rotate(0deg) translateY(-6px); }
      .plm-pc-2 { top: 180px; right: 0; transform: rotate(-2deg); background: var(--electric); color: var(--white); z-index: 2; width: 320px; }
      .plm-pc-2:hover { transform: rotate(0deg) translateY(-6px); }
      .plm-pc-3 { top: 360px; right: 80px; transform: rotate(1.5deg); background: var(--orange); color: var(--white); z-index: 1; width: 280px; }
      .plm-pc-3:hover { transform: rotate(0deg) translateY(-6px); }
      .plm-pc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.7; }
      .plm-pc-header-light { opacity: 1; color: var(--white); }
      .plm-pc-title { font-size: 24px; line-height: 1.1; margin-bottom: 6px; font-weight: 600; }
      .plm-pc-title-italic { font-family: 'Instrument Serif', serif; font-style: italic; font-weight: 400; }
      .plm-pc-meta { font-size: 13px; opacity: 0.75; margin-bottom: 14px; }
      .plm-pc-meta-light { color: rgba(255,255,255,0.85); }
      .plm-pc-desc { font-size: 12px; opacity: 0.85; line-height: 1.4; color: var(--white); }
      .plm-donut { display: flex; align-items: center; gap: 16px; padding: 14px; border: 2px solid var(--ink); border-radius: 12px; margin-bottom: 12px; }
      .plm-donut svg { flex-shrink: 0; }
      .plm-donut-num { font-size: 36px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; }
      .plm-donut-pct { font-size: 18px; }
      .plm-donut-lbl { font-size: 11px; font-family: 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.7; margin-top: 4px; }
      .plm-row-pill { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: var(--white); border: 2px solid var(--ink); border-radius: 999px; margin-bottom: 6px; font-size: 12px; }
      .plm-weight { background: var(--ink); color: var(--white); padding: 2px 8px; border-radius: 999px; font-family: 'JetBrains Mono', monospace; font-size: 10px; }
      .plm-flex { flex: 1; }
      .plm-pc-score { color: var(--electric); font-weight: 600; }
      .plm-pc-actions { display: flex; gap: 8px; margin-top: 16px; }
      .plm-pc-approve { flex: 1; background: var(--white); color: var(--ink); border: 0; padding: 10px; border-radius: 999px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
      .plm-pc-return { flex: 1; background: transparent; color: var(--white); border: 1.5px solid var(--white); padding: 10px; border-radius: 999px; font-size: 12px; cursor: pointer; font-family: inherit; }

      /* MARQUEE */
      .plm-marquee { background: var(--ink); color: var(--white); padding: 18px 0; overflow: hidden; border-top: 3px solid var(--ink); border-bottom: 3px solid var(--ink); }
      .plm-marquee-track { display: flex; gap: 48px; animation: plm-scroll-x 24s linear infinite; white-space: nowrap; font-family: 'JetBrains Mono', monospace; font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; }
      .plm-marquee-track > span { display: flex; align-items: center; gap: 48px; }
      .plm-marquee-track .plm-mq-dot { display: inline-block; width: 6px; height: 6px; background: var(--orange); border-radius: 50%; margin-left: 48px; }
      @keyframes plm-scroll-x { from { transform: translateX(0); } to { transform: translateX(-50%); } }

      /* SECTIONS */
      .plm-section { padding: 100px 0; }
      .plm-section-tag { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 16px; font-family: 'JetBrains Mono', monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; }
      .plm-section-tag::before { content: ''; width: 24px; height: 2px; background: var(--ink); }
      .plm-section-title { font-size: clamp(48px, 6vw, 88px); line-height: 0.9; letter-spacing: -0.035em; font-weight: 700; margin: 0 0 24px; }
      .plm-section-deck { font-size: 18px; max-width: 560px; opacity: 0.7; margin-bottom: 56px; line-height: 1.5; }

      /* LIVE GRID */
      .plm-live-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 48px; }
      .plm-system-panel { background: var(--white); border: 3px solid var(--ink); border-radius: 18px; box-shadow: 6px 6px 0 var(--ink); overflow: hidden; }
      .plm-system-head { padding: 14px 18px; background: var(--soft); border-bottom: 2px solid var(--ink); display: flex; align-items: center; gap: 12px; }
      .plm-browser-dots { display: flex; gap: 5px; }
      .plm-browser-dots span { width: 9px; height: 9px; border-radius: 50%; background: var(--ink); opacity: 0.3; }
      .plm-system-url { flex: 1; text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 5px 12px; background: var(--white); border: 2px solid var(--ink); border-radius: 6px; }
      .plm-system-status { padding: 16px 18px; border-bottom: 2px solid var(--ink); display: flex; align-items: center; gap: 12px; font-size: 13px; }
      .plm-system-live-dot { width: 9px; height: 9px; border-radius: 50%; background: #15803d; flex-shrink: 0; position: relative; }
      .plm-system-live-dot::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; background: #15803d; opacity: 0.3; animation: plm-ping 1.8s ease-out infinite; }
      @keyframes plm-ping { 0% { transform: scale(1); opacity: 0.3; } 100% { transform: scale(2.2); opacity: 0; } }
      .plm-system-live-text { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #15803d; }
      .plm-system-meta { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 11px; opacity: 0.6; }
      .plm-system-metrics { padding: 22px 18px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
      .plm-metric-num { font-size: 32px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; font-feature-settings: 'tnum'; display: flex; align-items: baseline; gap: 6px; }
      .plm-metric-trend { font-size: 12px; font-weight: 600; color: #15803d; }
      .plm-metric-label { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.6; margin-top: 6px; }

      .plm-activity { background: var(--white); border: 3px solid var(--ink); border-radius: 18px; box-shadow: 6px 6px 0 var(--ink); overflow: hidden; }
      .plm-activity-head { padding: 14px 18px; background: var(--soft); border-bottom: 2px solid var(--ink); display: flex; justify-content: space-between; align-items: center; }
      .plm-activity-title { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; }
      .plm-activity-counter { font-family: 'JetBrains Mono', monospace; font-size: 11px; opacity: 0.5; }
      .plm-activity-list { list-style: none; padding: 4px 0; margin: 0; max-height: 240px; overflow: hidden; position: relative; }
      .plm-activity-list::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 28px; background: linear-gradient(transparent, var(--white)); pointer-events: none; }
      .plm-activity-item { padding: 12px 18px; display: flex; align-items: flex-start; gap: 12px; font-size: 13px; line-height: 1.4; border-bottom: 1px solid var(--hairline); }
      .plm-activity-item:last-child { border-bottom: 0; }
      .plm-activity-item.is-new { animation: plm-slide-in 0.5s cubic-bezier(0.2, 0.7, 0.2, 1); }
      @keyframes plm-slide-in { from { opacity: 0; transform: translateY(-8px); background: rgba(45, 78, 255, 0.1); } to { opacity: 1; transform: translateY(0); } }
      .plm-activity-time { font-family: 'JetBrains Mono', monospace; font-size: 10px; opacity: 0.5; flex-shrink: 0; width: 38px; padding-top: 2px; }
      .plm-activity-icon { width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0; display: grid; place-items: center; font-size: 11px; font-weight: 600; color: var(--white); }
      .plm-activity-icon.submit { background: var(--electric); }
      .plm-activity-icon.approve { background: #15803d; }
      .plm-activity-icon.checkin { background: var(--orange); }
      .plm-activity-icon.escalate { background: #b91c1c; }
      .plm-activity-text { flex: 1; min-width: 0; }
      .plm-who { font-weight: 600; }
      .plm-what { opacity: 0.6; }

      /* ROLES */
      .plm-roles-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 56px; }
      .plm-role-card { background: var(--white); border: 3px solid var(--ink); border-radius: 18px; padding: 32px; cursor: pointer; transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); position: relative; overflow: hidden; font-family: inherit; text-align: left; }
      .plm-role-card::before { content: ''; position: absolute; inset: 0; background: var(--card-bg, var(--lime)); transform: translateY(101%); transition: transform 0.3s; z-index: 0; }
      .plm-role-card:hover:not(:disabled)::before { transform: translateY(0); }
      .plm-role-card:hover:not(:disabled) { transform: translate(-4px, -4px); box-shadow: 8px 8px 0 var(--ink); }
      .plm-role-card:disabled { opacity: 0.5; cursor: wait; }
      .plm-role-card > * { position: relative; z-index: 1; }
      .plm-role-lime { --card-bg: var(--lime); }
      .plm-role-sky { --card-bg: var(--sky); }
      .plm-role-orange { --card-bg: var(--orange); }
      .plm-role-num { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 14px; }
      .plm-role-name { font-size: 36px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; margin-bottom: 8px; }
      .plm-role-title { font-size: 13px; margin-bottom: 24px; opacity: 0.7; font-family: 'JetBrains Mono', monospace; }
      .plm-role-state { border-top: 2px solid var(--ink); padding-top: 16px; font-size: 13px; line-height: 1.45; }
      .plm-role-arrow { position: absolute; bottom: 24px; right: 28px; transform: rotate(-45deg); font-size: 24px; z-index: 1; transition: transform 0.3s; }
      .plm-role-card:hover:not(:disabled) .plm-role-arrow { transform: rotate(0deg); }

      /* Employees subgroup inside roles */
      .plm-roles-subgroup { grid-column: span 1; background: var(--white); border: 3px solid var(--ink); border-radius: 18px; padding: 20px; box-shadow: 6px 6px 0 var(--ink); }
      .plm-roles-sublabel { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 14px; opacity: 0.6; }
      .plm-emp-card { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 8px; cursor: pointer; border: 0; background: transparent; transition: all 0.15s; width: 100%; text-align: left; font-family: inherit; margin-bottom: 4px; }
      .plm-emp-card:hover:not(:disabled) { background: var(--soft); transform: translateX(2px); }
      .plm-emp-card:disabled { opacity: 0.5; cursor: wait; }
      .plm-emp-avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--orange); color: var(--white); display: grid; place-items: center; font-family: 'Instrument Serif', serif; font-size: 13px; font-weight: 500; flex-shrink: 0; }
      .plm-emp-body { flex: 1; min-width: 0; }
      .plm-emp-name { font-size: 13px; font-weight: 600; }
      .plm-emp-meta { font-size: 11px; opacity: 0.6; }
      .plm-emp-arrow { font-size: 14px; opacity: 0.4; }

      /* BENTO */
      .plm-bento { display: grid; grid-template-columns: repeat(6, 1fr); grid-auto-rows: minmax(140px, auto); gap: 16px; margin-top: 56px; }
      .plm-bento-card { background: var(--white); border: 3px solid var(--ink); border-radius: 18px; padding: 28px; position: relative; overflow: hidden; transition: transform 0.25s; }
      .plm-bento-card:hover { transform: translate(-3px, -3px); box-shadow: 6px 6px 0 var(--ink); }
      .plm-bento-card h4 { font-size: 22px; line-height: 1.05; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px; }
      .plm-bento-card p { font-size: 14px; line-height: 1.4; opacity: 0.7; margin: 0; }
      .plm-num-badge { position: absolute; top: 20px; right: 24px; font-family: 'JetBrains Mono', monospace; font-size: 11px; opacity: 0.4; letter-spacing: 0.1em; }
      .plm-b-wide-blue { grid-column: span 4; background: var(--electric); color: var(--white); }
      .plm-b-wide-blue p { color: rgba(255,255,255,0.85); }
      .plm-b-wide-blue .plm-num-badge { color: rgba(255,255,255,0.5); }
      .plm-b-sq-lime { grid-column: span 2; background: var(--lime); }
      .plm-b-sq { grid-column: span 2; }
      .plm-b-sq-orange { grid-column: span 2; background: var(--orange); color: var(--white); }
      .plm-b-sq-orange p { color: rgba(255,255,255,0.85); }
      .plm-b-sq-orange .plm-num-badge { color: rgba(255,255,255,0.6); }
      .plm-b-med { grid-column: span 3; }
      .plm-b-med-sky { grid-column: span 3; background: var(--sky); }
      .plm-b-sq-blue { grid-column: span 2; background: var(--electric); color: var(--white); }
      .plm-b-sq-blue p { color: rgba(255,255,255,0.85); }
      .plm-b-sq-blue .plm-num-badge { color: rgba(255,255,255,0.5); }

      /* SCORING DEMO */
      .plm-scoring { background: var(--white); border: 3px solid var(--ink); border-radius: 18px; box-shadow: 6px 6px 0 var(--ink); overflow: hidden; margin-top: 32px; }
      .plm-scoring-head { padding: 22px 28px; border-bottom: 2px solid var(--ink); display: flex; justify-content: space-between; align-items: center; background: var(--soft); }
      .plm-scoring-title { font-size: 22px; font-weight: 600; letter-spacing: -0.015em; }
      .plm-scoring-tag { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--electric); display: inline-flex; align-items: center; gap: 8px; }
      .plm-scoring-tag span { width: 6px; height: 6px; border-radius: 50%; background: var(--electric); animation: plm-pulse-mini 2s ease-in-out infinite; }
      @keyframes plm-pulse-mini { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.85); } }
      .plm-scoring-body { display: grid; grid-template-columns: 1fr 2px 1fr; min-height: 360px; }
      .plm-scoring-input { padding: 32px; }
      .plm-scoring-divider { background: var(--ink); }
      .plm-scoring-output { padding: 32px; background: var(--soft); }

      .plm-uom-tabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; background: var(--white); padding: 4px; border-radius: 999px; border: 2px solid var(--ink); margin-bottom: 28px; }
      .plm-uom-tab { padding: 8px 6px; background: transparent; border: 0; border-radius: 999px; font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 500; cursor: pointer; transition: all 0.15s; }
      .plm-uom-tab:hover { background: var(--soft); }
      .plm-uom-tab.active { background: var(--ink); color: var(--white); }

      .plm-scoring-field { margin-bottom: 22px; }
      .plm-scoring-field-label { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; opacity: 0.7; margin-bottom: 8px; }
      .plm-val { font-size: 22px; font-weight: 700; opacity: 1; font-feature-settings: 'tnum'; }
      .plm-slider { width: 100%; -webkit-appearance: none; appearance: none; height: 4px; border-radius: 999px; background: var(--hairline); outline: none; cursor: pointer; }
      .plm-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 22px; height: 22px; border-radius: 50%; background: var(--electric); cursor: pointer; border: 3px solid var(--white); box-shadow: 0 0 0 2px var(--ink), 4px 4px 0 var(--ink); }
      .plm-slider::-moz-range-thumb { width: 22px; height: 22px; border-radius: 50%; background: var(--electric); cursor: pointer; border: 3px solid var(--white); box-shadow: 0 0 0 2px var(--ink); }

      .plm-formula { margin-top: 24px; padding: 16px; background: var(--ink); color: #e8e6df; border-radius: 12px; font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.6; }
      .plm-com { color: #8b8a82; }

      .plm-scoring-result-label { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.6; margin-bottom: 12px; }
      .plm-result-num { font-size: 124px; line-height: 0.9; letter-spacing: -0.04em; font-weight: 700; font-feature-settings: 'tnum'; transition: color 0.3s; }
      .plm-result-num.is-perfect { color: #15803d; }
      .plm-result-num.is-bad { color: var(--orange); }
      .plm-pct { font-size: 48px; opacity: 0.4; margin-left: 4px; }
      .plm-result-bar-wrap { margin-top: 20px; height: 10px; background: var(--white); border-radius: 999px; overflow: hidden; border: 2px solid var(--ink); }
      .plm-result-bar { height: 100%; background: linear-gradient(90deg, var(--orange), #ca8a04, #15803d); transition: width 0.4s cubic-bezier(0.2, 0.7, 0.2, 1); }
      .plm-scoring-status { margin-top: 16px; font-size: 14px; opacity: 0.7; line-height: 1.5; }
      .plm-scoring-status strong { opacity: 1; font-weight: 600; }
      .plm-callouts { margin-top: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .plm-callout { padding: 14px 16px; border: 2px solid var(--ink); border-radius: 12px; background: var(--white); }
      .plm-callout-label { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 500; letter-spacing: 0.15em; text-transform: uppercase; opacity: 0.6; }
      .plm-callout-val { font-size: 22px; margin-top: 4px; font-weight: 700; font-feature-settings: 'tnum'; }

      /* SIGN-IN */
      .plm-signin { background: var(--white); border: 3px solid var(--ink); border-radius: 18px; box-shadow: 8px 8px 0 var(--ink); overflow: hidden; margin-top: 32px; }
      .plm-signin-header { display: flex; align-items: center; gap: 16px; padding: 20px 28px; border-bottom: 2px solid var(--ink); background: var(--soft); }
      .plm-ms-mark { width: 32px; height: 32px; background: var(--ink); display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 2px; padding: 5px; border-radius: 6px; }
      .plm-ms-mark span { background: var(--white); display: block; }
      .plm-signin-header-title { flex: 1; font-weight: 600; font-size: 14px; }
      .plm-signin-header-title small { display: block; font-weight: 400; opacity: 0.6; font-size: 12px; margin-top: 2px; }
      .plm-signin-header-right { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.14em; opacity: 0.6; }

      .plm-signin-groups { display: grid; grid-template-columns: 1fr 1.6fr 2fr; gap: 0; }
      .plm-signin-group { padding: 24px 28px; border-right: 2px solid var(--ink); }
      .plm-signin-group:last-child { border-right: 0; }
      .plm-signin-group-label { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.5; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
      .plm-signin-count { font-feature-settings: 'tnum'; font-weight: 500; color: var(--electric); letter-spacing: 0; opacity: 1; }
      .plm-signin-people { display: flex; flex-direction: column; gap: 8px; }
      .plm-person { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 12px; cursor: pointer; border: 2px solid transparent; background: transparent; transition: all 0.15s; width: 100%; text-align: left; font-family: inherit; }
      .plm-person:hover:not(:disabled) { background: var(--soft); border-color: var(--ink); transform: translate(-2px, -2px); box-shadow: 4px 4px 0 var(--ink); }
      .plm-person:disabled { opacity: 0.5; cursor: wait; }
      .plm-person-avatar { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; font-family: 'Instrument Serif', serif; font-size: 14px; font-weight: 500; color: var(--white); flex-shrink: 0; }
      .plm-person-avatar.admin { background: var(--electric); }
      .plm-person-avatar.manager { background: var(--ink); }
      .plm-person-avatar.employee { background: var(--orange); }
      .plm-person-body { flex: 1; min-width: 0; }
      .plm-person-name { font-size: 14px; font-weight: 600; }
      .plm-person-meta { font-size: 12px; opacity: 0.6; margin-top: 1px; }
      .plm-person-arrow { font-size: 14px; opacity: 0.6; }

      /* ARCH (dark) */
      .plm-arch-section { background: var(--ink); color: var(--white); padding: 100px 0; }
      .plm-arch-grid { display: grid; grid-template-columns: 1fr 1.4fr; gap: 64px; align-items: center; }
      .plm-tag-light { color: var(--lime); }
      .plm-tag-light::before { background: var(--lime); }
      .plm-section-title-light { color: var(--white); }
      .plm-ital-light { font-family: 'Instrument Serif', serif; font-style: italic; font-weight: 400; color: var(--lime); }
      .plm-arch-deck { font-size: 17px; opacity: 0.7; max-width: 440px; margin-bottom: 28px; }
      .plm-arch-stat { display: flex; align-items: baseline; gap: 14px; padding: 14px 0; border-bottom: 1px solid rgba(255,255,255,0.15); }
      .plm-arch-stat:last-child { border-bottom: 0; }
      .plm-arch-stat-num { font-size: 32px; font-weight: 700; min-width: 80px; }
      .plm-arch-stat-label { flex: 1; font-size: 14px; opacity: 0.7; }
      .plm-arch-stat-tag { font-family: 'JetBrains Mono', monospace; font-size: 11px; background: var(--lime); color: var(--ink); padding: 4px 10px; border-radius: 999px; font-weight: 500; }

      .plm-arch-diagram { background: rgba(255,255,255,0.04); border: 2px solid rgba(255,255,255,0.15); border-radius: 24px; padding: 32px; }
      .plm-arch-row { display: grid; gap: 12px; margin-bottom: 20px; }
      .plm-arch-row-2 { grid-template-columns: 1fr 1fr; }
      .plm-arch-row-3 { grid-template-columns: 1fr 1fr 1fr; }
      .plm-arch-node { background: var(--white); color: var(--ink); padding: 14px 18px; border-radius: 12px; border: 2px solid var(--ink); box-shadow: 4px 4px 0 rgba(255,255,255,0.2); }
      .plm-arch-node-title { font-weight: 600; font-size: 14px; }
      .plm-arch-node-sub { font-size: 11px; opacity: 0.6; font-family: 'JetBrains Mono', monospace; margin-top: 4px; }
      .plm-arch-divider { text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; opacity: 0.5; margin: 12px 0; }
      .plm-tier-edge { background: var(--lime); }
      .plm-tier-data { background: var(--sky); }

      /* CTA */
      .plm-cta { padding: 80px 0; text-align: center; }
      .plm-cta-title { font-size: clamp(64px, 10vw, 156px); line-height: 0.9; letter-spacing: -0.045em; font-weight: 700; margin: 20px 0 40px; }
      .plm-ital-orange { font-family: 'Instrument Serif', serif; font-style: italic; color: var(--orange); font-weight: 400; }
      .plm-cta-btn { font-size: 18px; padding: 22px 36px; }

      /* FOOTER */
      .plm-footer { border-top: 3px solid var(--ink); padding: 32px 0; display: flex; justify-content: space-between; align-items: center; font-family: 'JetBrains Mono', monospace; font-size: 12px; }
      .plm-footer a { color: inherit; }

      /* RESPONSIVE */
      @media (max-width: 1024px) {
        .plm-container { padding: 0 24px; }
        .plm-hero-grid { grid-template-columns: 1fr; gap: 40px; }
        .plm-preview-stack { height: 460px; }
        .plm-live-grid { grid-template-columns: 1fr; }
        .plm-bento { grid-template-columns: repeat(4, 1fr); }
        .plm-b-wide-blue { grid-column: span 4; }
        .plm-b-med, .plm-b-med-sky { grid-column: span 2; }
        .plm-arch-grid { grid-template-columns: 1fr; gap: 32px; }
        .plm-signin-groups { grid-template-columns: 1fr 1fr; }
        .plm-signin-group:nth-child(3) { grid-column: 1 / -1; border-right: 0; border-top: 2px solid var(--ink); }
        .plm-signin-group:nth-child(3) .plm-signin-people { display: grid; grid-template-columns: 1fr 1fr; }
        .plm-signin-group:nth-child(2) { border-right: 0; }
      }
      @media (max-width: 640px) {
        .plm-nav { display: none; }
        .plm-hero { padding: 48px 0 60px; }
        .plm-hero-title { font-size: 56px; }
        .plm-hero-lede { font-size: 17px; }
        .plm-preview-stack { height: 420px; }
        .plm-pc-1 { width: 280px; right: 8px; }
        .plm-pc-2 { width: 250px; }
        .plm-pc-3 { width: 220px; right: 32px; }
        .plm-section { padding: 64px 0; }
        .plm-roles-grid { grid-template-columns: 1fr; }
        .plm-bento { grid-template-columns: 1fr 1fr; gap: 12px; }
        .plm-b-wide-blue, .plm-b-med, .plm-b-med-sky { grid-column: span 2; }
        .plm-scoring-body { grid-template-columns: 1fr; }
        .plm-scoring-divider { display: none; }
        .plm-signin-groups { grid-template-columns: 1fr; }
        .plm-signin-group { border-right: 0; border-bottom: 2px solid var(--ink); }
        .plm-signin-group:last-child { border-bottom: 0; }
        .plm-signin-group:nth-child(3) .plm-signin-people { grid-template-columns: 1fr; }
        .plm-result-num { font-size: 88px; }
        .plm-pct { font-size: 32px; }
        .plm-footer { flex-direction: column; gap: 8px; text-align: center; }
      }
    `}</style>
  );
}