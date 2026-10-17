// @vitest-environment jsdom
// 流式渲染性能测量（只在测试中运行，不进入生产代码）。
// 测量两项：(a) 首个字符可见耗时；(b) 一次流式回复期间 ChatMessage 的渲染次数。
// 方法：把 react-markdown 换成计数组件——ChatMessage 每渲染一次就渲染一次它；被 React.memo 跳过时则不会。
// 网络模拟：50 个 SSE 分块，每 5ms 一块（快于 16ms 的动画帧），真实定时器。
// 注意：数字来自 jsdom 测试环境，不代表真实设备上的表现。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const renders = vi.hoisted(() => ({ byContent: new Map<string, number>(), total: 0 }));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    renders.total++;
    renders.byContent.set(children, (renders.byContent.get(children) ?? 0) + 1);
    return <p>{children}</p>;
  },
}));

const OLD = ['旧问题一', '旧回复一', '旧问题二', '旧回复二'];

vi.mock('@/lib/supabaseClient', () => {
  const session = { access_token: 't', user: { id: 'perf-user', email: 'p@example.com' } };
  const rows = [{
    id: 's1', user_id: 'perf-user', title: 'Perf chat', created_at: '2026-01-01',
    messages: OLD.map((content, i) => ({ id: `old-${i}`, role: i % 2 ? 'assistant' : 'user', content })),
  }];
  return {
    supabase: {
      auth: {
        getSession: async () => ({ data: { session } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signOut: async () => {},
      },
      from: () => ({
        select: () => ({ eq: () => ({ order: async () => ({ data: structuredClone(rows), error: null }) }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
    },
  };
});

const { default: Home } = await import('@/pages/index');

const CHUNKS = 50;
const INTERVAL_MS = 5;
const frame = (text: string) => `data: ${JSON.stringify({ text })}\n\n`;

beforeAll(() => {
  // 让 React 像在浏览器里一样自行调度更新（而不是要求包在 act 里）
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  Element.prototype.scrollTo = () => {};
});
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  cleanup();
});

describe('streaming render performance (measured in jsdom)', () => {
  it('measures first-visible-character latency and ChatMessage renders during one streamed reply', async () => {
    const encoder = new TextEncoder();
    let firstChunkAt = 0;
    // 在 fetch 被调用时才创建响应流：分块从"请求发出"之后才开始到达
    const makeBody = () => new ReadableStream<Uint8Array>({
      start(controller) {
        let i = 0;
        const timer = setInterval(() => {
          if (i === 0) firstChunkAt = performance.now();
          controller.enqueue(encoder.encode(frame(`字${i} `)));
          i++;
          if (i === CHUNKS) {
            clearInterval(timer);
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          }
        }, INTERVAL_MS);
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(makeBody(), { status: 200 })));

    render(<Home />);
    await screen.findByText('旧回复二');

    // (a) 首字可见：观察 DOM，第一次出现首个分块文字的时刻
    let firstVisibleAt = 0;
    const observer = new MutationObserver(() => {
      if (!firstVisibleAt && document.body.textContent?.includes('字0')) firstVisibleAt = performance.now();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    // 只统计这一次流式回复期间的渲染
    renders.byContent.clear();
    renders.total = 0;

    fireEvent.change(screen.getByPlaceholderText('输入消息...'), { target: { value: '新问题' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    const fullText = Array.from({ length: CHUNKS }, (_, i) => `字${i} `).join('');
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeTruthy(), { timeout: 5000 });
    observer.disconnect();

    const olderMessageRenders = OLD.reduce((n, content) => n + (renders.byContent.get(content) ?? 0), 0);
    const streamingMessageRenders = [...renders.byContent.entries()]
      .filter(([content]) => content.startsWith('字0'))
      .reduce((n, [, count]) => n + count, 0);

    // 输出实测结果（写入报告的数字来自这里）
    console.info(
      `[perf] chunks=${CHUNKS} interval=${INTERVAL_MS}ms | first visible char: ${(firstVisibleAt - firstChunkAt).toFixed(1)}ms | ` +
      `streaming ChatMessage renders: ${streamingMessageRenders} | older ChatMessage renders (4 messages): ${olderMessageRenders} | ` +
      `total ChatMessage renders: ${renders.total}`,
    );

    // 正确性：最终文本完整
    expect(screen.getByText(fullText.trim())).toBeTruthy();
    // 优化目标：流式期间旧消息不重渲染；正在流式的消息渲染次数明显少于分块数
    expect(olderMessageRenders).toBe(0);
    expect(streamingMessageRenders).toBeLessThan(CHUNKS);
  }, 15000);
});
