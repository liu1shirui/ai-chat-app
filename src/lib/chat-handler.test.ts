import { describe, expect, it, vi } from 'vitest';
import { createChatHandler, type StreamReply } from './chat-handler';
import { getBearerToken, type VerifyToken } from './auth';
import { createSlidingWindowLimiter } from './rate-limit';

const VALID_TOKEN = 'valid-token';
const validBody = { messages: [{ role: 'user', content: '你好' }] };

function setup(overrides: { verifyToken?: VerifyToken; streamReply?: StreamReply; limit?: number } = {}) {
  const verifyToken = vi.fn<VerifyToken>(
    overrides.verifyToken ?? (async (token) => (token === VALID_TOKEN ? { id: 'user-1' } : null)),
  );
  const streamReply = vi.fn<StreamReply>(overrides.streamReply ?? (() => new Response('streamed reply')));
  const rateLimiter = createSlidingWindowLimiter({ limit: overrides.limit ?? 10, windowMs: 60_000, now: () => 0 });
  const handler = createChatHandler({ verifyToken, rateLimiter, streamReply });
  return { handler, verifyToken, streamReply };
}

function request(body: unknown, { token = VALID_TOKEN as string | null, method = 'POST' } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return new Request('http://localhost/api/chat', {
    method,
    headers,
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}

describe('getBearerToken', () => {
  it('extracts the token from a Bearer header (case-insensitive scheme)', () => {
    const req = new Request('http://x', { headers: { Authorization: 'bearer abc.def' } });
    expect(getBearerToken(req)).toBe('abc.def');
  });

  it.each([[undefined], ['Basic abc'], ['Bearer'], ['Bearer   ']])('returns null for %s', (value) => {
    const req = new Request('http://x', { headers: value === undefined ? {} : { Authorization: value } });
    expect(getBearerToken(req)).toBeNull();
  });
});

describe('chat handler', () => {
  it('rejects non-POST methods with 405', async () => {
    const { handler, verifyToken } = setup();
    const res = await handler(request(null, { method: 'GET' }));
    expect(res.status).toBe(405);
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('returns 401 when the Authorization header is missing, without calling the model', async () => {
    const { handler, verifyToken, streamReply } = setup();
    const res = await handler(request(validBody, { token: null }));
    expect(res.status).toBe(401);
    expect(verifyToken).not.toHaveBeenCalled();
    expect(streamReply).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid or expired token', async () => {
    const { handler, streamReply } = setup();
    const res = await handler(request(validBody, { token: 'expired-token' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(streamReply).not.toHaveBeenCalled();
  });

  it('returns 503 without leaking details when the auth service fails', async () => {
    const { handler } = setup({ verifyToken: async () => { throw new Error('secret internal detail'); } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handler(request(validBody));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('secret internal detail');
  });

  it('streams the reply for an authenticated, valid request', async () => {
    const { handler, streamReply } = setup();
    const res = await handler(request(validBody));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('streamed reply');
    expect(streamReply).toHaveBeenCalledWith([{ role: 'user', content: '你好' }], expect.any(AbortSignal));
  });

  it('ignores a user id supplied in the body; identity comes only from the token', async () => {
    const { handler, verifyToken } = setup({ limit: 1 });
    await handler(request({ ...validBody, userId: 'attacker-chosen-id' }));
    // the second request is limited under the token's identity, not the body's userId
    const res = await handler(request({ ...validBody, userId: 'another-id' }));
    expect(res.status).toBe(429);
    expect(verifyToken).toHaveBeenCalledWith(VALID_TOKEN);
  });

  it('returns 429 with Retry-After once the per-user limit is exceeded', async () => {
    const { handler, streamReply } = setup({ limit: 2 });
    await handler(request(validBody));
    await handler(request(validBody));
    const res = await handler(request(validBody));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(streamReply).toHaveBeenCalledTimes(2);
  });

  it('returns 400 for malformed JSON', async () => {
    const { handler } = setup();
    const res = await handler(request('{not json'));
    expect(res.status).toBe(400);
  });

  it('returns validation errors (400 / 413) without calling the model', async () => {
    const { handler, streamReply } = setup();
    expect((await handler(request({ messages: [] }))).status).toBe(400);
    expect((await handler(request({ messages: [{ role: 'user', content: 'a'.repeat(5000) }] }))).status).toBe(413);
    expect(streamReply).not.toHaveBeenCalled();
  });

  it('returns 502 without leaking details when the model call throws', async () => {
    const { handler } = setup({ streamReply: () => { throw new Error('groq key invalid: sk-123'); } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handler(request(validBody));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('sk-123');
  });
});
