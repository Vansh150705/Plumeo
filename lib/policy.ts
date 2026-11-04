import { z } from 'zod';

/** Organisation policy: every field has a safe default so an org works out of the box. */
export const policySchema = z.object({
  approval: z.object({
    // number of approval levels required per goal level (capped by the length of the management chain)
    levels: z.object({
      company: z.number().int().min(1).max(3).default(1),
      department: z.number().int().min(1).max(3).default(2),
      team: z.number().int().min(1).max(3).default(1),
      individual: z.number().int().min(1).max(3).default(1),
    }).default({}),
    slaDays: z.number().int().min(1).max(60).default(3),
    reminderEveryDays: z.number().int().min(1).max(30).default(2),
  }).default({}),
  amendments: z.object({
    // which kinds of change to an *approved* goal must go through re-approval
    requireApprovalFor: z.array(z.enum(['target', 'deadline', 'owner', 'scope'])).default(['target', 'deadline', 'owner', 'scope']),
    deadlineShiftFreeDays: z.number().int().min(0).max(90).default(0),
  }).default({}),
  goals: z.object({
    requireKeyResults: z.boolean().default(true),
    minKeyResults: z.number().int().min(0).max(10).default(1),
    maxKeyResults: z.number().int().min(1).max(20).default(8),
    maxActiveIndividualGoals: z.number().int().min(1).max(100).default(10),
    minTitleLength: z.number().int().min(3).max(100).default(8),
    requireOutcome: z.boolean().default(true),
    enforceGoalSettingWindow: z.boolean().default(false),
  }).default({}),
  checkins: z.object({
    reminderDaysBefore: z.array(z.number().int().min(0).max(30)).max(5).default([3, 1]),
    overdueReminderEveryDays: z.number().int().min(1).max(30).default(3),
    customQuestions: z.array(z.object({
      id: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
      label: z.string().min(3).max(200),
      required: z.boolean().default(false),
    })).max(6).default([]),
  }).default({}),
  risk: z.object({
    stalledAfterDays: z.number().int().min(7).max(180).default(30),
    atRiskTolerancePoints: z.number().int().min(5).max(50).default(20),
  }).default({}),
  ai: z.object({ enabled: z.boolean().default(false) }).default({}),
  security: z.object({
    sessionIdleMinutes: z.number().int().min(15).max(24 * 60).default(8 * 60),
    sessionMaxHours: z.number().int().min(1).max(24 * 30).default(24 * 7),
  }).default({}),
}).strict();

export type OrgPolicy = z.infer<typeof policySchema>;
export const DEFAULT_POLICY: OrgPolicy = policySchema.parse({});
export function resolvePolicy(raw: unknown): OrgPolicy {
  const r = policySchema.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_POLICY;
}
