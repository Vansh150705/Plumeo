/*
 * AI configuration, kept separate from the server action so a Server Component
 * can cheaply ask "is the assistant available?" without importing the action.
 *
 * Models are addressed as plain `provider/model` strings, which route through
 * the Vercel AI Gateway. The gateway is active when an API key is present, or
 * automatically via OIDC when deployed on Vercel.
 */

export const AI_GOAL_MODEL = process.env.AI_GOAL_MODEL ?? 'anthropic/claude-sonnet-4-6';

export function isAiConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}
