import { describe, expect, it, vi } from 'vitest';
import { createFrameBatcher } from './frame-batcher';

function fakeFrames() {
  const callbacks = new Map<number, () => void>();
  let id = 0;
  return {
    raf: vi.fn((cb: () => void) => { callbacks.set(++id, cb); return id; }),
    caf: vi.fn((handle: number) => { callbacks.delete(handle); }),
    runFrame() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach(cb => cb());
    },
    get pending() { return callbacks.size; },
  };
}

describe('createFrameBatcher', () => {
  it('applies the first value immediately (no added latency for the first visible character)', () => {
    const frames = fakeFrames();
    const apply = vi.fn();
    createFrameBatcher<string>(apply, frames).push('a');
    expect(apply).toHaveBeenCalledWith('a');
    expect(frames.raf).not.toHaveBeenCalled();
  });

  it('coalesces later values into one apply per animation frame, using the latest value', () => {
    const frames = fakeFrames();
    const apply = vi.fn();
    const batcher = createFrameBatcher<string>(apply, frames);
    batcher.push('a');
    batcher.push('ab');
    batcher.push('abc');
    batcher.push('abcd');
    expect(apply).toHaveBeenCalledTimes(1);
    expect(frames.raf).toHaveBeenCalledTimes(1); // only one frame scheduled

    frames.runFrame();
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith('abcd');
  });

  it('flush() applies the pending value synchronously and cancels the scheduled frame (last chunk always shown)', () => {
    const frames = fakeFrames();
    const apply = vi.fn();
    const batcher = createFrameBatcher<string>(apply, frames);
    batcher.push('a');
    batcher.push('a-final');
    batcher.flush();
    expect(apply).toHaveBeenLastCalledWith('a-final');
    expect(frames.caf).toHaveBeenCalledTimes(1);
    expect(frames.pending).toBe(0);

    frames.runFrame(); // nothing left to apply
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('flush() with nothing pending does nothing', () => {
    const frames = fakeFrames();
    const apply = vi.fn();
    const batcher = createFrameBatcher<string>(apply, frames);
    batcher.push('only');
    batcher.flush();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('cancel() drops the pending value so a late frame cannot re-apply it (used before rollback)', () => {
    const frames = fakeFrames();
    const apply = vi.fn();
    const batcher = createFrameBatcher<string>(apply, frames);
    batcher.push('a');
    batcher.push('stale');
    batcher.cancel();
    frames.runFrame();
    batcher.flush();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('a');
  });

  it('schedules a new frame after the previous one ran', () => {
    const frames = fakeFrames();
    const apply = vi.fn();
    const batcher = createFrameBatcher<string>(apply, frames);
    batcher.push('1');
    batcher.push('2');
    frames.runFrame();
    batcher.push('3');
    expect(frames.raf).toHaveBeenCalledTimes(2);
    frames.runFrame();
    expect(apply.mock.calls.map(c => c[0])).toEqual(['1', '2', '3']);
  });
});
