// /api/chat 路由的端到端测试（服务端）：鉴权和模型都换成测试替身，验证真实路由模块返回 SSE。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const streamText = vi.hoisted(() => vi.fn());
vi.mock('ai', () => ({ streamText }));
const createGroq = vi.hoisted(() => vi.fn((options: { apiKey?: string }) => (model: string) => ({ model, apiKey: options.apiKey })));
vi.mock('@ai-sdk/groq', () => ({ createGroq }));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  verifySupabaseToken: async (token: string) => (token === 'good' ? { id: 'user-1' } : null),
}));

const { default: handler } = await import('@/pages/api/chat');

function post(token: string | null, body: unknown = { messages: [{ role: 'user', content: '你好' }] }) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function* fullStream(...items: object[]) {
  for (const item of items) yield item;
}

beforeEach(() => {
  streamText.mockReset();
  createGroq.mockClear();
  vi.stubEnv('GROQ_API_KEY', 'test-groq-key');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/chat (route module)', () => {
  it('streams the model reply as Server-Sent Events ending with [DONE]', async () => {
    streamText.mockReturnValue({
      fullStream: fullStream({ type: 'text-delta', text: '你好' }, { type: 'text-delta', text: '！' }, { type: 'finish' }),
    });
    const res = await handler(post('good'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');
    expect(await res.text()).toBe('data: {"text":"你好"}\n\ndata: {"text":"！"}\n\ndata: [DONE]\n\n');
    // the validated messages and the request's abort signal reach the model call
    expect(streamText).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ role: 'user', content: '你好' }],
      abortSignal: expect.any(AbortSignal),
    }));
  });

  it('sends an SSE error event (not an empty 200 body) when the model fails mid-stream', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    streamText.mockReturnValue({
      fullStream: fullStream({ type: 'error', error: new Error('The model does not exist') }),
    });
    const body = await (await handler(post('good'))).text();
    expect(body).toBe('event: error\ndata: {"message":"AI service error"}\n\n');
  });

  it('passes GROQ_API_KEY explicitly to the provider (no dynamic process.env lookup inside the SDK)', async () => {
    streamText.mockReturnValue({ fullStream: fullStream({ type: 'text-delta', text: 'ok' }) });
    await (await handler(post('good'))).text();
    expect(createGroq).toHaveBeenCalledWith({ apiKey: 'test-groq-key' });
    expect(streamText).toHaveBeenCalledWith(expect.objectContaining({
      model: { model: 'openai/gpt-oss-20b', apiKey: 'test-groq-key' },
    }));
  });

  it('returns 502 with a log line (and never calls the model) when GROQ_API_KEY is missing', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await handler(post('good'));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'AI service request failed' });
    expect(streamText).not.toHaveBeenCalled();
    const logged = errorLog.mock.calls.map(args => args.map(String).join(' ')).join('\n');
    expect(logged).toContain('Model call failed');
    expect(logged).toContain('GROQ_API_KEY is not configured');
  });

  it('still rejects unauthenticated requests with 401 before calling the model', async () => {
    const res = await handler(post(null));
    expect(res.status).toBe(401);
    expect(streamText).not.toHaveBeenCalled();
  });
});
