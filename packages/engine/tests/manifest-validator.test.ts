import { describe, it, expect } from 'vitest';
import { validateManifest } from '../src/index.js';

describe('Manifest Validator', () => {
  const validManifest = `
api_version: flowforge/v1
name: daily-standup
summary: Daily standup reminder
inputs:
  - name: channel
    type: string
    required: true
    default: "#general"
triggers:
  - type: schedule
    cron: "0 9 * * 1-5"
    timezone: "America/New_York"
steps:
  - id: send-reminder
    type: notify
    with:
      channel: email
      to: "team@example.com"
      body: "Time for standup!"
`;

  it('validates a correct manifest', () => {
    const result = validateManifest(validManifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects wrong api_version', () => {
    const manifest = validManifest.replace('flowforge/v1', 'v2');
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
  });

  it('rejects event trigger in v1', () => {
    const manifest = `
api_version: flowforge/v1
name: event-test
triggers:
  - type: event
steps:
  - id: log-it
    type: log
    with:
      message: "event received"
`;
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'event_trigger_not_supported_in_v1')).toBe(true);
  });

  it('rejects parallel step in v1', () => {
    const manifest = `
api_version: flowforge/v1
name: parallel-test
triggers:
  - type: schedule
    cron: "0 9 * * *"
    timezone: "UTC"
steps:
  - id: parallel-steps
    type: parallel
    with: {}
`;
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'parallel_not_supported_in_v1')).toBe(true);
  });

  it('rejects reply in schedule-only workflow', () => {
    const manifest = `
api_version: flowforge/v1
name: reply-test
triggers:
  - type: schedule
    cron: "0 9 * * *"
    timezone: "UTC"
steps:
  - id: respond
    type: reply
    with:
      status: 200
      body: "ok"
`;
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'reply_in_non_webhook')).toBe(true);
  });

  it('rejects multiple reply steps', () => {
    const manifest = `
api_version: flowforge/v1
name: multi-reply
triggers:
  - type: webhook
    path: "/hook"
    require_signature: true
    auth_mode: hmac
    secret: "WH_SECRET"
steps:
  - id: reply1
    type: reply
    with:
      status: 200
      body: "ok1"
  - id: reply2
    type: reply
    with:
      status: 200
      body: "ok2"
`;
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'multiple_reply_steps')).toBe(true);
  });

  it('rejects body on GET request', () => {
    const manifest = `
api_version: flowforge/v1
name: get-with-body
triggers:
  - type: schedule
    cron: "0 9 * * *"
    timezone: "UTC"
steps:
  - id: fetch-data
    type: http
    with:
      method: GET
      url: "https://api.example.com/data"
      body: "should not be here"
`;
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'body_on_get_head')).toBe(true);
  });

  it('rejects forbidden Host header', () => {
    const manifest = `
api_version: flowforge/v1
name: forbidden-header
triggers:
  - type: schedule
    cron: "0 9 * * *"
    timezone: "UTC"
steps:
  - id: fetch-data
    type: http
    with:
      method: GET
      url: "https://api.example.com/data"
      headers:
        Host: "evil.com"
`;
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'forbidden_header')).toBe(true);
  });

  it('rejects nesting deeper than 4', () => {
    // Build a manifest with depth 5
    const deepSteps = `
  - id: l1
    type: condition
    with:
      when: "true"
      then:
        - id: l2
          type: condition
          with:
            when: "true"
            then:
              - id: l3
                type: condition
                with:
                  when: "true"
                  then:
                    - id: l4
                      type: condition
                      with:
                        when: "true"
                        then:
                          - id: l5
                            type: log
                            with:
                              message: "too deep"
`;
    const manifest = `
api_version: flowforge/v1
name: deep-nesting
triggers:
  - type: schedule
    cron: "0 9 * * *"
    timezone: "UTC"
steps:
${deepSteps}
`;
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'nesting_too_deep')).toBe(true);
  });

  it('rejects duplicate step ids', () => {
    const manifest = `
api_version: flowforge/v1
name: dup-ids
triggers:
  - type: schedule
    cron: "0 9 * * *"
    timezone: "UTC"
steps:
  - id: do-thing
    type: log
    with:
      message: "first"
  - id: do-thing
    type: log
    with:
      message: "second"
`;
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Duplicate step id'))).toBe(true);
  });

  it('rejects webhook with empty secret when hmac', () => {
    const manifest = `
api_version: flowforge/v1
name: no-secret
triggers:
  - type: webhook
    path: "/hook"
    require_signature: true
    auth_mode: hmac
    secret: ""
steps:
  - id: log-it
    type: log
    with:
      message: "test"
`;
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
  });

  it('rejects manifest over 256KB', () => {
    const huge = '#'.repeat(257 * 1024);
    const manifest = `api_version: flowforge/v1\nname: big\ntriggers:\n  - type: schedule\n    cron: "0 9 * * *"\n    timezone: "UTC"\nsteps:\n  - id: s\n    type: log\n    with:\n      message: "${huge}"`;
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'manifest_too_large')).toBe(true);
  });

  it('allows reply in webhook workflow', () => {
    const manifest = `
api_version: flowforge/v1
name: webhook-reply
triggers:
  - type: webhook
    path: "/hook"
    require_signature: true
    auth_mode: hmac
    secret: "WH_SECRET"
steps:
  - id: process
    type: log
    with:
      message: "processing"
  - id: respond
    type: reply
    with:
      status: 200
      body: "ok"
`;
    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
  });

  // ── Per-type `with` config contracts (§5.3) ─────────────────────────────
  describe('per-type step config validation', () => {
    const wrap = (stepYaml: string) => `
api_version: flowforge/v1
name: cfg-${Math.random().toString(36).slice(2, 8)}
triggers:
  - type: schedule
    cron: "0 9 * * 1-5"
    timezone: "America/New_York"
steps:
${stepYaml}
`;

    it('http requires method and url', () => {
      const r = validateManifest(wrap(`  - id: h1\n    type: http\n    with: {}`));
      expect(r.valid).toBe(false);
      expect(r.errors.filter((e) => e.message.includes('http step config')).length).toBeGreaterThanOrEqual(2);
    });

    it('http rejects an unknown method', () => {
      const r = validateManifest(wrap(`  - id: h1\n    type: http\n    with: { method: YEET, url: "https://x.example" }`));
      expect(r.valid).toBe(false);
    });

    it('notify requires channel, to, and body', () => {
      const r = validateManifest(wrap(`  - id: n1\n    type: notify\n    with: { channel: email }`));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.path.includes('with.to'))).toBe(true);
      expect(r.errors.some((e) => e.path.includes('with.body'))).toBe(true);
    });

    it('delay requires duration', () => {
      const r = validateManifest(wrap(`  - id: d1\n    type: delay\n    with: {}`));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.path.includes('with.duration'))).toBe(true);
    });

    it('for_each requires over', () => {
      const r = validateManifest(wrap(`  - id: f1\n    type: for_each\n    with: {}\n    steps:\n      - id: l1\n        type: log\n        with: { message: "x" }`));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.path.includes('with.over'))).toBe(true);
    });

    it('condition requires when', () => {
      const r = validateManifest(wrap(`  - id: c1\n    type: condition\n    with: { then: [] }`));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.path.includes('with.when'))).toBe(true);
    });

    it('transform requires set', () => {
      const r = validateManifest(wrap(`  - id: t1\n    type: transform\n    with: {}`));
      expect(r.valid).toBe(false);
    });

    it('log requires message; reply requires status+body; manual_approval requires prompt', () => {
      expect(validateManifest(wrap(`  - id: l1\n    type: log\n    with: {}`)).valid).toBe(false);
      expect(validateManifest(wrap(`  - id: r1\n    type: reply\n    with: {}`)).valid).toBe(false);
      expect(validateManifest(wrap(`  - id: m1\n    type: manual_approval\n    with: {}`)).valid).toBe(false);
    });

    it('accepts fully-specified configs', () => {
      const r = validateManifest(wrap(`  - id: h1
    type: http
    with:
      method: POST
      url: "https://api.example.com/x"
      headers: { X-Trace: "1" }
      body: "hi"
  - id: d1
    type: delay
    with: { duration: "45s" }
  - id: n1
    type: notify
    with: { channel: inbox, to: "ops@example.com", body: "done" }
`));
      expect(r.errors).toEqual([]);
      expect(r.valid).toBe(true);
    });

    it('validates configs of steps nested in condition branches', () => {
      const r = validateManifest(wrap(`  - id: c1
    type: condition
    with:
      when: "true"
      then:
        - id: h1
          type: http
          with: {}
`));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.path.includes('c1.then.h1'))).toBe(true);
    });
  });

  // ── Schedule trigger cron + timezone validation (§5.1) ──────────────────
  describe('schedule trigger validation', () => {
    const wrap = (cron: string, timezone: string) => `
api_version: flowforge/v1
name: sched-test
triggers:
  - type: schedule
    cron: ${JSON.stringify(cron)}
    timezone: ${JSON.stringify(timezone)}
steps:
  - id: l1
    type: log
    with: { message: "tick" }
`;

    it.each(['not a cron', '1-5', '* * *', '61 * * * *', '* 25 * * *', '* * 0 * *', '* * * 13 *', '* * * * 8', '*/0 * * * *', '5-1 * * * *', 'a b c d e'])(
      'rejects invalid cron %j',
      (cron) => {
        const r = validateManifest(wrap(cron, 'UTC'));
        expect(r.valid).toBe(false);
        expect(r.errors.some((e) => e.message.includes('invalid cron expression'))).toBe(true);
      }
    );

    it.each(['* * * * *', '0 9 * * 1-5', '*/15 9-17 * * *', '30 3 1 * *', '0 0 1 1 *', '15,45 * * * *', '0 9 * * 0,7'])(
      'accepts valid cron %j',
      (cron) => {
        const r = validateManifest(wrap(cron, 'UTC'));
        expect(r.errors).toEqual([]);
      }
    );

    it.each(['Not/AZone', 'Mars/Olympus', 'UTC+2', ''])('rejects invalid timezone %j', (tz) => {
      const r = validateManifest(wrap('0 9 * * *', tz));
      expect(r.valid).toBe(false);
    });

    it.each(['UTC', 'America/New_York', 'Europe/Berlin', 'Asia/Tokyo'])('accepts valid timezone %j', (tz) => {
      const r = validateManifest(wrap('0 9 * * *', tz));
      expect(r.errors).toEqual([]);
    });
  });

  // ── filter/map inner expressions with escaped quotes ────────────────────
  it('parses filter/map inner expressions containing escaped quotes without false warnings', () => {
    const manifest = `
api_version: flowforge/v1
name: escaped-quotes
triggers:
  - type: schedule
    cron: "0 9 * * *"
    timezone: "UTC"
steps:
  - id: t1
    type: transform
    if: 'count(filter(inputs.items, "starts_with(item, \\"a\\")")) > 0'
    with:
      set:
        x: "1"
`;
    const r = validateManifest(manifest);
    expect(r.warnings.filter((w) => w.code === 'unparseable_expression')).toEqual([]);
  });

  it('still warns on genuinely unparseable inner expressions', () => {
    const manifest = `
api_version: flowforge/v1
name: bad-inner-expr
triggers:
  - type: schedule
    cron: "0 9 * * *"
    timezone: "UTC"
steps:
  - id: t1
    type: transform
    if: 'count(filter(inputs.items, "starts_with(item, )")) > 0'
    with:
      set:
        x: "1"
`;
    const r = validateManifest(manifest);
    expect(r.warnings.some((w) => w.code === 'unparseable_expression')).toBe(true);
  });

  // ── 256KB limit is measured in UTF-8 bytes ──────────────────────────────
  it('rejects manifests over 256KB in UTF-8 bytes even when char count is smaller', () => {
    // 3-byte CJK chars: ~90k chars → ~270KB bytes while .length stays < 256K.
    const filler = '界'.repeat(90_000);
    const manifest = `api_version: flowforge/v1
name: big-manifest
triggers:
  - type: schedule
    cron: "0 9 * * *"
    timezone: "UTC"
steps:
  - id: l1
    type: log
    with:
      message: "${filler}"
`;
    expect(manifest.length).toBeLessThan(256 * 1024);
    const r = validateManifest(manifest);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === 'manifest_too_large')).toBe(true);
  });
});
