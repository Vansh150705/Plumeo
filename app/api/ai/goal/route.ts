import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { groqChat, GroqNotConfigured } from '@/lib/groq';

export const runtime = 'nodejs';

// Existing goals can carry null for description/target fields, so accept
// null/undefined everywhere and normalize to a string before validating length.
const Body = z.object({
  thrust_area: z.string().max(120).nullish().transform(v => v ?? ''),
  title: z.string().max(300).nullish().transform(v => v ?? ''),
  description: z.string().max(2000).nullish().transform(v => v ?? ''),
  uom: z.string().max(40).nullish().transform(v => v ?? 'Numeric'),
});

const SYSTEM = `You are an OKR / performance-goal coach. Rewrite an employee's draft goal so it is specific, measurable, outcome-oriented and time-bound (SMART). Keep it realistic, professional and concise.
Respond ONLY as compact JSON of the shape:
{"title": string, "description": string}
- title: <= 120 characters, a single crisp objective.
- description: 2-3 sentences covering the success criterion and how it is measured.
Do NOT invent specific numeric targets the user did not imply; if a target is unclear, use a placeholder like "[target]". Do not add commentary outside the JSON.`;

/** Refines a draft goal into a sharper, measurable version using Groq (free tier). */
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

  if (!body.title.trim() && !body.description.trim()) {
    return NextResponse.json({ error: 'Add a rough title or description first.' }, { status: 400 });
  }

  const userMsg = [
    `Thrust area: ${body.thrust_area || '(none)'}`,
    `Unit of measure: ${body.uom}`,
    `Draft title: ${body.title || '(none)'}`,
    `Draft description: ${body.description || '(none)'}`,
  ].join('\n');

  try {
    const raw = await groqChat(
      [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMsg }],
      { json: true, temperature: 0.4 },
    );
    let out: { title?: string; description?: string };
    try {
      out = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'AI returned an unexpected response. Try again.' }, { status: 502 });
    }
    return NextResponse.json({
      title: (out.title ?? '').trim(),
      description: (out.description ?? '').trim(),
    });
  } catch (err) {
    if (err instanceof GroqNotConfigured) {
      return NextResponse.json(
        { error: 'AI is not configured. Add a free GROQ_API_KEY to enable it.' },
        { status: 503 },
      );
    }
    console.error('AI goal refine failed:', err);
    return NextResponse.json({ error: 'AI request failed. Please try again.' }, { status: 502 });
  }
}
