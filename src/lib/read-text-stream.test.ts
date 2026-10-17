import { describe, expect, it, vi } from 'vitest';
import { readTextStream } from './read-text-stream';

const enc = new TextEncoder();

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

// 一个可以手动推送数据的流，用来模拟"生成中途取消"
function controllableStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: c => { controller = c; } });
  return { stream, push: (s: string) => controller.enqueue(enc.encode(s)) };
}

describe('readTextStream – decoding', () => {
  it('reads plain chunks and reports the accumulated text after each chunk', async () => {
    const onText = vi.fn();
    const result = await readTextStream(streamOf([enc.encode('Hello'), enc.encode(', world')]), onText);
    expect(result).toEqual({ text: 'Hello, world', aborted: false });
    expect(onText.mock.calls.map(c => c[0])).toEqual(['Hello', 'Hello, world']);
  });

  it('decodes a Chinese character split across two chunks without garbling', async () => {
    const bytes = enc.encode('你好'); // 6 bytes
    const result = await readTextStream(streamOf([bytes.slice(0, 4), bytes.slice(4)]), () => {});
    expect(result.text).toBe('你好');
    expect(result.text).not.toContain('�');
  });

  it('decodes text delivered one byte at a time (CJK + 4-byte emoji)', async () => {
    const bytes = enc.encode('前端面试 🚀 加油');
    const chunks = Array.from(bytes, b => Uint8Array.of(b));
    const onText = vi.fn();
    const result = await readTextStream(streamOf(chunks), onText);
    expect(result.text).toBe('前端面试 🚀 加油');
    // no intermediate update ever showed a replacement character
    expect(onText.mock.calls.every(([t]) => !String(t).includes('�'))).toBe(true);
  });

  it('flushes at the end: a stream truncated mid-character ends with U+FFFD instead of silently dropping bytes', async () => {
    const bytes = enc.encode('好');
    const result = await readTextStream(streamOf([enc.encode('你'), bytes.slice(0, 2)]), () => {});
    expect(result.text).toBe('你�');
  });

  it('propagates a genuine stream error (not a cancellation)', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('part'));
        c.error(new Error('connection reset'));
      },
    });
    await expect(readTextStream(body, () => {})).rejects.toThrow('connection reset');
  });
});

describe('readTextStream – cancellation', () => {
  it('stops on abort, returns the partial text, and never calls onText afterwards', async () => {
    const { stream, push } = controllableStream();
    const controller = new AbortController();
    const onText = vi.fn();
    const pending = readTextStream(stream, onText, controller.signal);

    push('第一段');
    await vi.waitFor(() => expect(onText).toHaveBeenCalledWith('第一段'));

    controller.abort(); // the pending read() is released by reader.cancel()
    const result = await pending;
    expect(result).toEqual({ text: '第一段', aborted: true });

    expect(() => push('取消后才到的内容')).toThrow(); // the stream was cancelled
    expect(onText).toHaveBeenCalledTimes(1);
  });

  it('returns immediately for an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const onText = vi.fn();
    const result = await readTextStream(streamOf([enc.encode('x')]), onText, controller.signal);
    expect(result).toEqual({ text: '', aborted: true });
    expect(onText).not.toHaveBeenCalled();
  });

  it('treats an AbortError from read() (real fetch abort) as a cancellation', async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        controller.abort();
        c.error(new DOMException('The operation was aborted.', 'AbortError'));
      },
    });
    await expect(readTextStream(body, () => {}, controller.signal)).resolves.toEqual({ text: '', aborted: true });
  });
});
