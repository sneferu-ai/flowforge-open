/**
 * RBAC roles and permission definitions.
 */

export const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
  VIEWER: 'viewer',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const PERMISSIONS = {
  VIEW_WORKSPACE: 'view_workspace',
  VIEW_WORKFLOWS: 'view_workflows',
  CREATE_EDIT_WORKFLOWS: 'create_edit_workflows',
  DELETE_WORKFLOWS: 'delete_workflows',
  RUN_WORKFLOWS: 'run_workflows',
  APPROVE_REJECT: 'approve_reject',
  VIEW_RUNS: 'view_runs',
  CANCEL_RUNS: 'cancel_runs',
  MANAGE_MEMBERS: 'manage_members',
  INVITE_MEMBERS: 'invite_members',
  REMOVE_MEMBERS: 'remove_members',
  CHANGE_MEMBER_ROLES: 'change_member_roles',
  MANAGE_CREDENTIALS: 'manage_credentials',
  MANAGE_ALLOWLIST: 'manage_allowlist',
  MANAGE_WEBHOOK_SECRETS: 'manage_webhook_secrets',
  MANAGE_OIDC: 'manage_oidc',
  MANAGE_OWN_TOKENS: 'manage_own_tokens',
  MANAGE_OTHERS_TOKENS: 'manage_others_tokens',
  VIEW_AUDIT_LOG: 'view_audit_log',
  MANAGE_SUBSCRIPTION: 'manage_subscription',
  DELETE_WORKSPACE: 'delete_workspace',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  owner: new Set<Permission>(Object.values(PERMISSIONS)),
  // §3.3 matrix: Admin manages members (invite/remove) but may NOT change
  // member roles — that permission is Owner-only.
  admin: new Set<Permission>([
    PERMISSIONS.VIEW_WORKSPACE,
    PERMISSIONS.VIEW_WORKFLOWS,
    PERMISSIONS.CREATE_EDIT_WORKFLOWS,
    PERMISSIONS.DELETE_WORKFLOWS,
    PERMISSIONS.RUN_WORKFLOWS,
    PERMISSIONS.APPROVE_REJECT,
    PERMISSIONS.VIEW_RUNS,
    PERMISSIONS.CANCEL_RUNS,
    PERMISSIONS.MANAGE_MEMBERS,
    PERMISSIONS.INVITE_MEMBERS,
    PERMISSIONS.REMOVE_MEMBERS,
    PERMISSIONS.MANAGE_CREDENTIALS,
    PERMISSIONS.MANAGE_ALLOWLIST,
    PERMISSIONS.MANAGE_WEBHOOK_SECRETS,
    PERMISSIONS.MANAGE_OWN_TOKENS,
    PERMISSIONS.MANAGE_OTHERS_TOKENS,
    PERMISSIONS.VIEW_AUDIT_LOG,
  ]),
  member: new Set<Permission>([
    PERMISSIONS.VIEW_WORKSPACE,
    PERMISSIONS.VIEW_WORKFLOWS,
    PERMISSIONS.RUN_WORKFLOWS,
    PERMISSIONS.APPROVE_REJECT,
    PERMISSIONS.VIEW_RUNS,
    PERMISSIONS.MANAGE_OWN_TOKENS,
  ]),
  viewer: new Set<Permission>([
    PERMISSIONS.VIEW_WORKSPACE,
    PERMISSIONS.VIEW_WORKFLOWS,
    PERMISSIONS.VIEW_RUNS,
  ]),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function getRolePermissions(role: Role): Permission[] {
  return Array.from(ROLE_PERMISSIONS[role] ?? []);
}
