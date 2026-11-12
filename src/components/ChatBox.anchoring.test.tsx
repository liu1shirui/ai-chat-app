// @vitest-environment jsdom
// 长会话（窗口化）里，视口上方的消息高度变化时修正 scrollTop，正在看的内容不跳动。
// jsdom 没有布局也没有 ResizeObserver：这里用假的 800px 视口和假的 ResizeObserver，
// 测试手动"报告"某条消息的新高度；scrollHeight = 占位 div + 已渲染消息的（测得或 120px）高度之和。
// 这证明修正的计算和时机，不证明真实浏览器里没有视觉跳动。
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Message } from '../types';
import { ChatBox } from './ChatBox';

const VIEWPORT = 800;
const ESTIMATE = 120;
const measured = new Map<string, number>();
const scrollTops = new WeakMap<Element, number>();

function rowHeight(el: Element) {
  return measured.get(el.getAttribute('data-message-id') ?? '') ?? ESTIMATE;
}
function contentHeight(el: Element): number {
  const top = el.firstElementChild as HTMLElement | null;
  const bottom = el.lastElementChild as HTMLElement | null;
  if (top?.dataset.spacer !== 'top' || bottom?.dataset.spacer !== 'bottom') return el.childElementCount * ESTIMATE;
  let rows = 0;
  for (const child of Array.from(el.children).slice(1, -1)) rows += rowHeight(child);
  return parseFloat(top.style.height) + parseFloat(bottom.style.height) + rows;
}

class FakeResizeObserver {
  static current: FakeResizeObserver | null = null;
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.current = this;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  report(changes: Array<[Element, number]>) {
    const entries = changes.map(([target, height]) => {
      measured.set(target.getAttribute('data-message-id')!, height);
      return { target, borderBoxSize: [{ blockSize: height, inlineSize: 0 }], contentRect: { height } };
    });
    this.callback(entries as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
  }
}

const saved = {
  scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop'),
  scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight'),
  clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight'),
};
const originalRO = globalThis.ResizeObserver;

beforeEach(() => {
  measured.clear();
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => VIEWPORT });
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get() { return contentHeight(this); },
  });
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get() { return scrollTops.get(this) ?? 0; },
    set(value: number) {
      const max = Math.max(0, contentHeight(this) - VIEWPORT);
      scrollTops.set(this, Math.min(Math.max(0, value), max));
    },
  });
});

afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = originalRO;
  for (const key of ['scrollTop', 'scrollHeight', 'clientHeight'] as const) {
    if (saved[key]) Object.defineProperty(Element.prototype, key, saved[key]);
    else delete (Element.prototype as unknown as Record<string, unknown>)[key];
  }
});

const messages: Message[] = Array.from({ length: 2000 }, (_, i) => ({
  id: `m${i}`,
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: `message ${i}`,
}));

function setupScrolledToMiddle() {
  const view = render(<ChatBox messages={messages} />);
  const list = view.container.firstElementChild as HTMLElement;
  // 用户向上翻到第 1000 条（不再贴底）
  list.scrollTop = 1000 * ESTIMATE;
  fireEvent.scroll(list);
  const row = (id: string) => list.querySelector(`[data-message-id="${id}"]`)!;
  return { list, row };
}

function report(changes: Array<[Element, number]>) {
  act(() => FakeResizeObserver.current!.report(changes));
}

describe('ChatBox scroll correction when off-screen messages change height', () => {
  it('a message above the viewport grows: scrollTop moves down by the same amount', () => {
    const { list, row } = setupScrolledToMiddle();
    const before = list.scrollTop;

    report([[row('m996'), ESTIMATE + 50]]);

    expect(list.scrollTop).toBe(before + 50);
  });

  it('a message above the viewport shrinks: scrollTop moves up by the same amount', () => {
    const { list, row } = setupScrolledToMiddle();
    const before = list.scrollTop;

    report([[row('m995'), ESTIMATE - 40]]);

    expect(list.scrollTop).toBe(before - 40);
  });

  it('adds up several changes reported together', () => {
    const { list, row } = setupScrolledToMiddle();
    const before = list.scrollTop;

    report([[row('m995'), ESTIMATE + 30], [row('m997'), ESTIMATE - 10]]);

    expect(list.scrollTop).toBe(before + 20);
  });

  it('a message in view changes height: no correction (content below it moves, as normal)', () => {
    const { list, row } = setupScrolledToMiddle();
    const before = list.scrollTop;

    report([[row('m1002'), ESTIMATE + 50]]);

    expect(list.scrollTop).toBe(before);
  });

  it('a message cut by the top edge (partly visible) changes height: no correction', () => {
    const { list, row } = setupScrolledToMiddle();
    // m1000 starts at 120000; scroll 60px into it, so it is half visible at the top
    list.scrollTop = 1000 * ESTIMATE + 60;
    fireEvent.scroll(list);
    const before = list.scrollTop;

    report([[row('m1000'), ESTIMATE + 50]]);

    expect(list.scrollTop).toBe(before);
  });

  it('a message below the viewport changes height: no correction', () => {
    const { list, row } = setupScrolledToMiddle();
    const before = list.scrollTop;

    report([[row('m1010'), ESTIMATE + 50]]);

    expect(list.scrollTop).toBe(before);
  });

  it('the message at the top of the view keeps its on-screen position', () => {
    const { list, row } = setupScrolledToMiddle();
    const topOf = (id: string) => {
      // 内容中的位置 = 占位高度 + 之前已渲染消息的高度
      let offset = parseFloat((list.firstElementChild as HTMLElement).style.height);
      for (const child of Array.from(list.children).slice(1, -1)) {
        if (child.getAttribute('data-message-id') === id) break;
        offset += rowHeight(child);
      }
      return offset - list.scrollTop;
    };
    const before = topOf('m1000');

    report([[row('m995'), ESTIMATE + 70], [row('m998'), ESTIMATE + 15]]);

    expect(topOf('m1000')).toBe(before);
  });
});
