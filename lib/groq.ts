import 'server-only';

/** Thin wrapper over Groq's OpenAI-compatible chat API. Groq offers a generous
 *  free tier, so these AI features cost nothing to run — set GROQ_API_KEY to a
 *  free key from https://console.groq.com/keys to enable them. */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

/** Thrown when GROQ_API_KEY is missing, so routes can return a clear 503. */
export class GroqNotConfigured extends Error {
  constructor() {
    super('GROQ_API_KEY is not set');
    this.name = 'GroqNotConfigured';
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function isGroqConfigured(): boolean {
  return !!process.env.GROQ_API_KEY;
}

export async function groqChat(
  messages: ChatMessage[],
  opts: { json?: boolean; temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new GroqNotConfigured();

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 800,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    }),
    // Don't let a slow upstream hang a serverless function indefinitely.
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Groq request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}
