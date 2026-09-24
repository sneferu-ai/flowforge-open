import { describe, it, expect } from 'vitest';
import {
  evaluateExpression,
  resolveInterpolation,
  stringifyValue,
  isTruthy,
  isEqual,
  ExpressionError,
  parseExpression,
} from '../src/index.js';
import type { EvalContext } from '../src/index.js';

const baseCtx: EvalContext = {
  inputs: { name: 'Alice', age: 30, tags: ['a', 'b', 'c'], count: 3 },
  steps: {
    fetch: { output: { status: 200, body: { id: 42, name: 'Widget' } }, status: 'succeeded' },
  },
  loop: null,
  trigger: { type: 'webhook', payload: { event: 'created', data: { id: 99 } } },
  secrets: { API_KEY: 'secret123' },
  env: { FF_APP_URL: 'https://app.flowforge.dev' },
  run: { id: 'run-abc', scheduled_at: null },
};

describe('Expression Evaluator', () => {
  describe('Literals', () => {
    it('parses number literal', () => {
      expect(evaluateExpression('42', baseCtx)).toBe(42);
    });
    it('parses string literal', () => {
      expect(evaluateExpression('"hello"', baseCtx)).toBe('hello');
    });
    it('parses boolean true', () => {
      expect(evaluateExpression('true', baseCtx)).toBe(true);
    });
    it('parses boolean false', () => {
      expect(evaluateExpression('false', baseCtx)).toBe(false);
    });
    it('parses null', () => {
      expect(evaluateExpression('null', baseCtx)).toBe(null);
    });
  });

  describe('Property access', () => {
    it('reads inputs.name', () => {
      expect(evaluateExpression('inputs.name', baseCtx)).toBe('Alice');
    });
    it('reads inputs.age', () => {
      expect(evaluateExpression('inputs.age', baseCtx)).toBe(30);
    });
    it('reads steps.fetch.output.status', () => {
      expect(evaluateExpression('steps.fetch.output.status', baseCtx)).toBe(200);
    });
    it('reads steps.fetch.output.body.id', () => {
      expect(evaluateExpression('steps.fetch.output.body.id', baseCtx)).toBe(42);
    });
    it('reads trigger.type', () => {
      expect(evaluateExpression('trigger.type', baseCtx)).toBe('webhook');
    });
    it('reads trigger.payload.data.id', () => {
      expect(evaluateExpression('trigger.payload.data.id', baseCtx)).toBe(99);
    });
    it('reads secrets.API_KEY', () => {
      expect(evaluateExpression('secrets.API_KEY', baseCtx)).toBe('secret123');
    });
    it('reads env.FF_APP_URL', () => {
      expect(evaluateExpression('env.FF_APP_URL', baseCtx)).toBe('https://app.flowforge.dev');
    });
    it('reads array index inputs.tags[0]', () => {
      expect(evaluateExpression('inputs.tags[0]', baseCtx)).toBe('a');
    });
    it('reads run.id', () => {
      expect(evaluateExpression('run.id', baseCtx)).toBe('run-abc');
    });
  });

  describe('Arithmetic', () => {
    it('adds numbers', () => {
      expect(evaluateExpression('1 + 2', baseCtx)).toBe(3);
    });
    it('subtracts numbers', () => {
      expect(evaluateExpression('10 - 3', baseCtx)).toBe(7);
    });
    it('multiplies numbers', () => {
      expect(evaluateExpression('4 * 5', baseCtx)).toBe(20);
    });
    it('divides numbers', () => {
      expect(evaluateExpression('10 / 4', baseCtx)).toBe(2.5);
    });
    it('modulos numbers', () => {
      expect(evaluateExpression('10 % 3', baseCtx)).toBe(1);
    });
    it('concats strings', () => {
      expect(evaluateExpression('"hello" + " " + "world"', baseCtx)).toBe('hello world');
    });
    it('rejects string + number', () => {
      expect(() => evaluateExpression('"hello" + 5', baseCtx)).toThrow(ExpressionError);
    });
    it('unary minus', () => {
      expect(evaluateExpression('-5', baseCtx)).toBe(-5);
    });
  });

  describe('Logical', () => {
    it('or true', () => {
      expect(evaluateExpression('true or false', baseCtx)).toBe(true);
    });
    it('or false', () => {
      expect(evaluateExpression('false or false', baseCtx)).toBe(false);
    });
    it('and true', () => {
      expect(evaluateExpression('true and true', baseCtx)).toBe(true);
    });
    it('and false', () => {
      expect(evaluateExpression('true and false', baseCtx)).toBe(false);
    });
    it('not true', () => {
      expect(evaluateExpression('not true', baseCtx)).toBe(false);
    });
    it('not false', () => {
      expect(evaluateExpression('not false', baseCtx)).toBe(true);
    });
    it('short-circuit or', () => {
      expect(evaluateExpression('true or unknown_var', baseCtx)).toBe(true);
    });
    it('short-circuit and', () => {
      expect(evaluateExpression('false and unknown_var', baseCtx)).toBe(false);
    });
  });

  describe('Comparison', () => {
    it('numeric less than', () => {
      expect(evaluateExpression('1 < 2', baseCtx)).toBe(true);
    });
    it('numeric greater than', () => {
      expect(evaluateExpression('3 > 5', baseCtx)).toBe(false);
    });
    it('string less than', () => {
      expect(evaluateExpression('"abc" < "abd"', baseCtx)).toBe(true);
    });
    it('equality numbers', () => {
      expect(evaluateExpression('42 == 42', baseCtx)).toBe(true);
    });
    it('inequality numbers', () => {
      expect(evaluateExpression('42 != 43', baseCtx)).toBe(true);
    });
    it('equality string to number (coercion)', () => {
      expect(evaluateExpression('"42" == 42', baseCtx)).toBe(true);
    });
  });

  describe('Functions', () => {
    it('len() on string', () => {
      expect(evaluateExpression('len("hello")', baseCtx)).toBe(5);
    });
    it('len() on array', () => {
      expect(evaluateExpression('len(inputs.tags)', baseCtx)).toBe(3);
    });
    it('lower()', () => {
      expect(evaluateExpression('lower("HELLO")', baseCtx)).toBe('hello');
    });
    it('upper()', () => {
      expect(evaluateExpression('upper("hello")', baseCtx)).toBe('HELLO');
    });
    it('contains() on string', () => {
      expect(evaluateExpression('contains("hello world", "world")', baseCtx)).toBe(true);
    });
    it('contains() on array', () => {
      expect(evaluateExpression('contains(inputs.tags, "b")', baseCtx)).toBe(true);
    });
    it('default() with null', () => {
      expect(evaluateExpression('default(null, "fallback")', baseCtx)).toBe('fallback');
    });
    it('default() with value', () => {
      expect(evaluateExpression('default("real", "fallback")', baseCtx)).toBe('real');
    });
    it('coalesce()', () => {
      expect(evaluateExpression('coalesce(null, null, "third", "fourth")', baseCtx)).toBe('third');
    });
    it('round()', () => {
      expect(evaluateExpression('round(3.7)', baseCtx)).toBe(4);
    });
    it('abs()', () => {
      expect(evaluateExpression('abs(-5)', baseCtx)).toBe(5);
    });
    it('now() returns ISO string', () => {
      const result = evaluateExpression('now()', baseCtx) as string;
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
    it('format_date()', () => {
      const result = evaluateExpression('format_date("2024-01-15T10:30:00Z", "yyyy-MM-dd")', baseCtx);
      expect(result).toBe('2024-01-15');
    });
    it('date_add() days', () => {
      const result = evaluateExpression('date_add("2024-01-15T00:00:00Z", 5, "day")', baseCtx);
      expect(result).toBe('2024-01-20T00:00:00.000Z');
    });
    it('date_diff() days', () => {
      const result = evaluateExpression('date_diff("2024-01-10T00:00:00Z", "2024-01-15T00:00:00Z", "day")', baseCtx);
      expect(result).toBe(5);
    });
  });

  describe('filter/map', () => {
    it('filter array', () => {
      const result = evaluateExpression('filter(inputs.tags, "starts_with(item, \\"a\\")")', baseCtx);
      expect(result).toEqual(['a']);
    });
    it('map array', () => {
      const result = evaluateExpression('map(inputs.tags, "upper(item)")', baseCtx);
      expect(result).toEqual(['A', 'B', 'C']);
    });
    it('item and index available inside filter', () => {
      const result = evaluateExpression('filter(inputs.tags, "index > 0")', baseCtx);
      expect(result).toEqual(['b', 'c']);
    });
  });

  describe('Security', () => {
    it('blocks __proto__', () => {
      expect(() => evaluateExpression('inputs.__proto__', baseCtx)).toThrow(ExpressionError);
    });
    it('blocks constructor', () => {
      expect(() => evaluateExpression('inputs.constructor', baseCtx)).toThrow(ExpressionError);
    });
    it('blocks unknown env var', () => {
      expect(() => evaluateExpression('env.PATH', baseCtx)).toThrow(ExpressionError);
    });
    it('rejects expression > 500 chars', () => {
      const longExpr = '1 + ' + '1 + '.repeat(130);
      expect(() => evaluateExpression(longExpr, baseCtx)).toThrow(ExpressionError);
    });
  });

  describe('Truthiness', () => {
    it('empty string is falsy', () => {
      expect(isTruthy('')).toBe(false);
    });
    it('non-empty string is truthy', () => {
      expect(isTruthy('hello')).toBe(true);
    });
    it('0 is falsy', () => {
      expect(isTruthy(0)).toBe(false);
    });
    it('non-zero number is truthy', () => {
      expect(isTruthy(42)).toBe(true);
    });
    it('null is falsy', () => {
      expect(isTruthy(null)).toBe(false);
    });
    it('empty array is falsy', () => {
      expect(isTruthy([])).toBe(false);
    });
    it('non-empty array is truthy', () => {
      expect(isTruthy([1])).toBe(true);
    });
    it('empty object is truthy', () => {
      expect(isTruthy({})).toBe(true);
    });
  });

  describe('Equality', () => {
    it('null == null', () => {
      expect(isEqual(null, null)).toBe(true);
    });
    it('null == undefined', () => {
      expect(isEqual(null, undefined)).toBe(false);
    });
    it('deep array equality', () => {
      expect(isEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    });
    it('deep object equality', () => {
      expect(isEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    });
    it('number == string (coercion)', () => {
      expect(isEqual(42, '42')).toBe(true);
    });
  });

  describe('Interpolation', () => {
    it('interpolates {{ expr }}', () => {
      expect(resolveInterpolation('Hello, {{ inputs.name }}!', baseCtx)).toBe('Hello, Alice!');
    });
    it('interpolates multiple expressions', () => {
      expect(resolveInterpolation('{{ inputs.name }} is {{ inputs.age }}', baseCtx)).toBe('Alice is 30');
    });
    it('escapes \\{{ }}', () => {
      expect(resolveInterpolation('Literal \\{{ inputs.name }}', baseCtx)).toBe('Literal {{ inputs.name }}');
    });
    it('null becomes empty string', () => {
      expect(resolveInterpolation('value: {{ inputs.missing }}', baseCtx)).toBe('value: ');
    });
  });

  describe('Stringify', () => {
    it('null → empty string', () => {
      expect(stringifyValue(null)).toBe('');
    });
    it('true → "true"', () => {
      expect(stringifyValue(true)).toBe('true');
    });
    it('false → "false"', () => {
      expect(stringifyValue(false)).toBe('false');
    });
    it('number → string', () => {
      expect(stringifyValue(42)).toBe('42');
    });
    it('array → JSON', () => {
      expect(stringifyValue([1, 2])).toBe('[1,2]');
    });
  });

  describe('Single-quoted strings (spec canonical)', () => {
    it("evaluates == 'approved' comparisons", () => {
      const ctx = { steps: { request_approval: { output: { decision: 'approved' }, status: 'succeeded' } } };
      expect(evaluateExpression("steps.request_approval.output.decision == 'approved'", ctx)).toBe(true);
      expect(evaluateExpression("steps.request_approval.output.decision == 'rejected'", ctx)).toBe(false);
    });
    it('supports single-quoted literals on both sides', () => {
      expect(evaluateExpression("'a' == 'a'", {})).toBe(true);
      expect(evaluateExpression("'a' != 'b'", {})).toBe(true);
    });
    it('handles escapes inside single quotes', () => {
      expect(evaluateExpression("'it\\'s' == \"it's\"", {})).toBe(true);
    });
  });
});
