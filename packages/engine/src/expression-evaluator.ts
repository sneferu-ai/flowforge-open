/**
 * FlowForge Open — Restricted Expression Language
 *
 * Full grammar per §5.4.2:
 *   expr := or_expr
 *   or_expr := and_expr ("or" and_expr)*
 *   and_expr := not_expr ("and" not_expr)*
 *   not_expr := "not" not_expr | comparison
 *   comparison := additive (comp_op additive)?
 *   additive := multiplicative (("+" | "-") multiplicative)*
 *   multiplicative := unary (("*" | "/" | "%") unary)*
 *   unary := "-" primary | primary
 *   primary := literal | "(" expr ")" | property_access | function_call
 *
 * Sandbox: no eval/vm/Function. Prototype blocked. Recursion depth 50.
 * Operation cap 10,000. Expression max length 500 chars.
 * env.* whitelist: only FF_APP_URL.
 */

import { DateTime } from 'luxon';

const MAX_EXPRESSION_LENGTH = 500;
const MAX_OPERATIONS = 10_000;
const MAX_RECURSION = 50;
const FORBIDDEN_PROPS = new Set(['__proto__', 'constructor', 'prototype']);

export class ExpressionError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ExpressionError';
  }
}

// --- Tokenizer ---
type TokenType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'null'
  | 'identifier'
  | 'dot'
  | 'lbracket'
  | 'rbracket'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'plus'
  | 'minus'
  | 'star'
  | 'slash'
  | 'percent'
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'or'
  | 'and'
  | 'not';

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    // Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // String literal — double or single quotes (spec canonical examples use
    // single quotes, e.g. `steps.x.output.decision == 'approved'`).
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let str = '';
      i++;
      while (i < len && input[i] !== quote) {
        if (input[i] === '\\') {
          i++;
          if (i >= len) throw new ExpressionError('unparseable_expression', 'Unterminated string escape');
          const esc = input[i];
          switch (esc) {
            case 'n': str += '\n'; break;
            case 't': str += '\t'; break;
            case 'r': str += '\r'; break;
            case '\\': str += '\\'; break;
            case '"': str += '"'; break;
            case "'": str += "'"; break;
            default:
              if (esc === 'u') {
                const hex = input.slice(i + 1, i + 5);
                if (!/^[0-9a-fA-F]{4}$/.test(hex))
                  throw new ExpressionError('unparseable_expression', 'Invalid unicode escape');
                str += String.fromCharCode(parseInt(hex, 16));
                i += 4;
              } else {
                str += esc;
              }
          }
        } else {
          str += input[i];
        }
        i++;
      }
      if (i >= len) throw new ExpressionError('unparseable_expression', 'Unterminated string literal');
      i++; // skip closing quote
      tokens.push({ type: 'string', value: str, pos: i });
      continue;
    }

    // Number
    if (/[0-9]/.test(ch)) {
      let num = '';
      while (i < len && /[0-9.]/.test(input[i])) {
        num += input[i];
        i++;
      }
      tokens.push({ type: 'number', value: num, pos: i });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let id = '';
      while (i < len && /[a-zA-Z0-9_]/.test(input[i])) {
        id += input[i];
        i++;
      }
      const lower = id.toLowerCase();
      if (lower === 'true' || lower === 'false') {
        tokens.push({ type: 'boolean', value: lower, pos: i });
      } else if (lower === 'null') {
        tokens.push({ type: 'null', value: 'null', pos: i });
      } else if (lower === 'or') {
        tokens.push({ type: 'or', value: 'or', pos: i });
      } else if (lower === 'and') {
        tokens.push({ type: 'and', value: 'and', pos: i });
      } else if (lower === 'not') {
        tokens.push({ type: 'not', value: 'not', pos: i });
      } else {
        tokens.push({ type: 'identifier', value: id, pos: i });
      }
      continue;
    }

    // Operators
    const two = input.slice(i, i + 2);
    if (two === '==') { tokens.push({ type: 'eq', value: '==', pos: i }); i += 2; continue; }
    if (two === '!=') { tokens.push({ type: 'neq', value: '!=', pos: i }); i += 2; continue; }
    if (two === '<=') { tokens.push({ type: 'lte', value: '<=', pos: i }); i += 2; continue; }
    if (two === '>=') { tokens.push({ type: 'gte', value: '>=', pos: i }); i += 2; continue; }

    switch (ch) {
      case '.': tokens.push({ type: 'dot', value: '.', pos: i }); break;
      case '[': tokens.push({ type: 'lbracket', value: '[', pos: i }); break;
      case ']': tokens.push({ type: 'rbracket', value: ']', pos: i }); break;
      case '(': tokens.push({ type: 'lparen', value: '(', pos: i }); break;
      case ')': tokens.push({ type: 'rparen', value: ')', pos: i }); break;
      case ',': tokens.push({ type: 'comma', value: ',', pos: i }); break;
      case '+': tokens.push({ type: 'plus', value: '+', pos: i }); break;
      case '-': tokens.push({ type: 'minus', value: '-', pos: i }); break;
      case '*': tokens.push({ type: 'star', value: '*', pos: i }); break;
      case '/': tokens.push({ type: 'slash', value: '/', pos: i }); break;
      case '%': tokens.push({ type: 'percent', value: '%', pos: i }); break;
      case '<': tokens.push({ type: 'lt', value: '<', pos: i }); break;
      case '>': tokens.push({ type: 'gt', value: '>', pos: i }); break;
      default:
        throw new ExpressionError('unparseable_expression', `Unexpected character '${ch}' at position ${i}`);
    }
    i++;
  }

  return tokens;
}

// --- AST nodes ---
type AstNode =
  | { kind: 'literal'; value: unknown }
  | { kind: 'property'; path: (string | number)[] }
  | { kind: 'binary'; op: string; left: AstNode; right: AstNode }
  | { kind: 'unary'; op: string; operand: AstNode }
  | { kind: 'call'; name: string; args: AstNode[] }
  | { kind: 'logical'; op: string; left: AstNode; right: AstNode }
  | { kind: 'not'; operand: AstNode };

// --- Parser (recursive descent) ---
class Parser {
  private tokens: Token[];
  private pos: number = 0;
  private ops: number = 0;
  private depth: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null;
  }

  private next(): Token {
    const tok = this.tokens[this.pos++];
    if (!tok) throw new ExpressionError('unparseable_expression', 'Unexpected end of expression');
    return tok;
  }

  private check(type: TokenType): boolean {
    const tok = this.peek();
    return tok !== null && tok.type === type;
  }

  private consume(type: TokenType): Token {
    if (!this.check(type)) {
      const tok = this.peek();
      throw new ExpressionError(
        'unparseable_expression',
        `Expected ${type} but got ${tok?.type ?? 'EOF'}`
      );
    }
    return this.next();
  }

  private countOp(): void {
    this.ops++;
    if (this.ops > MAX_OPERATIONS) {
      throw new ExpressionError('operation_limit_exceeded', 'Expression exceeds 10,000 operations');
    }
  }

  parse(): AstNode {
    const node = this.parseOr();
    if (this.pos < this.tokens.length) {
      const tok = this.peek();
      throw new ExpressionError('unparseable_expression', `Unexpected token: ${tok?.value}`);
    }
    return node;
  }

  private parseOr(): AstNode {
    let left = this.parseAnd();
    while (this.check('or')) {
      this.countOp();
      this.next();
      const right = this.parseAnd();
      left = { kind: 'logical', op: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): AstNode {
    let left = this.parseNot();
    while (this.check('and')) {
      this.countOp();
      this.next();
      const right = this.parseNot();
      left = { kind: 'logical', op: 'and', left, right };
    }
    return left;
  }

  private parseNot(): AstNode {
    if (this.check('not')) {
      this.countOp();
      this.next();
      const operand = this.parseNot();
      return { kind: 'not', operand };
    }
    return this.parseComparison();
  }

  private parseComparison(): AstNode {
    const left = this.parseAdditive();
    const tok = this.peek();
    if (tok && (tok.type === 'eq' || tok.type === 'neq' || tok.type === 'lt' || tok.type === 'lte' || tok.type === 'gt' || tok.type === 'gte')) {
      this.countOp();
      this.next();
      const right = this.parseAdditive();
      const op = tok.value;
      return { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseAdditive(): AstNode {
    let left = this.parseMultiplicative();
    while (this.check('plus') || this.check('minus')) {
      this.countOp();
      const op = this.next().value;
      const right = this.parseMultiplicative();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): AstNode {
    let left = this.parseUnary();
    while (this.check('star') || this.check('slash') || this.check('percent')) {
      this.countOp();
      const op = this.next().value;
      const right = this.parseUnary();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): AstNode {
    if (this.check('minus')) {
      this.countOp();
      this.next();
      const operand = this.parseUnary();
      return { kind: 'unary', op: '-', operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): AstNode {
    this.depth++;
    if (this.depth > MAX_RECURSION) {
      throw new ExpressionError('operation_limit_exceeded', 'Recursion depth exceeded');
    }

    const tok = this.peek();
    if (!tok) throw new ExpressionError('unparseable_expression', 'Unexpected end of expression');

    // Literals
    if (tok.type === 'number') {
      this.next();
      this.depth--;
      return { kind: 'literal', value: parseFloat(tok.value) };
    }
    if (tok.type === 'string') {
      this.next();
      this.depth--;
      return { kind: 'literal', value: tok.value };
    }
    if (tok.type === 'boolean') {
      this.next();
      this.depth--;
      return { kind: 'literal', value: tok.value === 'true' };
    }
    if (tok.type === 'null') {
      this.next();
      this.depth--;
      return { kind: 'literal', value: null };
    }

    // Parenthesized
    if (tok.type === 'lparen') {
      this.next();
      const expr = this.parseOr();
      this.consume('rparen');
      this.depth--;
      return expr;
    }

    // Identifier → property access or function call
    if (tok.type === 'identifier') {
      this.next();
      const name = tok.value;

      // Function call
      if (this.check('lparen')) {
        this.next();
        const args: AstNode[] = [];
        if (!this.check('rparen')) {
          args.push(this.parseOr());
          while (this.check('comma')) {
            this.next();
            args.push(this.parseOr());
          }
        }
        this.consume('rparen');
        this.depth--;
        return { kind: 'call', name, args };
      }

      // Property access chain
      const path: (string | number)[] = [name];
      while (this.check('dot') || this.check('lbracket')) {
        this.countOp();
        if (this.check('dot')) {
          this.next();
          const propTok = this.consume('identifier');
          if (FORBIDDEN_PROPS.has(propTok.value)) {
            throw new ExpressionError('forbidden_property_access', `Access to '${propTok.value}' is forbidden`);
          }
          path.push(propTok.value);
        } else {
          // lbracket
          this.next();
          const indexExpr = this.parseOr();
          this.consume('rbracket');
          // For literal indices, store the value directly
          if (indexExpr.kind === 'literal') {
            path.push(indexExpr.value as string | number);
          } else {
            // Dynamic index — will need to evaluate at runtime
            path.push({ dyn: indexExpr } as unknown as string);
          }
        }
      }

      this.depth--;
      return { kind: 'property', path };
    }

    throw new ExpressionError('unparseable_expression', `Unexpected token: ${tok.value}`);
  }
}

// --- Evaluation context ---
export interface EvalContext {
  inputs?: Record<string, unknown>;
  steps?: Record<string, { output: unknown; status: string }>;
  loop?: { item: unknown; index: number; outer: EvalContext['loop'] | null } | null;
  trigger?: { type: string; payload: unknown };
  secrets?: Record<string, string> | ((name: string) => string | null);
  env?: { FF_APP_URL: string | null };
  run?: { id: string; scheduled_at: string | null };
  // For filter/map inner expressions
  item?: unknown;
  index?: number;
}

// --- Truthiness ---
export function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return true; // empty object {} is truthy
  return false;
}

// --- Equality with coercion ---
export function isEqual(left: unknown, right: unknown): boolean {
  // null
  if (left === null && right === null) return true;
  if (left === null || right === null) return false;

  // Arrays
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((v, i) => isEqual(v, right[i]));
  }

  // Objects (deep equality)
  if (typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    const lk = Object.keys(left as object);
    const rk = Object.keys(right as object);
    if (lk.length !== rk.length) return false;
    return lk.every((k) => k in (right as object) && isEqual((left as Record<string, unknown>)[k], (right as Record<string, unknown>)[k]));
  }

  // number vs number
  if (typeof left === 'number' && typeof right === 'number') return left === right;

  // string vs string
  if (typeof left === 'string' && typeof right === 'string') return left === right;

  // boolean vs boolean
  if (typeof left === 'boolean' && typeof right === 'boolean') return left === right;

  // number vs string → try parse string to number
  if (typeof left === 'number' && typeof right === 'string') {
    const n = parseFloat(right);
    return isNaN(n) ? false : left === n;
  }
  if (typeof left === 'string' && typeof right === 'number') {
    const n = parseFloat(left);
    return isNaN(n) ? false : n === right;
  }

  // boolean vs number → coerce boolean to number
  if (typeof left === 'boolean' && typeof right === 'number') return (left ? 1 : 0) === right;
  if (typeof left === 'number' && typeof right === 'boolean') return left === (right ? 1 : 0);

  // string vs boolean → no coercion → false
  // array/object vs anything else → false
  return false;
}

// --- Comparison ---
function compareValues(op: string, left: unknown, right: unknown): boolean {
  // Both numbers
  if (typeof left === 'number' && typeof right === 'number') {
    return numericCompare(op, left, right);
  }
  // Both strings
  if (typeof left === 'string' && typeof right === 'string') {
    return stringCompare(op, left, right);
  }

  // Attempt number conversion
  const ln = toNumber(left);
  const rn = toNumber(right);
  if (ln !== null && rn !== null) {
    return numericCompare(op, ln, rn);
  }

  throw new ExpressionError('type_mismatch', `Cannot compare ${typeof left} and ${typeof right} with ${op}`);
}

function numericCompare(op: string, left: number, right: number): boolean {
  switch (op) {
    case '<': return left < right;
    case '<=': return left <= right;
    case '>': return left > right;
    case '>=': return left >= right;
    case '==': return left === right;
    case '!=': return left !== right;
    default: return false;
  }
}

function stringCompare(op: string, left: string, right: string): boolean {
  switch (op) {
    case '<': return left < right;
    case '<=': return left <= right;
    case '>': return left > right;
    case '>=': return left >= right;
    case '==': return left === right;
    case '!=': return left !== right;
    default: return false;
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null) return 0;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return isNaN(n) ? null : n;
  }
  return null;
}

// --- Arithmetic ---
function arithOp(op: string, left: unknown, right: unknown): unknown {
  // String concatenation
  if (op === '+' && typeof left === 'string' && typeof right === 'string') {
    return left + right;
  }
  // String + number → type_mismatch (no implicit coercion for concatenation)
  if (op === '+' && ((typeof left === 'string' && typeof right === 'number') || (typeof left === 'number' && typeof right === 'string'))) {
    throw new ExpressionError('type_mismatch', 'Cannot concatenate string and number');
  }

  const ln = toNumberStrict(left, op);
  const rn = toNumberStrict(right, op);

  switch (op) {
    case '+': return ln + rn;
    case '-': return ln - rn;
    case '*': return ln * rn;
    case '/':
      if (rn === 0) throw new ExpressionError('type_mismatch', 'Division by zero');
      return ln / rn;
    case '%':
      if (rn === 0) throw new ExpressionError('type_mismatch', 'Modulo by zero');
      return ln % rn;
    default:
      throw new ExpressionError('type_mismatch', `Unknown operator: ${op}`);
  }
}

function toNumberStrict(value: unknown, op: string): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null) return 0;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (isNaN(n)) throw new ExpressionError('type_mismatch', `Cannot use string as number with ${op}`);
    return n;
  }
  throw new ExpressionError('type_mismatch', `Cannot use ${typeof value} with ${op}`);
}

// --- Property access ---
function getProperty(obj: unknown, key: string | number): unknown {
  if (obj === null || obj === undefined) return null;
  if (typeof key === 'string' && FORBIDDEN_PROPS.has(key)) {
    throw new ExpressionError('forbidden_property_access', `Access to '${key}' is forbidden`);
  }
  if (Array.isArray(obj)) {
    if (typeof key === 'number') return obj[key] ?? null;
    if (typeof key === 'string') {
      const n = parseInt(key, 10);
      if (!isNaN(n)) return obj[n] ?? null;
    }
    return null;
  }
  if (typeof obj === 'object') {
    return (obj as Record<string, unknown>)[key as string] ?? null;
  }
  // string, number, boolean → null
  return null;
}

// --- Resolve property path ---
function resolveProperty(path: (string | number)[], ctx: EvalContext, ops: { count: number }): unknown {
  if (path.length === 0) return null;

  const root = path[0] as string;
  let current: unknown;

  switch (root) {
    case 'inputs':
      current = ctx.inputs ?? {};
      break;
    case 'steps':
      current = ctx.steps ?? {};
      break;
    case 'loop':
      if (!ctx.loop) return null;
      current = ctx.loop;
      break;
    case 'trigger':
      current = ctx.trigger ?? { type: 'manual', payload: null };
      break;
    case 'secrets':
      current = null; // handled specially below
      break;
    case 'env':
      current = ctx.env ?? { FF_APP_URL: null };
      break;
    case 'run':
      current = ctx.run ?? { id: '', scheduled_at: null };
      break;
    case 'item':
      current = ctx.item;
      break;
    case 'index':
      current = ctx.index;
      break;
    case 'now':
      // This is a function, not a property — shouldn't reach here
      return null;
    default:
      throw new ExpressionError('unknown_variable', `Unknown variable: ${root}`);
  }

  // Handle secrets specially
  if (root === 'secrets' && path.length > 1) {
    const secretName = path[1] as string;
    if (typeof ctx.secrets === 'function') {
      return ctx.secrets(secretName);
    }
    if (ctx.secrets && typeof ctx.secrets === 'object') {
      return (ctx.secrets as Record<string, string>)[secretName] ?? null;
    }
    return null;
  }

  // Handle env specially
  if (root === 'env' && path.length > 1) {
    const varName = path[1] as string;
    if (varName !== 'FF_APP_URL') {
      throw new ExpressionError('unknown_env_variable', `Unknown environment variable: ${varName}`);
    }
    return ctx.env?.FF_APP_URL ?? null;
  }

  // Walk remaining path
  for (let i = 1; i < path.length; i++) {
    ops.count++;
    if (ops.count > MAX_OPERATIONS) {
      throw new ExpressionError('operation_limit_exceeded', 'Expression exceeds 10,000 operations');
    }
    const key = path[i];
    if (typeof key === 'object' && key !== null && 'dyn' in (key as object)) {
      // Dynamic index
      const dynKey = (key as { dyn: AstNode }).dyn;
      const dynVal = evaluate(dynKey, ctx, ops);
      current = getProperty(current, dynVal as string | number);
    } else {
      current = getProperty(current, key as string | number);
    }
  }

  return current;
}

// --- Built-in functions ---
function callFunction(name: string, args: unknown[], ctx: EvalContext, ops: { count: number }): unknown {
  switch (name) {
    case 'len':
      if (args.length !== 1) throw new ExpressionError('type_mismatch', 'len() takes 1 argument');
      const a = args[0];
      if (typeof a === 'string') return a.length;
      if (Array.isArray(a)) return a.length;
      if (a === null) return 0;
      throw new ExpressionError('type_mismatch', 'len() expects string or array');
    case 'lower':
      if (args.length !== 1) throw new ExpressionError('type_mismatch', 'lower() takes 1 argument');
      return String(args[0] ?? '').toLowerCase();
    case 'upper':
      if (args.length !== 1) throw new ExpressionError('type_mismatch', 'upper() takes 1 argument');
      return String(args[0] ?? '').toUpperCase();
    case 'trim':
      if (args.length !== 1) throw new ExpressionError('type_mismatch', 'trim() takes 1 argument');
      return String(args[0] ?? '').trim();
    case 'join':
      if (args.length !== 2) throw new ExpressionError('type_mismatch', 'join() takes 2 arguments');
      if (!Array.isArray(args[0])) throw new ExpressionError('type_mismatch', 'join() expects array as first arg');
      return (args[0] as unknown[]).map(String).join(String(args[1]));
    case 'split':
      if (args.length !== 2) throw new ExpressionError('type_mismatch', 'split() takes 2 arguments');
      return String(args[0] ?? '').split(String(args[1]));
    case 'contains':
      if (args.length !== 2) throw new ExpressionError('type_mismatch', 'contains() takes 2 arguments');
      const haystack = args[0];
      const needle: unknown = args[1];
      if (typeof haystack === 'string') return haystack.includes(String(needle));
      if (Array.isArray(haystack)) return haystack.some((v) => isEqual(v, needle));
      if (typeof haystack === 'object' && haystack !== null) return String(needle) in (haystack as object);
      return false;
    case 'starts_with':
      if (args.length !== 2) throw new ExpressionError('type_mismatch', 'starts_with() takes 2 arguments');
      return String(args[0] ?? '').startsWith(String(args[1]));
    case 'ends_with':
      if (args.length !== 2) throw new ExpressionError('type_mismatch', 'ends_with() takes 2 arguments');
      return String(args[0] ?? '').endsWith(String(args[1]));
    case 'default':
      if (args.length !== 2) throw new ExpressionError('type_mismatch', 'default() takes 2 arguments');
      return args[0] === null || args[0] === undefined ? args[1] : args[0];
    case 'coalesce':
      if (args.length < 2) throw new ExpressionError('type_mismatch', 'coalesce() takes at least 2 arguments');
      for (const a of args) {
        if (a !== null && a !== undefined) return a;
      }
      return null;
    case 'round':
      if (args.length !== 1) throw new ExpressionError('type_mismatch', 'round() takes 1 argument');
      return Math.round(args[0] as number);
    case 'abs':
      if (args.length !== 1) throw new ExpressionError('type_mismatch', 'abs() takes 1 argument');
      return Math.abs(args[0] as number);
    case 'now':
      if (args.length !== 0) throw new ExpressionError('type_mismatch', 'now() takes no arguments');
      return new Date().toISOString();
    case 'format_date':
      return formatDate(args);
    case 'date_add':
      return dateAdd(args);
    case 'date_diff':
      return dateDiff(args);
    case 'filter':
      return filterList(args, ctx, ops);
    case 'map':
      return mapList(args, ctx, ops);
    default:
      throw new ExpressionError('unknown_variable', `Unknown function: ${name}`);
  }
}

function formatDate(args: unknown[]): string {
  if (args.length < 2 || args.length > 3) throw new ExpressionError('type_mismatch', 'format_date() takes 2-3 arguments');
  const iso = args[0] as string;
  const fmt = args[1] as string;
  const tz = args[2] as string | undefined;

  const dt = DateTime.fromISO(iso, { zone: 'utc' });
  if (!dt.isValid) throw new ExpressionError('invalid_date_format', `Invalid ISO date: ${iso}`);

  let useDt = dt;
  if (tz) {
    const tzDt = dt.setZone(tz);
    if (!tzDt.isValid) throw new ExpressionError('invalid_timezone', `Invalid timezone: ${tz}`);
    useDt = tzDt;
  }

  // Luxon-style tokens: yyyy, MM, dd, HH, mm, ss, ZZ
  return useDt.toFormat(fmt);
}

function dateAdd(args: unknown[]): string {
  if (args.length !== 3) throw new ExpressionError('type_mismatch', 'date_add() takes 3 arguments');
  const iso = args[0] as string;
  const amount = args[1] as number;
  const unit = args[2] as string;

  const dt = DateTime.fromISO(iso, { zone: 'utc' });
  if (!dt.isValid) throw new ExpressionError('invalid_date_format', `Invalid ISO date: ${iso}`);

  const validUnits = ['second', 'minute', 'hour', 'day', 'week', 'month', 'year'];
  if (!validUnits.includes(unit)) throw new ExpressionError('type_mismatch', `Invalid unit: ${unit}`);

  const result = dt.plus({ [unit]: amount } as Record<string, number>);
  return result.toUTC().toISO()!;
}

function dateDiff(args: unknown[]): number {
  if (args.length !== 3) throw new ExpressionError('type_mismatch', 'date_diff() takes 3 arguments');
  const isoA = args[0] as string;
  const isoB = args[1] as string;
  const unit = args[2] as string;

  const dtA = DateTime.fromISO(isoA, { zone: 'utc' });
  const dtB = DateTime.fromISO(isoB, { zone: 'utc' });
  if (!dtA.isValid) throw new ExpressionError('invalid_date_format', `Invalid ISO date: ${isoA}`);
  if (!dtB.isValid) throw new ExpressionError('invalid_date_format', `Invalid ISO date: ${isoB}`);

  const validUnits = ['second', 'minute', 'hour', 'day', 'week', 'month', 'year'];
  if (!validUnits.includes(unit)) throw new ExpressionError('type_mismatch', `Invalid unit: ${unit}`);

  const pluralMap: Record<string, string> = {
    second: 'seconds', minute: 'minutes', hour: 'hours', day: 'days',
    week: 'weeks', month: 'months', year: 'years',
  };
  const diff = dtB.diff(dtA, unit as 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year');
  return Math.trunc(diff[pluralMap[unit] as 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years']);
}

function filterList(args: unknown[], ctx: EvalContext, ops: { count: number }): unknown[] {
  if (args.length !== 2) throw new ExpressionError('type_mismatch', 'filter() takes 2 arguments');
  const list = args[0];
  const innerExprStr = args[1];

  if (!Array.isArray(list)) {
    if (list === null) return [];
    throw new ExpressionError('type_mismatch', 'filter() expects array as first arg');
  }
  if (typeof innerExprStr !== 'string') throw new ExpressionError('type_mismatch', 'filter() expects string expression as second arg');

  // Parse inner expression
  const innerAst = parseExpression(innerExprStr);

  return list.filter((item, index) => {
    const innerCtx: EvalContext = {
      ...ctx,
      loop: null, // loop.* NOT available inside filter/map
      item,
      index,
    };
    return isTruthy(evaluate(innerAst, innerCtx, ops));
  });
}

function mapList(args: unknown[], ctx: EvalContext, ops: { count: number }): unknown[] {
  if (args.length !== 2) throw new ExpressionError('type_mismatch', 'map() takes 2 arguments');
  const list = args[0];
  const innerExprStr = args[1];

  if (!Array.isArray(list)) {
    if (list === null) return [];
    throw new ExpressionError('type_mismatch', 'map() expects array as first arg');
  }
  if (typeof innerExprStr !== 'string') throw new ExpressionError('type_mismatch', 'map() expects string expression as second arg');

  const innerAst = parseExpression(innerExprStr);

  return list.map((item, index) => {
    const innerCtx: EvalContext = {
      ...ctx,
      loop: null,
      item,
      index,
    };
    return evaluate(innerAst, innerCtx, ops);
  });
}

// --- Parse expression (with length check) ---
export function parseExpression(expr: string): AstNode {
  if (expr.length > MAX_EXPRESSION_LENGTH) {
    throw new ExpressionError('expression_too_long', 'Expression exceeds 500 characters');
  }
  const tokens = tokenize(expr);
  if (tokens.length === 0) {
    throw new ExpressionError('unparseable_expression', 'Empty expression');
  }
  const parser = new Parser(tokens);
  return parser.parse();
}

// --- Evaluate AST ---
function evaluate(node: AstNode, ctx: EvalContext, ops: { count: number }): unknown {
  ops.count++;
  if (ops.count > MAX_OPERATIONS) {
    throw new ExpressionError('operation_limit_exceeded', 'Expression exceeds 10,000 operations');
  }

  switch (node.kind) {
    case 'literal':
      return node.value;

    case 'property':
      return resolveProperty(node.path, ctx, ops);

    case 'not':
      return !isTruthy(evaluate(node.operand, ctx, ops));

    case 'logical': {
      const left = evaluate(node.left, ctx, ops);
      if (node.op === 'or') {
        if (isTruthy(left)) return true;
        return isTruthy(evaluate(node.right, ctx, ops));
      } else {
        if (!isTruthy(left)) return false;
        return isTruthy(evaluate(node.right, ctx, ops));
      }
    }

    case 'binary': {
      const left = evaluate(node.left, ctx, ops);
      const right = evaluate(node.right, ctx, ops);
      switch (node.op) {
        case '==': return isEqual(left, right);
        case '!=': return !isEqual(left, right);
        case '<': case '<=': case '>': case '>=':
          return compareValues(node.op, left, right);
        case '+': case '-': case '*': case '/': case '%':
          return arithOp(node.op, left, right);
        default:
          throw new ExpressionError('unparseable_expression', `Unknown operator: ${node.op}`);
      }
    }

    case 'unary': {
      const val = evaluate(node.operand, ctx, ops);
      if (node.op === '-') {
        const n = toNumberStrict(val, '-');
        return -n;
      }
      throw new ExpressionError('unparseable_expression', `Unknown unary op: ${node.op}`);
    }

    case 'call': {
      const args = node.args.map((a) => evaluate(a, ctx, ops));
      return callFunction(node.name, args, ctx, ops);
    }

    default:
      throw new ExpressionError('unparseable_expression', `Unknown node kind: ${(node as { kind: string }).kind}`);
  }
}

// --- Public evaluate function ---
export function evaluateExpression(expr: string, ctx: EvalContext): unknown {
  const ast = parseExpression(expr);
  const ops = { count: 0 };
  return evaluate(ast, ctx, ops);
}

// --- Interpolation ({{ }} with \{{ escape) ---
export function resolveInterpolation(str: string, ctx: EvalContext): string {
  let result = '';
  let i = 0;
  const len = str.length;

  while (i < len) {
    // Escape sequence \{{
    if (str[i] === '\\' && str.slice(i + 1, i + 3) === '{{') {
      result += '{{';
      i += 3;
      continue;
    }

    // Expression block {{
    if (str.slice(i, i + 2) === '{{') {
      i += 2;
      // Skip whitespace
      while (i < len && /\s/.test(str[i])) i++;
      let exprStr = '';
      while (i < len && str.slice(i, i + 2) !== '}}') {
        exprStr += str[i];
        i++;
      }
      if (i >= len) throw new ExpressionError('unparseable_expression', 'Unclosed {{ in interpolation');
      i += 2; // skip }}
      const val = evaluateExpression(exprStr.trim(), ctx);
      result += stringifyValue(val);
      continue;
    }

    result += str[i];
    i++;
  }

  return result;
}

/** Interpolation stringification: null→"", true→"true", false→"false", number→shortest decimal, array→JSON, object→JSON */
export function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * Pure {{ expr }} interpolation — for transform.set values.
 * If the entire field is one expression block, returns the native value.
 * Otherwise, interpolates to string.
 */
export function resolvePureInterpolation(str: string, ctx: EvalContext): unknown {
  const trimmed = str.trim();
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) {
    // Check if the entire string is one expression block (possibly with whitespace)
    const inner = trimmed.slice(2, -2).trim();
    // Make sure there are no other {{ or }} inside
    if (!inner.includes('{{') && !inner.includes('}}')) {
      return evaluateExpression(inner, ctx);
    }
  }
  return resolveInterpolation(str, ctx);
}
