import type { Ctx } from '../core/context';
import { can } from '../core/context';
import { listCycles } from '../services/cycles';
import { listStructure } from '../services/structure';
import { listTemplates } from '../services/templates';
import { getPolicy } from '../services/orgs';
import { getUser } from '../services/users';

/** Everything the goal form needs, resolved server-side so the client never guesses permissions. */
export async function goalFormData(ctx: Ctx) {
  const [cycles, structure, templates, policy, me] = await Promise.all([listCycles(ctx), listStructure(ctx), listTemplates(ctx), getPolicy(ctx), getUser(ctx, ctx.userId)]);
  const allowedLevels = ['individual', ...(can(ctx, 'goals.create_team') ? ['team'] : []), ...(can(ctx, 'goals.create_department') ? ['department'] : []), ...(can(ctx, 'goals.create_company') ? ['company'] : [])];
  return {
    cycles: cycles.map((c: any) => ({ id: c.id, name: c.name, status: c.status })), departments: structure.departments.map((d: any) => ({ id: d.id, name: d.name })),
    teams: structure.teams.map((t: any) => ({ id: t.id, name: t.name, department_id: t.department_id })), templates: templates.map((t: any) => ({ id: t.id, name: t.name, level: t.level, content: t.content })),
    allowedLevels, aiEnabled: policy.policy.ai.enabled && !!process.env.GROQ_API_KEY, me: { id: ctx.userId, departmentId: me.department_id, teamId: me.team_id },
  };
}
