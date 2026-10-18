import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSseResponse, type StreamPart } from './sse-response';

afterEach(() => vi.restoreAllMocks());

async function* parts(...items: StreamPart[]): AsyncGenerator<StreamPart> {
  for (const item of items) yield item;
}

describe('createSseResponse', () => {
  it('returns text/event-stream with no-cache headers', () => {
    const res = createSseResponse(parts());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toContain('no-cache');
  });

  it('emits one JSON data frame per text delta, then [DONE]', async () => {
    const res = createSseResponse(parts(
      { type: 'start' },
      { type: 'text-delta', text: '你好' },
      { type: 'text-delta', text: '\n"世界"' },
      { type: 'finish' },
    ));
    expect(await res.text()).toBe(
      'data: {"text":"你好"}\n\n' +
      'data: {"text":"\\n\\"世界\\""}\n\n' +
      'data: [DONE]\n\n',
    );
  });

  it('never forwards reasoning or other non-text parts', async () => {
    const res = createSseResponse(parts(
      { type: 'reasoning-delta', text: 'hidden chain of thought' },
      { type: 'text-delta', text: 'answer' },
      { type: 'text-delta', text: '' },
    ));
    expect(await res.text()).toBe('data: {"text":"answer"}\n\ndata: [DONE]\n\n');
  });

  it('turns a model error part into an SSE error event without leaking details, and does not send [DONE]', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = createSseResponse(parts(
      { type: 'text-delta', text: '部分' },
      { type: 'error', error: new Error('model_not_found sk-secret') },
      { type: 'text-delta', text: 'never sent' },
    ));
    const body = await res.text();
    expect(body).toBe('data: {"text":"部分"}\n\nevent: error\ndata: {"message":"AI service error"}\n\n');
    expect(body).not.toContain('sk-secret');
  });

  it('turns an exception thrown by the source into an SSE error event', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    async function* failing(): AsyncGenerator<StreamPart> {
      yield { type: 'text-delta', text: 'a' };
      throw new Error('socket hang up');
    }
    const body = await createSseResponse(failing()).text();
    expect(body).toBe('data: {"text":"a"}\n\nevent: error\ndata: {"message":"AI service error"}\n\n');
  });

  it('ends without [DONE] when the model run was aborted, and logs a warning (no longer silent)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = await createSseResponse(parts({ type: 'text-delta', text: 'a' }, { type: 'abort' })).text();
    expect(body).toBe('data: {"text":"a"}\n\n');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('aborted');
  });

  it('when the reply ends with no text, logs which part types arrived (types and counts only, never content)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = await createSseResponse(parts(
      { type: 'start' },
      { type: 'reasoning-delta', text: 'secret chain of thought' },
      { type: 'reasoning-delta', text: 'more' },
      { type: 'finish' },
    )).text();

    expect(body).toBe('data: [DONE]\n\n');
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0].map(String).join(' ');
    expect(logged).toContain('start×1');
    expect(logged).toContain('reasoning-delta×2');
    expect(logged).toContain('finish×1');
    expect(logged).not.toContain('secret chain of thought');
  });

  it('does not warn for a normal reply that contained text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await createSseResponse(parts({ type: 'text-delta', text: 'hi' }, { type: 'finish' })).text();
    expect(warn).not.toHaveBeenCalled();
  });

  it('stops pulling from the source when the client cancels the response stream', async () => {
    const returned = vi.fn();
    const source: AsyncIterable<StreamPart> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => ({ done: false, value: { type: 'text-delta', text: 'x' } as StreamPart }),
          return: async () => {
            returned();
            return { done: true, value: undefined };
          },
        };
      },
    };
    const reader = createSseResponse(source).body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(returned).toHaveBeenCalledTimes(1);
  });
});
