/*
 * The permission catalogue and the built-in role templates. Client-safe (no server
 * imports) so the UI can hide controls, while the *server* remains the only place
 * a permission is actually enforced.
 */

export const PERMISSIONS = {
  'org.manage': 'Change organisation settings',
  'policies.manage': 'Edit organisation goal and check-in policies',
  'users.read': 'See the full employee directory (emails, status)',
  'users.manage': 'Create, edit, suspend and deactivate users; set managers',
  'users.anonymize': 'Anonymise former employees (privacy erasure)',
  'roles.manage': 'Assign roles and define custom roles',
  'structure.manage': 'Manage departments and teams',
  'cycles.manage': 'Manage goal cycles and review periods',
  'templates.manage': 'Manage goal templates and libraries',
  'integrations.manage': 'Manage SSO, SCIM and chat integrations',
  'goals.create_company': 'Create company-level goals',
  'goals.create_department': 'Create department-level goals',
  'goals.create_team': 'Create team-level goals',
  'goals.read_org': 'See every goal in the organisation',
  'goals.read_department': 'See goals across departments you head',
  'goals.read_reports': 'See goals of people who report to you',
  'goals.approve': 'Approve goals assigned to you',
  'goals.approve_any': 'Approve or return any pending goal (oversight)',
  'goals.reassign': 'Transfer goal ownership',
  'checkins.review': 'Review check-ins of people who report to you',
  'analytics.read_org': 'See organisation-wide analytics',
  'analytics.read_scope': 'See analytics for your reporting line / departments',
  'exports.run': 'Export reports (CSV / PDF)',
  'audit.read': 'Read the audit trail',
  'audit.export': 'Export the audit trail',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
}

export const SYSTEM_ROLES: RoleTemplate[] = [
  {
    key: 'employee',
    name: 'Employee',
    description: 'Creates and manages their own goals and check-ins.',
    permissions: [],
  },
  {
    key: 'team_manager',
    name: 'Team manager',
    description: 'Approves and reviews the goals and check-ins of direct and indirect reports.',
    permissions: ['goals.read_reports', 'goals.approve', 'goals.create_team', 'checkins.review', 'analytics.read_scope'],
  },
  {
    key: 'department_head',
    name: 'Department head',
    description: 'Oversees goal alignment and progress across the department tree they lead.',
    permissions: [
      'goals.read_reports', 'goals.read_department', 'goals.approve', 'goals.create_department',
      'goals.create_team', 'checkins.review', 'analytics.read_scope',
    ],
  },
  {
    key: 'hr_admin',
    name: 'HR administrator',
    description: 'Runs goal cycles and policies and oversees goals across the organisation.',
    permissions: [
      'users.read', 'users.manage', 'users.anonymize', 'cycles.manage', 'policies.manage', 'templates.manage',
      'goals.read_org', 'goals.approve_any', 'goals.reassign', 'goals.create_company',
      'analytics.read_org', 'exports.run', 'audit.read',
    ],
  },
  {
    key: 'auditor',
    name: 'Auditor (read-only)',
    description: 'Can inspect goals, analytics and the audit trail but cannot change anything.',
    permissions: ['users.read', 'goals.read_org', 'analytics.read_org', 'audit.read', 'audit.export'],
  },
  {
    key: 'org_admin',
    name: 'Organisation administrator',
    description: 'Configures the organisation, access, structure and integrations.',
    permissions: [
      'org.manage', 'policies.manage', 'users.read', 'users.manage', 'users.anonymize', 'roles.manage',
      'structure.manage', 'cycles.manage', 'templates.manage', 'integrations.manage',
      'goals.create_company', 'goals.create_department', 'goals.create_team',
      'goals.read_org', 'goals.approve_any', 'goals.reassign',
      'analytics.read_org', 'exports.run', 'audit.read', 'audit.export',
    ],
  },
];

export const ROLE_PRIORITY = ['org_admin', 'hr_admin', 'auditor', 'department_head', 'team_manager', 'employee'];

/** Line-management permissions: anyone who may assign roles can hand these out. Everything else is "privileged" and can only be granted by someone who holds it. */
export const MANAGERIAL_PERMISSIONS: Permission[] = [
  'goals.approve', 'goals.read_reports', 'goals.read_department', 'goals.create_team', 'goals.create_department', 'checkins.review', 'analytics.read_scope',
];
