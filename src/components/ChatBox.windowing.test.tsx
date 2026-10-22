// @vitest-environment jsdom
// 窗口化渲染（超过 100 条消息时只渲染视口附近的消息）。
// jsdom 没有布局：这里给滚动容器一个假的 800px 视口；scrollHeight 按占位 div 的高度 +
// 已渲染消息数 × 120px（与估计高度一致）计算；scrollTop 像浏览器一样被限制在有效范围内。
// 这证明"渲染哪些消息、占位多高"的逻辑，不证明真实浏览器里的滚动是否平滑。
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '../types';
import { ChatBox, VIRTUALIZE_THRESHOLD } from './ChatBox';

const VIEWPORT = 800;
const ROW = 120;

class FakeUtterance {
  lang = '';
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}
const synth = { speak: vi.fn(), cancel: vi.fn() };

const scrollTops = new WeakMap<Element, number>();
function contentHeight(el: Element): number {
  const top = el.querySelector<HTMLElement>(':scope > [data-spacer="top"]');
  const bottom = el.querySelector<HTMLElement>(':scope > [data-spacer="bottom"]');
  const rows = el.querySelectorAll(':scope > [data-message-id]').length;
  if (!top || !bottom) return el.children.length * ROW;
  return parseFloat(top.style.height) + parseFloat(bottom.style.height) + rows * ROW;
}

const saved = {
  scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop'),
  scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight'),
  clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight'),
};

beforeEach(() => {
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
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
  vi.unstubAllGlobals();
  for (const key of ['scrollTop', 'scrollHeight', 'clientHeight'] as const) {
    if (saved[key]) Object.defineProperty(Element.prototype, key, saved[key]);
    else delete (Element.prototype as unknown as Record<string, unknown>)[key];
  }
});

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `message ${i}`,
  }));
}

function setup(count: number) {
  const view = render(<ChatBox messages={makeMessages(count)} />);
  const list = view.container.firstElementChild as HTMLElement;
  return { ...view, list };
}

const renderedIds = (list: HTMLElement) =>
  [...list.querySelectorAll('[data-message-id]')].map((el) => el.getAttribute('data-message-id'));
const spacer = (list: HTMLElement, which: 'top' | 'bottom') =>
  parseFloat(list.querySelector<HTMLElement>(`[data-spacer="${which}"]`)!.style.height);

function userScrollsTo(list: HTMLElement, top: number) {
  list.scrollTop = top;
  fireEvent.scroll(list);
}

describe('ChatBox windowed rendering', () => {
  it('renders every message, unwrapped and without spacers, at the threshold (100)', () => {
    expect(VIRTUALIZE_THRESHOLD).toBe(100);
    const { list } = setup(100);
    expect(screen.getAllByText(/^message \d+$/)).toHaveLength(100);
    expect(list.querySelector('[data-spacer]')).toBeNull();
    expect(list.querySelector('[data-message-id]')).toBeNull();
  });

  it('renders only a window of messages above the threshold (101)', () => {
    const { list } = setup(101);
    const rendered = renderedIds(list).length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(30);
    expect(screen.getAllByText(/^message \d+$/)).toHaveLength(rendered);
  });

  it('keeps the full scroll height with spacers (estimated 120px per message)', () => {
    const { list } = setup(2000);
    const rows = renderedIds(list).length;
    expect(spacer(list, 'top') + spacer(list, 'bottom') + rows * ROW).toBe(2000 * ROW);
  });

  it('opens a long chat at the bottom with the last message rendered', () => {
    const { list } = setup(2000);

    expect(list.scrollTop).toBe(2000 * ROW - VIEWPORT);
    const ids = renderedIds(list);
    expect(ids[ids.length - 1]).toBe('m1999');
    expect(spacer(list, 'bottom')).toBe(0);
  });

  it('renders the messages around the scroll position', () => {
    const { list } = setup(2000);
    userScrollsTo(list, 1000 * ROW);

    const ids = renderedIds(list);
    expect(ids).toContain('m1000');
    expect(ids).toContain('m1005');
    expect(ids).not.toContain('m0');
    expect(ids).not.toContain('m1999');
    expect(spacer(list, 'top')).toBeGreaterThan(0);
    expect(spacer(list, 'bottom')).toBeGreaterThan(0);
  });

  it('renders the first messages after scrolling to the top', () => {
    const { list } = setup(2000);
    userScrollsTo(list, 0);

    expect(renderedIds(list)[0]).toBe('m0');
    expect(spacer(list, 'top')).toBe(0);
  });

  it('read-aloud still works on a rendered message in a long chat', () => {
    const { list } = setup(2000);
    userScrollsTo(list, 1000 * ROW);

    const reply = list.querySelector('[data-message-id="m1001"]')!;
    fireEvent.click(reply.querySelector('button[aria-label="朗读"]')!);

    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(synth.speak.mock.calls[0][0].text).toBe('message 1001');
  });
});
