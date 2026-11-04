/*
 * Pure goal-quality rules shared by the API (authoritative) and the UI (instant hints).
 * No I/O, no framework imports.
 */
import type { OrgPolicy } from './policy';

export interface GoalDraft {
  title: string; description?: string | null; expected_outcome?: string | null;
  start_date?: string | null; due_date?: string | null; level: string;
  department_id?: string | null; team_id?: string | null;
}
export interface KrDraft {
  title: string; metric_type: string; direction: string; start_value: number; target_value: number; weight?: number;
}
export interface Issue { field: string; message: string }

/** Hard requirements: a goal with issues cannot enter the approval workflow. */
export function submissionIssues(g: GoalDraft, krs: KrDraft[], policy: OrgPolicy): Issue[] {
  const out: Issue[] = [];
  const title = (g.title ?? '').trim();
  if (title.length < policy.goals.minTitleLength) out.push({ field: 'title', message: `Give the goal a clear title (at least ${policy.goals.minTitleLength} characters).` });
  if (!(g.description ?? '').trim()) out.push({ field: 'description', message: 'Describe the goal so reviewers understand what you intend to do.' });
  if (policy.goals.requireOutcome && !(g.expected_outcome ?? '').trim()) out.push({ field: 'expected_outcome', message: 'State the outcome you expect when this goal succeeds.' });
  if (!g.start_date) out.push({ field: 'start_date', message: 'Set a start date.' });
  if (!g.due_date) out.push({ field: 'due_date', message: 'Set a deadline.' });
  if (g.start_date && g.due_date && g.start_date > g.due_date) out.push({ field: 'due_date', message: 'The deadline must be on or after the start date.' });
  if (g.level === 'department' && !g.department_id) out.push({ field: 'department_id', message: 'Department goals need a department.' });
  if (g.level === 'team' && !g.team_id) out.push({ field: 'team_id', message: 'Team goals need a team.' });
  const min = policy.goals.requireKeyResults ? Math.max(1, policy.goals.minKeyResults) : policy.goals.minKeyResults;
  if (krs.length < min) out.push({ field: 'key_results', message: `Add at least ${min} measurable key result${min > 1 ? 's' : ''}.` });
  if (krs.length > policy.goals.maxKeyResults) out.push({ field: 'key_results', message: `At most ${policy.goals.maxKeyResults} key results are allowed.` });
  krs.forEach((k, i) => {
    if (!k.title.trim()) out.push({ field: `key_results.${i}.title`, message: 'Every key result needs a title.' });
    if (k.start_value === k.target_value) out.push({ field: `key_results.${i}.target_value`, message: 'The target must differ from the starting value.' });
  });
  return out;
}

const VAGUE = /\b(improve|increase|better|enhance|optimi[sz]e|ensure|support|help|work on|try to|look into|explore|focus on|good|great|more|less|faster|stronger)\b/i;
const HAS_NUMBER = /\d/;
const HAS_TIME = /\b(by|before|within|per|each|every|q[1-4]|quarter|month|week|year|\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i;

export interface LintResult { score: number; findings: { level: 'info' | 'warn'; message: string }[] }

/**
 * Deterministic "is this measurable?" check. It does NOT use an AI model; it flags common
 * patterns of vague goals so authors can sharpen them before review.
 */
export function lintGoal(g: { title: string; description?: string | null; expected_outcome?: string | null }, krs: Pick<KrDraft, 'title'>[]): LintResult {
  const findings: LintResult['findings'] = [];
  let score = 100;
  const text = `${g.title} ${g.description ?? ''} ${g.expected_outcome ?? ''}`;
  if (VAGUE.test(g.title) && !HAS_NUMBER.test(g.title)) {
    findings.push({ level: 'warn', message: 'The title uses a vague verb without a number. Say how much, by how much, or by when.' }); score -= 20;
  }
  if (krs.length === 0) { findings.push({ level: 'warn', message: 'No key results yet — add at least one measurable result.' }); score -= 30; }
  if (!HAS_NUMBER.test(text) && krs.length === 0) { findings.push({ level: 'warn', message: 'Nothing in the goal is quantified.' }); score -= 15; }
  if (!HAS_TIME.test(text)) { findings.push({ level: 'info', message: 'Mention the timeframe (e.g. "by end of Q3") so the target is time-bound.' }); score -= 5; }
  if (g.title.trim().length > 120) { findings.push({ level: 'info', message: 'Long titles are hard to scan. Keep the title short and move detail into the description.' }); score -= 5; }
  if (!(g.expected_outcome ?? '').trim()) { findings.push({ level: 'info', message: 'Add the expected outcome — what is different when this is achieved?' }); score -= 10; }
  return { score: Math.max(0, score), findings };
}
