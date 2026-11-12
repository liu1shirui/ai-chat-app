// @vitest-environment jsdom
// 长会话（窗口化）+ 贴底：流式写入最后一条消息时保持在底部；向上翻看时不被拉回。
// jsdom 没有布局也没有 ResizeObserver：假的 800px 视口 + 假的 ResizeObserver（测试手动报告高度），
// scrollHeight = 占位 div + 已渲染消息（测得或 120px）高度之和。证明逻辑，不证明真实浏览器里的平滑度。
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '../types';
import { ChatBox } from './ChatBox';

const markdownRenders = vi.hoisted(() => ({ byContent: new Map<string, number>() }));
vi.mock('react-markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-markdown')>();
  const Real = actual.default;
  return {
    ...actual,
    default: (props: ComponentProps<typeof Real>) => {
      const key = String(props.children);
      markdownRenders.byContent.set(key, (markdownRenders.byContent.get(key) ?? 0) + 1);
      return <Real {...props} />;
    },
  };
});

const VIEWPORT = 800;
const ESTIMATE = 120;
const measured = new Map<string, number>();
const scrollTops = new WeakMap<Element, number>();

function contentHeight(el: Element): number {
  const top = el.firstElementChild as HTMLElement | null;
  const bottom = el.lastElementChild as HTMLElement | null;
  if (top?.dataset.spacer !== 'top' || bottom?.dataset.spacer !== 'bottom') return el.childElementCount * ESTIMATE;
  let rows = 0;
  for (const child of Array.from(el.children).slice(1, -1)) {
    rows += measured.get(child.getAttribute('data-message-id') ?? '') ?? ESTIMATE;
  }
  return parseFloat(top.style.height) + parseFloat(bottom.style.height) + rows;
}
const maxScroll = (el: Element) => Math.max(0, contentHeight(el) - VIEWPORT);

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
  markdownRenders.byContent.clear();
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
      scrollTops.set(this, Math.min(Math.max(0, value), maxScroll(this)));
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

const base: Message[] = Array.from({ length: 2000 }, (_, i) => ({
  id: `m${i}`,
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: `message ${i}`,
}));

function setup(messages: Message[] = base) {
  const view = render(<ChatBox messages={messages} />);
  const list = view.container.firstElementChild as HTMLElement;
  const row = (id: string) => list.querySelector(`[data-message-id="${id}"]`);
  const renderedIds = () => [...list.querySelectorAll('[data-message-id]')].map((el) => el.getAttribute('data-message-id'));
  return { ...view, list, row, renderedIds };
}

function report(changes: Array<[Element, number]>) {
  act(() => FakeResizeObserver.current!.report(changes));
}

// 一块流式数据：最后一条消息内容变长（与 pages/index.tsx 一样只替换最后一条消息对象）
function appendToLast(messages: Message[], text: string): Message[] {
  const last = messages[messages.length - 1];
  return [...messages.slice(0, -1), { ...last, content: last.content + text }];
}

describe('ChatBox long chat: stick to bottom with windowing', () => {
  it('stays at the bottom when the rows near the bottom get their real heights', () => {
    const { list, row, renderedIds } = setup();
    expect(list.scrollTop).toBe(maxScroll(list));

    // 底部附近已渲染的消息第一次测得真实高度（与 120px 估计值不同）
    report(renderedIds().map((id, k) => [row(id!)!, 90 + (k % 3) * 40] as [Element, number]));

    expect(list.scrollTop).toBe(maxScroll(list));
    expect(renderedIds().at(-1)).toBe('m1999');
  });

  it('follows a reply streaming into the last message (content and measured height grow)', () => {
    const { list, row, rerender } = setup();
    let messages = base;
    let height = ESTIMATE;

    for (let k = 0; k < 5; k++) {
      messages = appendToLast(messages, ` chunk${k}`);
      rerender(<ChatBox messages={messages} isStreaming />);
      height += 45;
      report([[row('m1999')!, height]]);

      expect(list.scrollTop).toBe(maxScroll(list));
      expect(list.textContent).toContain(`chunk${k}`);
    }
  });

  it('streaming re-renders only the last message, as before windowing', () => {
    const { rerender } = setup();
    let messages = base;
    markdownRenders.byContent.clear();

    for (let k = 0; k < 5; k++) {
      messages = appendToLast(messages, ` chunk${k}`);
      rerender(<ChatBox messages={messages} isStreaming />);
    }

    const total = [...markdownRenders.byContent.values()].reduce((a, b) => a + b, 0);
    const lastMessageRenders = [...markdownRenders.byContent.entries()]
      .filter(([content]) => content.startsWith('message 1999'))
      .reduce((n, [, count]) => n + count, 0);
    expect(lastMessageRenders).toBe(5);
    expect(total).toBe(5);
  });

  it('does not pull the user down when they scrolled up and the reply keeps growing', () => {
    const { list, row, rerender, renderedIds } = setup();
    list.scrollTop = 1000 * ESTIMATE;
    fireEvent.scroll(list);
    const before = list.scrollTop;

    let messages = base;
    for (let k = 0; k < 3; k++) {
      messages = appendToLast(messages, ` chunk${k}`);
      rerender(<ChatBox messages={messages} isStreaming />);
    }
    // 正在看的消息（m1000 附近）第一次被测量，高度与估计值相同：不产生修正
    report([[row('m1000')!, ESTIMATE]]);

    expect(list.scrollTop).toBe(before);
    expect(renderedIds()).toContain('m1000');
    expect(renderedIds()).not.toContain('m1999');
  });

  it('jumps to the bottom and shows the new message when the user sends one while scrolled up', () => {
    const { list, rerender, renderedIds } = setup();
    list.scrollTop = 0;
    fireEvent.scroll(list);

    const messages = [...base, { id: 'new', role: 'user' as const, content: 'new question' }];
    rerender(<ChatBox messages={messages} />);

    expect(list.scrollTop).toBe(maxScroll(list));
    expect(renderedIds().at(-1)).toBe('new');
  });
});
