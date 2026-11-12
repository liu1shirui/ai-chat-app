// @vitest-environment jsdom
// jsdom 没有 ResizeObserver：这里用一个假的 ResizeObserver，测试手动"报告"元素的新高度。
// 这验证的是接线（observe / 缓存 / 回调 / 重渲染 / unobserve），不验证真实布局测量。
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMeasuredHeights, type HeightChange } from './useMeasuredHeights';

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed = new Set<Element>();
  observe = vi.fn((el: Element) => { this.observed.add(el); });
  unobserve = vi.fn((el: Element) => { this.observed.delete(el); });
  disconnect = vi.fn(() => { this.observed.clear(); });
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  report(el: Element, height: number) {
    const entry = { target: el, borderBoxSize: [{ blockSize: height, inlineSize: 0 }], contentRect: { height } };
    this.callback([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

const original = globalThis.ResizeObserver;
beforeEach(() => {
  FakeResizeObserver.instances = [];
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = original;
});

let renders = 0;
function List({ ids, onResize }: { ids: string[]; onResize?: (changes: HeightChange[]) => void }) {
  renders++;
  const { getHeight, measureRef } = useMeasuredHeights(100, onResize);
  return (
    <div>
      {ids.map((id) => (
        <div key={id} ref={measureRef(id)} data-testid={id}>
          {id}:{getHeight(id)}
        </div>
      ))}
    </div>
  );
}

const observer = () => FakeResizeObserver.instances[0];

describe('useMeasuredHeights', () => {
  it('uses the estimate until a message is measured', () => {
    render(<List ids={['a', 'b']} />);
    expect(screen.getByTestId('a').textContent).toBe('a:100');
  });

  it('observes each rendered message once with one shared observer', () => {
    const { rerender } = render(<List ids={['a', 'b']} />);
    rerender(<List ids={['a', 'b']} />);
    expect(FakeResizeObserver.instances).toHaveLength(1);
    expect(observer().observe).toHaveBeenCalledTimes(2);
  });

  it('stores the measured height, reports the change and re-renders', () => {
    const onResize = vi.fn();
    render(<List ids={['a', 'b']} onResize={onResize} />);

    act(() => observer().report(screen.getByTestId('a'), 180));

    expect(screen.getByTestId('a').textContent).toBe('a:180');
    expect(onResize).toHaveBeenCalledWith([{ id: 'a', delta: 80 }]);
  });

  it('does not re-render or report when the height is unchanged', () => {
    const onResize = vi.fn();
    render(<List ids={['a']} onResize={onResize} />);
    act(() => observer().report(screen.getByTestId('a'), 180));
    const rendersBefore = renders;

    act(() => observer().report(screen.getByTestId('a'), 180));

    expect(renders).toBe(rendersBefore);
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it('keeps the height of a message that was unmounted and comes back', () => {
    const { rerender } = render(<List ids={['a', 'b']} />);
    act(() => observer().report(screen.getByTestId('a'), 180));

    rerender(<List ids={['b']} />);
    rerender(<List ids={['a', 'b']} />);

    expect(screen.getByTestId('a').textContent).toBe('a:180');
  });

  it('stops observing a message when it unmounts, and disconnects on unmount', () => {
    const { rerender, unmount } = render(<List ids={['a', 'b']} />);
    const a = screen.getByTestId('a');

    rerender(<List ids={['b']} />);
    expect(observer().unobserve).toHaveBeenCalledWith(a);

    unmount();
    expect(observer().disconnect).toHaveBeenCalled();
  });

  it('works without ResizeObserver (estimates only)', () => {
    // @ts-expect-error simulate an environment without ResizeObserver
    globalThis.ResizeObserver = undefined;
    render(<List ids={['a']} />);
    expect(screen.getByTestId('a').textContent).toBe('a:100');
  });
});
