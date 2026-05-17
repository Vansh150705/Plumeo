/** Domain types — mirror Postgres schema. Single source of truth. */

export type UserRole = 'Employee' | 'Manager' | 'Admin';
export type UomType = 'Numeric' | 'Percentage' | 'Timeline' | 'Zero';
export type UomDirection = 'min' | 'max' | 'timeline' | 'zero';
export type SheetStatus = 'Draft' | 'Submitted' | 'Returned' | 'Approved' | 'Locked';
export type GoalProgress = 'NotStarted' | 'OnTrack' | 'AtRisk' | 'Completed';
export type CheckInQuarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';
export type NotifChannel = 'Email' | 'Teams' | 'InApp';
export type EscalationLevel = 'Employee' | 'Manager' | 'SkipLevel' | 'HR';

export interface AppUser {
  id: string;
  entra_oid: string | null;
  upn: string;
  full_name: string;
  role: UserRole;
  department: string | null;
  manager_id: string | null;
  entra_groups: string[];
  avatar_color: string | null;
  is_active: boolean;
}

export interface Cycle {
  id: string;
  name: string;
  fiscal_year: number;
  goal_window_start: string;
  goal_window_end: string;
  q1_open: string; q1_close: string;
  q2_open: string; q2_close: string;
  q3_open: string; q3_close: string;
  q4_open: string; q4_close: string;
  is_active: boolean;
}

export interface GoalSheet {
  id: string;
  cycle_id: string;
  employee_id: string;
  status: SheetStatus;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  returned_at: string | null;
  return_comment: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Goal {
  id: string;
  sheet_id: string;
  thrust_area: string;
  title: string;
  description: string | null;
  uom: UomType;
  direction: UomDirection;
  target_numeric: number | null;
  target_date: string | null;
  weightage: number;
  is_shared_origin: boolean;
  shared_origin_id: string | null;
  display_order: number;
}

export interface CheckIn {
  id: string;
  goal_id: string;
  quarter: CheckInQuarter;
  actual_numeric: number | null;
  actual_date: string | null;
  zero_achieved: boolean | null;
  progress_status: GoalProgress;
  employee_comment: string | null;
  manager_comment: string | null;
  manager_checked_at: string | null;
  manager_checked_by: string | null;
  computed_score: number | null;
}

export interface AuditEntry {
  id: number;
  entity_type: 'goal' | 'check_in' | 'sheet';
  entity_id: string;
  action: string;
  before_data: any;
  after_data: any;
  actor_id: string | null;
  actor_name: string | null;
  reason: string | null;
  occurred_at: string;
}

export interface Notification {
  id: string;
  recipient_id: string;
  channel: NotifChannel;
  subject: string;
  body: string;
  deep_link: string | null;
  payload: any;
  sent_at: string | null;
  read_at: string | null;
  created_at: string;
}

export interface EscalationRule {
  id: string;
  name: string;
  trigger_type: 'goal_not_submitted' | 'approval_pending' | 'checkin_overdue';
  threshold_days: number;
  escalate_to: EscalationLevel;
  is_active: boolean;
}

export interface EscalationEvent {
  id: string;
  rule_id: string;
  subject_id: string;
  sheet_id: string | null;
  level: EscalationLevel;
  reason: string;
  resolved_at: string | null;
  triggered_at: string;
}
