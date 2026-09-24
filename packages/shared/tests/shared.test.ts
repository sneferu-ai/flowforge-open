import { describe, it, expect } from 'vitest';
import { validatePasswordPolicy, isBreachedPassword, isBreachedListUnavailable, reloadBreachedHashes, PLAN_DEFINITIONS, getPlanDefinition, hasPermission, PERMISSIONS } from '../src/index.js';

describe('Password Policy', () => {
  it('rejects password shorter than 12 chars', () => {
    const result = validatePasswordPolicy('short1');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('12 characters');
  });

  it('rejects password without a letter', () => {
    const result = validatePasswordPolicy('123456789012');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('letter');
  });

  it('rejects password without a number', () => {
    const result = validatePasswordPolicy('abcdefghijkl');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('number');
  });

  it('rejects breached password', () => {
    reloadBreachedHashes();
    const result = validatePasswordPolicy('demo-password-changeme1');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('password_too_common');
  });

  it('accepts a strong password', () => {
    const result = validatePasswordPolicy('my-secure-pass-2024');
    expect(result.valid).toBe(true);
  });

  it('detects breached password by hash', () => {
    reloadBreachedHashes();
    expect(isBreachedPassword('password')).toBe(true);
    expect(isBreachedPassword('123456')).toBe(true);
    expect(isBreachedPassword('totally-unique-pw-99999')).toBe(false);
  });
});

describe('Plan Definitions', () => {
  it('has 5 plans', () => {
    expect(PLAN_DEFINITIONS).toHaveLength(5);
  });

  it('community plan has unlimited runs', () => {
    const plan = getPlanDefinition('community');
    expect(plan).toBeDefined();
    expect(plan?.run_limit).toBeNull();
  });

  it('free plan has 500 run limit', () => {
    const plan = getPlanDefinition('free');
    expect(plan?.run_limit).toBe(500);
  });

  it('pro plan has 10000 run limit', () => {
    const plan = getPlanDefinition('pro');
    expect(plan?.run_limit).toBe(10000);
  });

  it('studio plan has 50000 run limit', () => {
    const plan = getPlanDefinition('studio');
    expect(plan?.run_limit).toBe(50000);
  });

  it('demo plan exists', () => {
    const plan = getPlanDefinition('demo');
    expect(plan).toBeDefined();
    expect(plan?.name).toBe('Demo');
  });

  it('returns undefined for unknown plan', () => {
    expect(getPlanDefinition('nonexistent')).toBeUndefined();
  });
});

describe('RBAC matrix (§3.3)', () => {
  it('admin does NOT hold change_member_roles (Owner-only)', () => {
    expect(hasPermission('admin', PERMISSIONS.CHANGE_MEMBER_ROLES)).toBe(false);
    expect(hasPermission('owner', PERMISSIONS.CHANGE_MEMBER_ROLES)).toBe(true);
    expect(hasPermission('member', PERMISSIONS.CHANGE_MEMBER_ROLES)).toBe(false);
  });

  it('admin keeps member/credential/allowlist management', () => {
    expect(hasPermission('admin', PERMISSIONS.INVITE_MEMBERS)).toBe(true);
    expect(hasPermission('admin', PERMISSIONS.REMOVE_MEMBERS)).toBe(true);
    expect(hasPermission('admin', PERMISSIONS.MANAGE_CREDENTIALS)).toBe(true);
    expect(hasPermission('admin', PERMISSIONS.MANAGE_ALLOWLIST)).toBe(true);
  });

  it('owner holds every permission', () => {
    for (const p of Object.values(PERMISSIONS)) {
      expect(hasPermission('owner', p)).toBe(true);
    }
  });
});

describe('Password policy error codes (BUG-021)', () => {
  it('short password reports validation_error, not password_too_common', () => {
    const r = validatePasswordPolicy('short1');
    expect(r.valid).toBe(false);
    expect(r.code).toBe('validation_error');
  });

  it('complexity failures report validation_error', () => {
    expect(validatePasswordPolicy('123456789012').code).toBe('validation_error');
    expect(validatePasswordPolicy('abcdefghijkl').code).toBe('validation_error');
  });

  it('breached password reports password_too_common', () => {
    reloadBreachedHashes();
    const r = validatePasswordPolicy('demo-password-changeme1');
    expect(r.valid).toBe(false);
    expect(r.code).toBe('password_too_common');
  });
});

describe('Breached list fail-closed (BUG-023)', () => {
  it('treats every password as breached when the list cannot be loaded', () => {
    reloadBreachedHashes('/nonexistent/breached-passwords.txt');
    expect(isBreachedListUnavailable()).toBe(true);
    const r = validatePasswordPolicy('a-perfectly-fine-pw-123');
    expect(r.valid).toBe(false);
    expect(r.code).toBe('password_too_common');
    expect(r.error).toContain('unavailable');
    // Restore the real list for other tests.
    reloadBreachedHashes();
    expect(isBreachedListUnavailable()).toBe(false);
    expect(validatePasswordPolicy('my-secure-pass-2024').valid).toBe(true);
  });
});
