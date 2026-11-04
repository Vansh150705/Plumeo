import { Pill, type PillVariant } from '@/components/ui/pill';

const GOAL: Record<string, [PillVariant, string]> = {
  draft: ['gray', 'Draft'], pending_approval: ['blue', 'Awaiting approval'], changes_requested: ['orange', 'Changes requested'],
  rejected: ['red', 'Rejected'], active: ['green', 'Active'], completed: ['gold', 'Completed'], cancelled: ['gray', 'Cancelled'],
};
export const GoalStatusPill = ({ status }: { status: string }) => { const [v, l] = GOAL[status] ?? ['gray', status]; return <Pill variant={v}>{l}</Pill>; };

const RISK: Record<string, [PillVariant, string]> = {
  on_track: ['green', 'On track'], at_risk: ['orange', 'At risk'], overdue: ['red', 'Overdue'], stalled: ['purple', 'Stalled'], unknown: ['gray', 'Not measurable yet'], done: ['gray', 'Done'],
};
export const RiskPill = ({ risk }: { risk: string }) => { const [v, l] = RISK[risk] ?? ['gray', risk]; return <Pill variant={v}>{l}</Pill>; };

const HEALTH: Record<string, [PillVariant, string]> = { on_track: ['green', 'On track'], at_risk: ['orange', 'At risk'], off_track: ['red', 'Off track'], completed: ['gold', 'Completed'] };
export const HealthPill = ({ health }: { health: string | null }) => { if (!health) return null; const [v, l] = HEALTH[health] ?? ['gray', health]; return <Pill variant={v}>{l}</Pill>; };

const CHECKIN: Record<string, [PillVariant, string]> = { submitted: ['green', 'Submitted'], due: ['blue', 'Due'], overdue: ['red', 'Overdue'], upcoming: ['gray', 'Upcoming'], reopened: ['orange', 'Needs correction'], reviewed: ['gold', 'Reviewed'] };
export const CheckinStatePill = ({ state }: { state: string }) => { const [v, l] = CHECKIN[state] ?? ['gray', state]; return <Pill variant={v}>{l}</Pill>; };

const LEVEL: Record<string, string> = { company: 'Company', department: 'Department', team: 'Team', individual: 'Individual' };
export const LevelPill = ({ level }: { level: string }) => <Pill variant={level === 'company' ? 'gold' : level === 'department' ? 'purple' : level === 'team' ? 'blue' : 'gray'}>{LEVEL[level] ?? level}</Pill>;

const PRIORITY: Record<string, [PillVariant, string]> = { critical: ['red', 'Critical'], high: ['orange', 'High'], medium: ['gray', 'Medium'], low: ['gray', 'Low'] };
export const PriorityPill = ({ priority }: { priority: string }) => { const [v, l] = PRIORITY[priority] ?? ['gray', priority]; return <Pill variant={v}>{l}</Pill>; };

export const LEVEL_LABEL = LEVEL;
