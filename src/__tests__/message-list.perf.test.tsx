// @vitest-environment jsdom
// 长会话渲染基准（只在测试中运行，不进入生产代码）。
// 对 50 / 500 / 2000 条消息分别测量：
//   (1) 首次挂载：耗时、消息列表内的 DOM 节点数、ChatMessage 渲染次数
//   (2) 流式写入最后一条消息 20 次（与 pages/index.tsx 相同：只替换最后一条消息对象）：
//       每次更新的平均耗时、ChatMessage 渲染次数、更新后的 DOM 节点数
// 计数方法：react-markdown 换成"计数 + 原样渲染"的包装组件——ChatMessage 每渲染一次就渲染它一次，
// 被 React.memo 跳过时则不会；DOM 仍是真实 Markdown 输出。
// 注意：所有数字来自 jsdom（没有布局和绘制），耗时只能做同一台机器上的前后对比，不代表真实浏览器。
// 模拟视口：jsdom 没有布局，这里给滚动容器一个固定的 800px 视口；scrollHeight 按占位 div 高度
// + 已渲染消息数 × 120px（窗口化的估计高度）计算，scrollTop 像浏览器一样被限制在有效范围内。
// 未窗口化时视口大小不影响渲染了哪些消息。
// 运行：npx vitest run src/__tests__/message-list.perf.test.tsx
import { cleanup, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Message } from '@/types';

const counter = vi.hoisted(() => ({ renders: 0 }));

vi.mock('react-markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-markdown')>();
  const Real = actual.default;
  return {
    ...actual,
    default: (props: ComponentProps<typeof Real>) => {
      counter.renders++;
      return <Real {...props} />;
    },
  };
});

const { ChatBox } = await import('@/components/ChatBox');

export const SIZES = [50, 500, 2000];
const STREAM_UPDATES = 20;

// 确定性的消息内容：用户短问题 + 带列表、代码块和加粗的 AI 回复（接近真实回复的 Markdown 结构）
export function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) =>
    i % 2 === 0
      ? { id: `m${i}`, role: 'user' as const, content: `Question ${i}: how do I handle this case?` }
      : {
          id: `m${i}`,
          role: 'assistant' as const,
          content: `Answer ${i}\n\n- first point\n- second point\n\n\`\`\`js\nconst value = ${i};\n\`\`\`\n\nSome **bold** text.`,
        },
  );
}

function listNodeCount(container: HTMLElement) {
  return container.querySelectorAll('*').length;
}

const VIEWPORT = 800;
const ROW_ESTIMATE = 120;
const scrollTops = new WeakMap<Element, number>();
// 只读第一个/最后一个子元素和子元素个数（O(1)），避免模拟本身的开销随 DOM 大小增长、影响前后对比
function simulatedContentHeight(el: Element): number {
  const top = el.firstElementChild as HTMLElement | null;
  const bottom = el.lastElementChild as HTMLElement | null;
  if (top?.dataset.spacer !== 'top' || bottom?.dataset.spacer !== 'bottom') {
    return el.childElementCount * ROW_ESTIMATE;
  }
  const rows = el.childElementCount - 2;
  return parseFloat(top.style.height) + parseFloat(bottom.style.height) + rows * ROW_ESTIMATE;
}

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => VIEWPORT });
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get() { return simulatedContentHeight(this); },
  });
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get() { return scrollTops.get(this) ?? 0; },
    set(value: number) {
      const max = Math.max(0, simulatedContentHeight(this) - VIEWPORT);
      scrollTops.set(this, Math.min(Math.max(0, value), max));
    },
  });
});
afterAll(() => cleanup());

describe('long conversation rendering (measured in jsdom)', () => {
  const rows: string[] = [];

  afterAll(() => {
    console.info(
      ['[perf:message-list] jsdom, simulated ' + VIEWPORT + 'px viewport, real react-markdown, alternating user/assistant mix, ' +
        STREAM_UPDATES + ' streamed updates to the last message',
        'messages | mount ms | DOM nodes | mount renders | ms/update | renders/update | DOM nodes after',
        ...rows].join('\n'),
    );
  });

  for (const size of SIZES) {
    it(`${size} messages`, () => {
      let messages = makeMessages(size);

      counter.renders = 0;
      const mountStart = performance.now();
      const { container, rerender } = render(<ChatBox messages={messages} />);
      const mountMs = performance.now() - mountStart;
      const mountRenders = counter.renders;
      const mountNodes = listNodeCount(container);

      // 流式：每次只替换最后一条消息对象，其余引用不变（与 pages/index.tsx 的更新方式一致）
      counter.renders = 0;
      const streamStart = performance.now();
      for (let k = 0; k < STREAM_UPDATES; k++) {
        const last = messages[messages.length - 1];
        messages = [...messages.slice(0, -1), { ...last, content: `${last.content} chunk${k}` }];
        rerender(<ChatBox messages={messages} />);
      }
      const msPerUpdate = (performance.now() - streamStart) / STREAM_UPDATES;
      const rendersPerUpdate = counter.renders / STREAM_UPDATES;
      const nodesAfter = listNodeCount(container);

      rows.push(
        [size, mountMs.toFixed(0), mountNodes, mountRenders, msPerUpdate.toFixed(1), rendersPerUpdate, nodesAfter].join(' | '),
      );

      // 正确性：最后一块已写入（最后一条消息在渲染区间内）；
      // 不超过 100 条时每条消息挂载时各渲染一次，超过时只渲染窗口内的消息
      expect(container.textContent).toContain(`chunk${STREAM_UPDATES - 1}`);
      if (size <= 100) expect(mountRenders).toBe(size);
      else expect(mountRenders).toBeLessThan(size);
    }, 120_000);
  }
});
