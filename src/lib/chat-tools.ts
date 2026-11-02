// src/lib/chat-tools.ts
// 模型可调用的工具（Function Calling）。模型根据对话决定是否调用，服务端执行后把结果交还给模型，
// 由模型据此组织最终回答。
// 安全原则：工具只做纯计算 / 读取时间，不访问网络、文件或用户数据；入参用 Zod 校验，模型给出的任何参数都当作不可信输入。
import { tool } from 'ai';
import { z } from 'zod';

const MAX_EXPRESSION_LENGTH = 200;

/**
 * 计算四则运算表达式（支持 + - * / ^ 和括号、小数、一元负号）。
 * 手写递归下降解析器，不使用 eval / new Function：模型生成的字符串不能被当作代码执行。
 */
export function evaluateExpression(input: string): number {
  if (input.length > MAX_EXPRESSION_LENGTH) throw new Error('Expression too long');
  // 数字之间的空白不能直接删掉："1 2" 会被悄悄当成 12
  if (/[\d.]\s+[\d.]/.test(input)) throw new Error('Unexpected number after a number');
  const src = input.replace(/\s+/g, '');
  if (!src) throw new Error('Empty expression');
  let pos = 0;

  const peek = () => src[pos];
  const eat = (ch: string) => (src[pos] === ch ? (pos++, true) : false);

  function parseNumber(): number {
    const m = /^\d+(\.\d+)?/.exec(src.slice(pos));
    if (!m) throw new Error(`Unexpected "${peek() ?? 'end'}" at position ${pos}`);
    pos += m[0].length;
    return Number(m[0]);
  }
  function parsePrimary(): number {
    if (eat('(')) {
      const v = parseAddSub();
      if (!eat(')')) throw new Error('Missing closing parenthesis');
      return v;
    }
    return parseNumber();
  }
  // 一元负号优先级低于 ^：-2^2 = -(2^2) = -4
  function parseUnary(): number {
    if (eat('-')) return -parseUnary();
    if (eat('+')) return parseUnary();
    return parsePower();
  }
  // ^ 右结合：2^3^2 = 2^(3^2)
  function parsePower(): number {
    const base = parsePrimary();
    return eat('^') ? Math.pow(base, parseUnary()) : base;
  }
  function parseMulDiv(): number {
    let v = parseUnary();
    for (;;) {
      if (eat('*')) v *= parseUnary();
      else if (eat('/')) {
        const d = parseUnary();
        if (d === 0) throw new Error('Division by zero');
        v /= d;
      } else return v;
    }
  }
  function parseAddSub(): number {
    let v = parseMulDiv();
    for (;;) {
      if (eat('+')) v += parseMulDiv();
      else if (eat('-')) v -= parseMulDiv();
      else return v;
    }
  }

  const result = parseAddSub();
  if (pos < src.length) throw new Error(`Unexpected "${peek()}" at position ${pos}`);
  if (!Number.isFinite(result)) throw new Error('Result is not a finite number');
  return result;
}

/** 当前时间，按 IANA 时区格式化（如 Asia/Shanghai）。时区名无效时抛错，由模型收到错误后向用户说明。 */
export function currentTimeIn(timeZone: string, now: Date = new Date()): string {
  const formatted = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    dateStyle: 'full',
    timeStyle: 'medium',
    hour12: false,
  }).format(now);
  return `${formatted}（${timeZone}）`;
}

export const chatTools = {
  calculate: tool({
    description: '计算数学表达式，支持 + - * / ^ 和括号。需要精确算术时调用，不要心算。',
    inputSchema: z.object({
      expression: z.string().min(1).max(MAX_EXPRESSION_LENGTH).describe('例如 "(12.5 + 7.5) * 3"'),
    }),
    execute: async ({ expression }) => {
      try {
        return { ok: true as const, result: evaluateExpression(expression) };
      } catch (error) {
        // 把错误作为工具结果返回给模型，让它自己决定如何向用户解释，而不是让整个请求失败
        return { ok: false as const, error: error instanceof Error ? error.message : 'Invalid expression' };
      }
    },
  }),
  getCurrentTime: tool({
    description: '获取当前日期和时间。用户询问现在几点、今天几号或不同城市的时间时调用。',
    inputSchema: z.object({
      timeZone: z.string().default('Asia/Shanghai').describe('IANA 时区名，如 Asia/Shanghai、Asia/Dubai、America/New_York'),
    }),
    execute: async ({ timeZone }) => {
      try {
        return { ok: true as const, time: currentTimeIn(timeZone) };
      } catch {
        return { ok: false as const, error: `Unknown time zone: ${timeZone}` };
      }
    },
  }),
};

/** 单次请求里模型最多经历的步数（调用工具 → 拿到结果 → 回答），防止模型反复调用工具造成循环和费用失控。 */
export const MAX_TOOL_STEPS = 4;
