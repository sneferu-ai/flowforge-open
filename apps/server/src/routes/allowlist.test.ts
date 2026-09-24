/**
 * BUG-014 regression: the allowlist host field accepts bare hostnames/IP
 * literals only — a `:port` suffix belongs in the separate port field.
 */

import { describe, it, expect } from 'vitest';
import { HOST_RE } from './allowlist.js';

describe('HOST_RE', () => {
  it('accepts bare hostnames', () => {
    expect(HOST_RE.test('example.com')).toBe(true);
    expect(HOST_RE.test('api.example.co.uk')).toBe(true);
    expect(HOST_RE.test('localhost')).toBe(true);
  });

  it('accepts IPv4 literals', () => {
    expect(HOST_RE.test('127.0.0.1')).toBe(true);
    expect(HOST_RE.test('192.168.1.20')).toBe(true);
  });

  it('rejects host:port — port is a separate field', () => {
    expect(HOST_RE.test('example.com:8080')).toBe(false);
    expect(HOST_RE.test('127.0.0.1:3000')).toBe(false);
  });

  it('rejects paths, wildcards, and schemes', () => {
    expect(HOST_RE.test('example.com/path')).toBe(false);
    expect(HOST_RE.test('*.example.com')).toBe(false);
    expect(HOST_RE.test('https://example.com')).toBe(false);
  });
});
