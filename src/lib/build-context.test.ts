import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { CONTEXT_MAX_CHARS, CONTEXT_MAX_MESSAGES, buildContext } from './build-context';
import { MAX_MESSAGE_CHARS, validateChatBody } from './chat-validation';

let seq = 0;
const msg = (role: Message['role'], content: string): Message => ({ id: `m${seq++}`, role, content });

describe('buildContext', () => {
  it('sends just the new message when there is no history', () => {
    expect(buildContext([], '你好')).toEqual([{ role: 'user', content: '你好' }]);
  });

  it('keeps chronological order and appends the new message last, stripping extra fields', () => {
    const history = [msg('user', '我叫小刘'), msg('assistant', '你好小刘'), msg('user', '我喜欢前端'), msg('assistant', '很棒')];
    expect(buildContext(history, '我叫什么？')).toEqual([
      { role: 'user', content: '我叫小刘' },
      { role: 'assistant', content: '你好小刘' },
      { role: 'user', content: '我喜欢前端' },
      { role: 'assistant', content: '很棒' },
      { role: 'user', content: '我叫什么？' },
    ]);
  });

  it('skips system messages and empty content', () => {
    const history = [msg('system', 'secret instructions'), msg('user', 'hi'), msg('assistant', '   ')];
    expect(buildContext(history, 'next')).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'user', content: 'next' },
    ]);
  });

  it('keeps only the most recent messages when over the message limit', () => {
    const history = Array.from({ length: 10 }, (_, i) => msg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`));
    const result = buildContext(history, 'new', { maxMessages: 5 });
    expect(result.map(m => m.content)).toEqual(['m6', 'm7', 'm8', 'm9', 'new']);
  });

  it('stops at the character budget and never skips a message in the middle (context stays contiguous)', () => {
    const history = [msg('user', 'a'.repeat(50)), msg('assistant', 'b'.repeat(10)), msg('user', 'c'.repeat(10))];
    // budget 30 - new(5) = 25: takes c(10), b(10), then a(50) does not fit -> stop
    const result = buildContext(history, 'hello', { maxChars: 30 });
    // after dropping the leading assistant reply, context starts from a user turn
    expect(result).toEqual([
      { role: 'user', content: 'c'.repeat(10) },
      { role: 'user', content: 'hello' },
    ]);
  });

  it('drops a leading assistant reply left over after truncation', () => {
    const history = [msg('user', 'q1'), msg('assistant', 'a1'), msg('user', 'q2'), msg('assistant', 'a2')];
    const result = buildContext(history, 'q3', { maxMessages: 4 }); // picks a1, q2, a2
    expect(result.map(m => m.content)).toEqual(['q2', 'a2', 'q3']);
  });

  it('truncates an over-long historical reply instead of letting the server reject the request', () => {
    const history = [msg('user', 'write an essay'), msg('assistant', 'x'.repeat(MAX_MESSAGE_CHARS + 500))];
    const result = buildContext(history, 'thanks');
    expect(result[1].content).toHaveLength(MAX_MESSAGE_CHARS);
    expect(result[1].content.endsWith('…')).toBe(true);
  });

  it('never truncates the new user message (the server returns 413 instead)', () => {
    const long = 'y'.repeat(MAX_MESSAGE_CHARS + 1);
    const result = buildContext([], long);
    expect(result).toEqual([{ role: 'user', content: long }]);
    expect(validateChatBody({ messages: result })).toMatchObject({ ok: false, status: 413 });
  });

  it('a long realistic history always produces a body the server accepts', () => {
    const history = Array.from({ length: 200 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', '内容'.repeat(i % 7 === 0 ? 3000 : 150)),
    );
    const result = buildContext(history, '最后一个问题');
    expect(result.length).toBeLessThanOrEqual(CONTEXT_MAX_MESSAGES);
    expect(result.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(CONTEXT_MAX_CHARS);
    expect(result[0].role).toBe('user');
    expect(result[result.length - 1]).toEqual({ role: 'user', content: '最后一个问题' });
    expect(validateChatBody({ messages: result }).ok).toBe(true);
  });
});
