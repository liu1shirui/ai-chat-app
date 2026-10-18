import { describe, expect, it, vi } from 'vitest';
import { SseErrorEvent, readSseStream } from './read-sse-stream';

const enc = new TextEncoder();
const frame = (text: string) => `data: ${JSON.stringify({ text })}\n\n`;
const DONE = 'data: [DONE]\n\n';

function streamOfBytes(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(chunk);
      c.close();
    },
  });
}
const streamOf = (chunks: string[]) => streamOfBytes(chunks.map(s => enc.encode(s)));

function controllableStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: c => { controller = c; } });
  return { stream, push: (s: string) => controller.enqueue(enc.encode(s)) };
}

describe('readSseStream', () => {
  it('accumulates text frames and reports the running text; [DONE] completes the stream', async () => {
    const onText = vi.fn();
    const result = await readSseStream(streamOf([frame('你好'), frame('，世界'), DONE]), onText);
    expect(result).toEqual({ text: '你好，世界', aborted: false, completed: true });
    expect(onText.mock.calls.map(c => c[0])).toEqual(['你好', '你好，世界']);
  });

  it('handles multiple frames in one chunk', async () => {
    const result = await readSseStream(streamOf([frame('a') + frame('b') + frame('c') + DONE]), () => {});
    expect(result.text).toBe('abc');
  });

  it('handles a frame split mid-line across chunks', async () => {
    const whole = frame('前端') + DONE;
    const result = await readSseStream(streamOf([whole.slice(0, 7), whole.slice(7, 15), whole.slice(15)]), () => {});
    expect(result).toEqual({ text: '前端', aborted: false, completed: true });
  });

  it('handles a multi-byte Chinese character split across chunks (byte level)', async () => {
    const bytes = enc.encode(frame('前端工程师') + DONE);
    // split every 5 bytes: guarantees several 3-byte characters are cut in half
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 5) chunks.push(bytes.slice(i, i + 5));
    const onText = vi.fn();
    const result = await readSseStream(streamOfBytes(chunks), onText);
    expect(result.text).toBe('前端工程师');
    expect(onText.mock.calls.every(([t]) => !String(t).includes('�'))).toBe(true);
  });

  it('preserves newlines and quotes inside text (JSON-encoded payload)', async () => {
    const result = await readSseStream(streamOf([frame('第一行\n第二行 "引号"'), DONE]), () => {});
    expect(result.text).toBe('第一行\n第二行 "引号"');
  });

  it('ignores comment lines', async () => {
    const result = await readSseStream(streamOf([': keep-alive\n\n', frame('x'), ': ping\n', '\n', DONE]), () => {});
    expect(result.text).toBe('x');
  });

  it('stops at [DONE] and ignores anything after it', async () => {
    const onText = vi.fn();
    const result = await readSseStream(streamOf([frame('a') + DONE + frame('ignored')]), onText);
    expect(result).toEqual({ text: 'a', aborted: false, completed: true });
    expect(onText).toHaveBeenCalledTimes(1);
  });

  it('reports completed: false when the stream ends without [DONE] (truncated)', async () => {
    const result = await readSseStream(streamOf([frame('半截')]), () => {});
    expect(result).toEqual({ text: '半截', aborted: false, completed: false });
  });

  it('throws SseErrorEvent on a mid-stream error event, after delivering earlier text', async () => {
    const onText = vi.fn();
    const body = streamOf([frame('部分'), 'event: error\ndata: {"message":"AI service error"}\n\n', frame('never')]);
    const error = await readSseStream(body, onText).catch(e => e);
    expect(error).toBeInstanceOf(SseErrorEvent);
    expect(error.message).toBe('AI service error');
    expect(onText.mock.calls.map(c => c[0])).toEqual(['部分']);
  });

  it('throws on a malformed data payload instead of rendering garbage', async () => {
    await expect(readSseStream(streamOf(['data: not-json\n\n', DONE]), () => {})).rejects.toThrow();
  });

  it('abort: stops reading, returns the partial text, never calls onText afterwards', async () => {
    const { stream, push } = controllableStream();
    const controller = new AbortController();
    const onText = vi.fn();
    const pending = readSseStream(stream, onText, controller.signal);

    push(frame('第一段'));
    await vi.waitFor(() => expect(onText).toHaveBeenCalledWith('第一段'));
    controller.abort();

    expect(await pending).toEqual({ text: '第一段', aborted: true, completed: false });
    expect(() => push(frame('取消后'))).toThrow(); // stream was cancelled
    expect(onText).toHaveBeenCalledTimes(1);
  });

  it('abort before anything arrives returns immediately', async () => {
    const controller = new AbortController();
    controller.abort();
    const onText = vi.fn();
    expect(await readSseStream(streamOf([frame('x'), DONE]), onText, controller.signal)).toEqual({
      text: '',
      aborted: true,
      completed: false,
    });
    expect(onText).not.toHaveBeenCalled();
  });

  it('propagates a genuine network error (not an abort)', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(frame('x')));
        c.error(new Error('connection reset'));
      },
    });
    await expect(readSseStream(body, () => {})).rejects.toThrow('connection reset');
  });
});
