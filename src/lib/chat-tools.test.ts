import { describe, expect, it } from 'vitest';
import { chatTools, currentTimeIn, evaluateExpression } from './chat-tools';

describe('evaluateExpression', () => {
  it.each([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['10 / 4', 2.5],
    ['2 ^ 3 ^ 2', 512], // right-associative
    ['-2 ^ 2', -4], // unary minus binds looser than ^
    ['--3', 3],
    ['12.5 * 4', 50],
    ['  7 -  2 ', 5],
  ])('%s = %d', (expr, expected) => {
    expect(evaluateExpression(expr)).toBe(expected);
  });

  it.each([
    ['', 'Empty'],
    ['1 +', 'Unexpected'],
    ['(1 + 2', 'closing'],
    ['1 / 0', 'zero'],
    ['2 ^ 10000', 'finite'],
    ['abc', 'Unexpected'],
    ['1 2', 'Unexpected'],
    ['a'.repeat(201), 'too long'],
  ])('rejects %j', (expr, message) => {
    expect(() => evaluateExpression(expr)).toThrow(message);
  });

  it('never evaluates code: injection attempts are syntax errors', () => {
    expect(() => evaluateExpression('process.exit(1)')).toThrow();
    expect(() => evaluateExpression('1; globalThis.x = 1')).toThrow();
    expect(() => evaluateExpression('constructor.constructor("return 1")()')).toThrow();
    expect((globalThis as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('currentTimeIn', () => {
  it('formats the same instant differently per IANA time zone', () => {
    const now = new Date('2026-11-02T08:00:00Z');
    expect(currentTimeIn('Asia/Shanghai', now)).toContain('16:00:00');
    expect(currentTimeIn('Asia/Dubai', now)).toContain('12:00:00');
  });
  it('throws for an unknown time zone', () => {
    expect(() => currentTimeIn('Mars/Base')).toThrow();
  });
});

describe('tool execute functions', () => {
  const opts = { toolCallId: 't1', messages: [] } as never;
  it('calculate returns a result or a recoverable error object (never throws)', async () => {
    expect(await chatTools.calculate.execute!({ expression: '2 * (3 + 4)' }, opts)).toEqual({ ok: true, result: 14 });
    expect(await chatTools.calculate.execute!({ expression: '1 / 0' }, opts)).toEqual({ ok: false, error: 'Division by zero' });
  });
  it('getCurrentTime reports an unknown time zone as an error result', async () => {
    expect(await chatTools.getCurrentTime.execute!({ timeZone: 'Mars/Base' }, opts)).toEqual({
      ok: false,
      error: 'Unknown time zone: Mars/Base',
    });
  });
  it('validates tool input with the Zod schema', () => {
    const schema = chatTools.calculate.inputSchema as import('zod').ZodType;
    expect(schema.safeParse({ expression: '' }).success).toBe(false);
    expect(schema.safeParse({ expression: 'x'.repeat(201) }).success).toBe(false);
    expect(schema.safeParse({ expression: '1+1' }).success).toBe(true);
  });
});
