import { describe, expect, it } from 'vitest';
import { GENERIC_ERROR_MESSAGE, messageForStatus } from './chat-errors';

describe('messageForStatus', () => {
  it.each([
    [400, '请求内容无效'],
    [401, '登录已失效'],
    [413, '过长'],
    [502, 'AI 服务暂时不可用'],
    [503, '认证服务暂时不可用'],
  ])('maps %i to a specific message', (status, fragment) => {
    expect(messageForStatus(status, null)).toContain(fragment);
  });

  it('includes the Retry-After seconds for 429', () => {
    expect(messageForStatus(429, '30')).toBe('请求太频繁，请 30 秒后再试。');
  });

  it.each([[null], ['abc'], ['0'], ['-5']])('falls back to a generic 429 message for Retry-After=%s', (value) => {
    expect(messageForStatus(429, value)).toBe('请求太频繁，请稍后再试。');
  });

  it('uses a generic message for unexpected statuses like 500', () => {
    expect(messageForStatus(500, null)).toBe(GENERIC_ERROR_MESSAGE);
    expect(messageForStatus(418, null)).toBe(GENERIC_ERROR_MESSAGE);
  });
});
