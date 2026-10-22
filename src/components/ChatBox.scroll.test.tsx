// @vitest-environment jsdom
// "贴底"自动滚动：只有在底部附近（80px 内）时新内容才会把列表滚到底。
// jsdom 没有布局：这里给元素一个假的视口高度（500px）和可控的内容高度，
// scrollTop 像浏览器一样被限制在 [0, scrollHeight - clientHeight]。
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '../types';
import { ChatBox } from './ChatBox';

const VIEWPORT = 500;
const layout = { contentHeight: 2000 };
const scrollTops = new WeakMap<Element, number>();
const maxScroll = () => Math.max(0, layout.contentHeight - VIEWPORT);

const saved = {
  scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop'),
  scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight'),
  clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight'),
  scrollTo: Element.prototype.scrollTo,
};

beforeEach(() => {
  layout.contentHeight = 2000;
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get: () => layout.contentHeight,
  });
  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get: () => VIEWPORT,
  });
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get() { return scrollTops.get(this) ?? 0; },
    set(value: number) { scrollTops.set(this, Math.min(Math.max(0, value), maxScroll())); },
  });
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  for (const key of ['scrollTop', 'scrollHeight', 'clientHeight'] as const) {
    if (saved[key]) Object.defineProperty(Element.prototype, key, saved[key]);
    else delete (Element.prototype as unknown as Record<string, unknown>)[key];
  }
  Element.prototype.scrollTo = saved.scrollTo;
});

const msg = (id: string, role: Message['role'], content: string): Message => ({ id, role, content });
const chat = [msg('a1', 'user', 'hello'), msg('a2', 'assistant', 'hi there')];

function setup(messages: Message[] = chat) {
  const view = render(<ChatBox messages={messages} />);
  const list = view.container.firstElementChild as HTMLElement;
  return { ...view, list };
}

// 模拟一块流式数据：最后一条 AI 回复变长，内容高度增加
function stream(messages: Message[], extraText: string, extraHeight: number) {
  layout.contentHeight += extraHeight;
  const last = messages[messages.length - 1];
  return [...messages.slice(0, -1), { ...last, content: last.content + extraText }];
}

function userScrollsTo(list: HTMLElement, top: number) {
  list.scrollTop = top;
  fireEvent.scroll(list);
}

describe('ChatBox stick-to-bottom scrolling', () => {
  it('starts at the bottom', () => {
    const { list } = setup();
    expect(list.scrollTop).toBe(maxScroll());
  });

  it('follows streamed text while pinned to the bottom', () => {
    const { list, rerender } = setup();
    let messages = chat;
    for (let i = 0; i < 3; i++) {
      messages = stream(messages, ` more${i}`, 40);
      rerender(<ChatBox messages={messages} />);
      expect(list.scrollTop).toBe(maxScroll());
    }
  });

  it('does not pull the user down after they scroll up to read', () => {
    const { list, rerender } = setup();
    userScrollsTo(list, 200);

    const messages = stream(chat, ' more', 300);
    rerender(<ChatBox messages={messages} />);

    expect(list.scrollTop).toBe(200);
  });

  it('counts 80px from the bottom as pinned (inclusive)', () => {
    const { list, rerender } = setup();
    userScrollsTo(list, maxScroll() - 80);

    rerender(<ChatBox messages={stream(chat, ' more', 100)} />);

    expect(list.scrollTop).toBe(maxScroll());
  });

  it('does not count 81px from the bottom as pinned', () => {
    const { list, rerender } = setup();
    const position = maxScroll() - 81;
    userScrollsTo(list, position);

    rerender(<ChatBox messages={stream(chat, ' more', 100)} />);

    expect(list.scrollTop).toBe(position);
  });

  it('pins again when the user scrolls back near the bottom', () => {
    const { list, rerender } = setup();
    userScrollsTo(list, 100);
    let messages = stream(chat, ' a', 50);
    rerender(<ChatBox messages={messages} />);
    expect(list.scrollTop).toBe(100);

    userScrollsTo(list, maxScroll() - 10);
    messages = stream(messages, ' b', 50);
    rerender(<ChatBox messages={messages} />);
    expect(list.scrollTop).toBe(maxScroll());
  });

  it('jumps to the bottom when the user sends a new message, even if scrolled up', () => {
    const { list, rerender } = setup();
    userScrollsTo(list, 0);

    layout.contentHeight += 60;
    rerender(<ChatBox messages={[...chat, msg('a3', 'user', 'next question')]} />);

    expect(list.scrollTop).toBe(maxScroll());
  });

  it('jumps to the bottom when switching to another chat', () => {
    const { list, rerender } = setup();
    userScrollsTo(list, 0);

    layout.contentHeight = 3000;
    rerender(<ChatBox messages={[msg('b1', 'user', 'other chat'), msg('b2', 'assistant', 'reply')]} />);

    expect(list.scrollTop).toBe(maxScroll());
  });

  it('scrolls instantly instead of starting a smooth scroll on every update', () => {
    const { rerender } = setup();
    rerender(<ChatBox messages={stream(chat, ' more', 40)} />);

    expect(Element.prototype.scrollTo).not.toHaveBeenCalled();
  });
});
