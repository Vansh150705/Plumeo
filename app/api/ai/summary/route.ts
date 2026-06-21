import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { groqChat, GroqNotConfigured } from '@/lib/groq';

export const runtime = 'nodejs';

const GoalInput = z.object({
  title: z.string().max(300),
  thrust_area: z.string().max(120).optional().default(''),
  weightage: z.number().optional().default(0),
  target: z.string().max(200).optional().default(''),
  status: z.string().max(40).optional().default(''),
  score: z.number().nullable().optional().default(null),
  employee_comment: z.string().max(1000).nullable().optional().default(null),
});

const Body = z.object({
  quarter: z.string().max(8),
  cycleName: z.string().max(200).optional().default(''),
  employeeName: z.string().max(200).optional().default(''),
  weightedScore: z.number().nullable().optional().default(null),
  goals: z.array(GoalInput).max(8),
});

const SYSTEM = `You are a performance-review assistant. Given one quarter's goal achievements, write a concise, plain-language progress summary of 3-5 sentences: the overall standing, what is on track, what is at risk or behind, and one concrete suggested focus for next quarter. Be professional, specific and constructive. Write a single short paragraph in prose — no markdown headings, no bullet lists.`;

/** Summarizes a sheet's quarterly check-ins into a short narrative via Groq (free tier). */
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (body.goals.length === 0) {
    return NextResponse.json({ error: 'No goals to summarize yet.' }, { status: 400 });
  }

  const lines = body.goals.map((g, i) => {
    const score = g.score == null ? 'not captured' : `${g.score}/100`;
    const note = g.employee_comment ? ` — note: "${g.employee_comment}"` : '';
    return `${i + 1}. [${g.thrust_area || 'General'}, weight ${g.weightage}%] ${g.title} · target ${g.target || 'n/a'} · status ${g.status || 'n/a'} · score ${score}${note}`;
  });

  const userMsg = [
    `Employee: ${body.employeeName || 'this person'}`,
    `Cycle: ${body.cycleName || 'current cycle'} · Quarter: ${body.quarter}`,
    body.weightedScore != null ? `Weighted quarter score: ${Math.round(body.weightedScore)}/100` : 'Weighted quarter score: not yet available',
    '',
    'Goals:',
    ...lines,
  ].join('\n');

  try {
    const summary = await groqChat(
      [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMsg }],
      { temperature: 0.5, maxTokens: 400 },
    );
    return NextResponse.json({ summary: summary.trim() });
  } catch (err) {
    if (err instanceof GroqNotConfigured) {
      return NextResponse.json(
        { error: 'AI is not configured. Add a free GROQ_API_KEY to enable it.' },
        { status: 503 },
      );
    }
    console.error('AI check-in summary failed:', err);
    return NextResponse.json({ error: 'AI request failed. Please try again.' }, { status: 502 });
  }
}
