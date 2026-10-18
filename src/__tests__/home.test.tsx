// @vitest-environment jsdom
// 首页发送消息流程的组件测试：Supabase 和 fetch 都替换为测试替身，不访问任何真实服务。
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto'; // jsdom 没有 IndexedDB：用内存版实现，测试真实的 Dexie 缓存
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeSession {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  messages: { id?: string; role: string; content: string }[];
}

const db = vi.hoisted(() => ({
  sessions: [] as FakeSession[],
  updates: [] as { id: string; patch: { messages: { id?: string; role: string; content: string }[] } }[],
  deletes: [] as string[],
  updateError: null as null | { message: string },
  selectGate: null as null | Promise<void>, // 设置后，会话列表请求会等它 resolve 才返回（模拟慢网络）
  selectError: false,
}));

vi.mock('@/lib/supabaseClient', () => {
  const session = { access_token: 'test-access-token', user: { id: 'user-1', email: 'me@example.com' } };
  return {
    supabase: {
      auth: {
        getSession: vi.fn(async () => ({ data: { session } })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
        signInWithOAuth: vi.fn(),
        signOut: vi.fn(),
      },
      // 有状态的假表：insert / update / delete 会真正修改 db.sessions，便于测试"刷新后还在不在"
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            order: async () => {
              const snapshot = structuredClone(db.sessions); // 像真实请求一样，数据在发出请求时确定
              if (db.selectGate) await db.selectGate;
              if (db.selectError) return { data: null, error: { message: 'network error' } };
              return { data: snapshot, error: null };
            },
          }),
        }),
        insert: (row: Omit<FakeSession, 'id' | 'created_at'>) => ({
          select: () => ({
            single: async () => {
              const created = { ...row, id: 'new-session', created_at: '2026-01-02' };
              db.sessions.unshift(structuredClone(created));
              return { data: created, error: null };
            },
          }),
        }),
        update: (patch: { messages: { id?: string; role: string; content: string }[] }) => ({
          eq: async (_column: string, id: string) => {
            if (db.updateError) return { error: db.updateError };
            const stored = JSON.parse(JSON.stringify(patch)); // 模拟 jsonb 序列化（Date 变字符串）
            db.updates.push({ id, patch: stored });
            const row = db.sessions.find(s => s.id === id);
            if (row) row.messages = stored.messages;
            return { error: null };
          },
        }),
        delete: () => ({
          eq: async (_column: string, id: string) => {
            db.deletes.push(id);
            db.sessions = db.sessions.filter(s => s.id !== id);
            return { error: null };
          },
        }),
      })),
    },
  };
});

const { default: Home } = await import('@/pages/index');
const { sessionCache } = await import('@/lib/local-db');

function streamResponse(chunks: string[], init: ResponseInit = { status: 200 }) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, init);
}

// SSE 帧：与服务端 createSseResponse 的格式一致
const frame = (text: string) => `data: ${JSON.stringify({ text })}\n\n`;
const DONE = 'data: [DONE]\n\n';
const sse = (...texts: string[]) => [...texts.map(frame), DONE];

const fetchMock = vi.fn<typeof fetch>();

async function renderAndSend(text: string) {
  render(<Home />);
  const input = await screen.findByPlaceholderText('输入消息...');
  // 等会话列表加载完、自动选中第一个会话
  await screen.findByText('Existing chat');
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
  });
  return input as HTMLInputElement;
}

beforeEach(async () => {
  await sessionCache.clearUser('user-1');
  db.selectGate = null;
  db.selectError = false;
  db.sessions = [{ id: 's1', user_id: 'user-1', title: 'Existing chat', created_at: '2026-01-01', messages: [] }];
  db.updates = [];
  db.deletes = [];
  db.updateError = null;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // jsdom 没有实现元素的 scrollTo（ChatBox 用它自动滚动）
  Element.prototype.scrollTo = () => {};
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Home – sending a message', () => {
  it('streams a successful reply, sends the bearer token, and persists both messages', async () => {
    fetchMock.mockResolvedValue(streamResponse(sse('你好', '，我是', ' AI')));
    await renderAndSend('你好');

    expect(await screen.findByText('你好，我是 AI')).toBeTruthy();
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-access-token');

    await waitFor(() => expect(db.updates).toHaveLength(1));
    expect(db.updates[0].id).toBe('s1');
    expect(db.updates[0].patch.messages.map(m => [m.role, m.content])).toEqual([
      ['user', '你好'],
      ['assistant', '你好，我是 AI'],
    ]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: '发送' })).toBeTruthy(); // loading cleared
  });

  it('multi-turn: sends the previous conversation plus the new question, in order', async () => {
    db.sessions[0].messages = [
      { id: 'h1', role: 'user', content: '我叫小刘' },
      { id: 'h2', role: 'assistant', content: '你好，小刘！' },
    ];
    fetchMock.mockResolvedValue(streamResponse(sse('你叫小刘。')));
    await renderAndSend('我叫什么？');

    await screen.findByText('你叫小刘。');
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body).toEqual({
      messages: [
        { role: 'user', content: '我叫小刘' },
        { role: 'assistant', content: '你好，小刘！' },
        { role: 'user', content: '我叫什么？' },
      ],
    });
  });

  it('multi-turn: a follow-up in the same session includes the reply just streamed', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(sse('第一条回复')));
    await renderAndSend('第一个问题');
    await screen.findByText('第一条回复');

    fetchMock.mockResolvedValueOnce(streamResponse(sse('第二条回复')));
    fireEvent.change(screen.getByPlaceholderText('输入消息...'), { target: { value: '第二个问题' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送' }));
    });
    await screen.findByText('第二条回复');

    const body = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(body.messages).toEqual([
      { role: 'user', content: '第一个问题' },
      { role: 'assistant', content: '第一条回复' },
      { role: 'user', content: '第二个问题' },
    ]);
  });

  it.each([
    [500, {}, '请求失败，请稍后重试。'],
    [401, {}, '登录已失效，请重新登录后再试。'],
    [429, { 'Retry-After': '30' }, '请求太频繁，请 30 秒后再试。'],
    [502, {}, 'AI 服务暂时不可用，请稍后重试。'],
  ])('HTTP %i: shows a safe error, never renders or persists the error body', async (status, headers, expected) => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'internal detail sk-secret' }), { status, headers }),
    );
    const input = await renderAndSend('你好');

    expect((await screen.findByRole('alert')).textContent).toContain(expected);
    expect(screen.queryByText(/internal detail|sk-secret/)).toBeNull();
    expect(screen.queryByText('AI')).toBeNull(); // no assistant bubble
    expect(screen.queryByText('YOU')).toBeNull(); // the optimistic user message was rolled back
    expect(db.updates).toHaveLength(0);
    expect(input.value).toBe('你好'); // restored for retry
    expect(screen.getByRole('button', { name: '发送' })).toBeTruthy(); // loading cleared
  });

  it('network failure: shows a connection error and clears loading', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await renderAndSend('你好');

    expect((await screen.findByRole('alert')).textContent).toContain('网络连接失败');
    expect(db.updates).toHaveLength(0);
    expect(screen.getByRole('button', { name: '发送' })).toBeTruthy();
  });

  it('stream that breaks midway: removes the partial reply and does not persist it', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frame('半截回复')));
        controller.error(new Error('connection reset'));
      },
    });
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
    await renderAndSend('你好');

    expect((await screen.findByRole('alert')).textContent).toContain('AI 回复中断');
    expect(screen.queryByText('半截回复')).toBeNull();
    expect(db.updates).toHaveLength(0);
  });

  it('200 with [DONE] but no text (empty reply): treated as an error, nothing persisted', async () => {
    fetchMock.mockResolvedValue(streamResponse([DONE]));
    await renderAndSend('你好');

    expect((await screen.findByRole('alert')).textContent).toContain('AI 没有返回内容');
    expect(db.updates).toHaveLength(0);
  });

  it('SSE stream that closes without [DONE] (truncated): partial reply removed, error shown, nothing persisted', async () => {
    fetchMock.mockResolvedValue(streamResponse([frame('被截断的')]));
    await renderAndSend('你好');

    expect((await screen.findByRole('alert')).textContent).toContain('AI 回复中断');
    expect(screen.queryByText('被截断的')).toBeNull();
    expect(db.updates).toHaveLength(0);
  });

  it('SSE error event mid-stream: partial reply removed, safe message shown (server text not displayed), nothing persisted', async () => {
    fetchMock.mockResolvedValue(streamResponse([
      frame('写到一半'),
      'event: error\ndata: {"message":"AI service error"}\n\n',
    ]));
    const input = await renderAndSend('你好');

    expect((await screen.findByRole('alert')).textContent).toContain('AI 服务出错');
    expect(screen.queryByText('写到一半')).toBeNull();
    expect(screen.queryByText(/AI service error/)).toBeNull();
    expect(db.updates).toHaveLength(0);
    expect(input.value).toBe('你好');
    expect(screen.getByRole('button', { name: '发送' })).toBeTruthy();
  });

  it('ignores SSE comment lines (keep-alives) while streaming', async () => {
    fetchMock.mockResolvedValue(streamResponse([': keep-alive\n\n', frame('正常'), ': ping\n\n', frame('回复'), DONE]));
    await renderAndSend('你好');
    expect(await screen.findByText('正常回复')).toBeTruthy();
  });

  it('persistence: the first exchange of a brand-new session is saved and survives a reload', async () => {
    fetchMock.mockResolvedValue(streamResponse(sse('新会话的回复')));
    render(<Home />);
    await screen.findByText('Existing chat');
    fireEvent.click(screen.getByRole('button', { name: '+ New Chat' }));
    fireEvent.change(screen.getByPlaceholderText('输入消息...'), { target: { value: '新会话第一句' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送' }));
    });
    await screen.findByText('新会话的回复');

    await waitFor(() => expect(db.updates).toHaveLength(1));
    expect(db.updates[0].id).toBe('new-session');
    const saved = db.updates[0].patch.messages;
    expect(saved.map(m => [m.role, m.content])).toEqual([
      ['user', '新会话第一句'],
      ['assistant', '新会话的回复'],
    ]);
    expect(saved.every(m => typeof m.id === 'string' && m.id.length > 0)).toBe(true);

    // "刷新页面"：卸载后重新渲染，从假表重新加载
    cleanup();
    render(<Home />);
    // 会话标题也是这句话（侧栏里），所以只在消息气泡（Markdown 渲染出的 <p>）里查找
    expect(await screen.findByText('新会话第一句', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText('新会话的回复', { selector: 'p' })).toBeTruthy();
  });

  it('persistence: consecutive turns save the full history once each, without duplicates', async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(sse('回复一')));
    await renderAndSend('问题一');
    await screen.findByText('回复一');

    fetchMock.mockResolvedValueOnce(streamResponse(sse('回复二')));
    fireEvent.change(screen.getByPlaceholderText('输入消息...'), { target: { value: '问题二' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送' }));
    });
    await screen.findByText('回复二');

    await waitFor(() => expect(db.updates).toHaveLength(2));
    const saved = db.updates[1].patch.messages;
    expect(saved.map(m => m.content)).toEqual(['问题一', '回复一', '问题二', '回复二']);
    expect(new Set(saved.map(m => m.id)).size).toBe(4);
  });

  it('persistence: legacy messages saved without an id get one on load (no duplicate React keys)', async () => {
    db.sessions[0].messages = [
      { role: 'user', content: '旧消息' },
      { role: 'assistant', content: '旧回复' },
    ];
    render(<Home />);
    expect(await screen.findByText('旧回复')).toBeTruthy();
    const keyWarnings = vi.mocked(console.error).mock.calls.filter(args => String(args[0]).includes('unique "key"'));
    expect(keyWarnings).toHaveLength(0);
  });

  it('persistence: if the first request in a new session fails, the empty session is removed', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 502 }));
    render(<Home />);
    await screen.findByText('Existing chat');
    fireEvent.click(screen.getByRole('button', { name: '+ New Chat' }));
    fireEvent.change(screen.getByPlaceholderText('输入消息...'), { target: { value: '会失败的问题' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送' }));
    });

    await screen.findByRole('alert');
    await waitFor(() => expect(db.deletes).toEqual(['new-session']));
    expect(db.sessions.map(s => s.id)).toEqual(['s1']);
    expect(screen.queryByText('会失败的问题', { selector: '.truncate' })).toBeNull(); // not in the sidebar
    expect(db.updates).toHaveLength(0);
  });

  it('persistence: a save failure is reported, while the generated reply stays visible', async () => {
    db.updateError = { message: 'permission denied for table chat_sessions' };
    fetchMock.mockResolvedValue(streamResponse(sse('已经生成的回复')));
    await renderAndSend('你好');

    expect((await screen.findByRole('alert')).textContent).toContain('保存失败');
    expect(screen.queryByText(/permission denied/)).toBeNull();
    expect(screen.getByText('已经生成的回复')).toBeTruthy();
  });

  it('cancel mid-stream: keeps and saves the partial reply once, ignores later chunks, shows no error', async () => {
    let push!: (s: string) => void;
    const body = new ReadableStream<Uint8Array>({
      start(c) { push = s => c.enqueue(new TextEncoder().encode(s)); },
    });
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
    await renderAndSend('写一首诗');

    act(() => push(frame('床前明月光，')));
    await screen.findByText('床前明月光，');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '停止' }));
    });

    await waitFor(() => expect(db.updates).toHaveLength(1));
    expect(db.updates[0].patch.messages.map(m => [m.role, m.content])).toEqual([
      ['user', '写一首诗'],
      ['assistant', '床前明月光，'],
    ]);
    // 取消后才到的数据不能再出现（流已被取消，推送会抛错）
    expect(() => push(frame('疑是地上霜。'))).toThrow();
    expect(screen.queryByText(/疑是地上霜/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: '发送' })).toBeTruthy(); // loading cleared
    expect(db.updates).toHaveLength(1); // saved exactly once
  });

  it('cancel before any content arrives: rolls back like nothing was sent, no error, nothing saved', async () => {
    // 模拟真实 fetch：请求挂起，signal 中止时以 AbortError 拒绝
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const input = await renderAndSend('你好');
    expect(screen.getByText('你好', { selector: 'p' })).toBeTruthy(); // optimistic user message

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '停止' }));
    });

    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeTruthy());
    expect(screen.queryByText('你好', { selector: 'p' })).toBeNull();
    expect(input.value).toBe('你好');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(db.updates).toHaveLength(0);
  });

  it('cancel before content in a brand-new session also removes the empty session', async () => {
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    render(<Home />);
    await screen.findByText('Existing chat');
    fireEvent.click(screen.getByRole('button', { name: '+ New Chat' }));
    fireEvent.change(screen.getByPlaceholderText('输入消息...'), { target: { value: '马上取消' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '停止' }));
    });

    await waitFor(() => expect(db.deletes).toEqual(['new-session']));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('streams Chinese correctly when a character is split across network chunks', async () => {
    // 整个 SSE 响应按字节切块：'data: {"text":"' 是 15 字节，之后每个汉字 3 字节
    const bytes = new TextEncoder().encode(frame('前端工程师') + DONE);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 19)); // splits 端 (bytes 18..20)
        c.enqueue(bytes.slice(19, 26)); // splits 师 (bytes 27..29)
        c.enqueue(bytes.slice(26, 28));
        c.enqueue(bytes.slice(28));
        c.close();
      },
    });
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
    await renderAndSend('你是谁');

    expect(await screen.findByText('前端工程师')).toBeTruthy();
    await waitFor(() => expect(db.updates).toHaveLength(1));
    expect(db.updates[0].patch.messages[1].content).toBe('前端工程师');
  });

  it('batched rendering: many chunks arriving at once still end with the complete text on screen and in storage', async () => {
    const parts = Array.from({ length: 30 }, (_, i) => `段${i}`);
    fetchMock.mockResolvedValue(streamResponse(sse(...parts)));
    await renderAndSend('长回复');

    const full = parts.join('');
    expect(await screen.findByText(full)).toBeTruthy();
    await waitFor(() => expect(db.updates).toHaveLength(1));
    expect(db.updates[0].patch.messages[1].content).toBe(full);
  });

  it('batched rendering: stopping while chunks are still waiting for the next frame shows and saves all of them', async () => {
    let push!: (s: string) => void;
    const body = new ReadableStream<Uint8Array>({
      start(c) { push = s => c.enqueue(new TextEncoder().encode(s)); },
    });
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
    await renderAndSend('写诗');

    act(() => push(frame('一')));
    await screen.findByText('一');
    // three more chunks in the same tick: they are pending for the next animation frame
    await act(async () => {
      push(frame('二'));
      push(frame('三'));
      push(frame('四'));
      await Promise.resolve();
      fireEvent.click(screen.getByRole('button', { name: '停止' }));
    });

    await waitFor(() => expect(db.updates).toHaveLength(1));
    const saved = db.updates[0].patch.messages[1].content;
    expect(screen.getByText(saved)).toBeTruthy(); // what is saved is exactly what is shown
    expect(saved.startsWith('一')).toBe(true);
  });

  it('batched rendering: a pending frame never re-adds a reply that was rolled back after an error', async () => {
    fetchMock.mockResolvedValue(streamResponse([
      frame('甲'), frame('乙'), frame('丙'),
      'event: error\ndata: {"message":"x"}\n\n',
    ]));
    await renderAndSend('你好');
    await screen.findByRole('alert');

    // wait well past several animation frames
    await act(async () => { await new Promise(r => setTimeout(r, 60)); });
    expect(screen.queryByText(/甲/)).toBeNull();
  });

  it('the error banner can be dismissed and is cleared by the next send', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await renderAndSend('你好');
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }));
    expect(screen.queryByRole('alert')).toBeNull();

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送' }));
    });
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('Home – IndexedDB (Dexie) cache, stale-while-revalidate', () => {
  const cachedSession = (id: string, title: string, contents: string[] = []) => ({
    id,
    user_id: 'user-1',
    title,
    created_at: '2026-01-01',
    messages: contents.map((content, i) => ({ id: `${id}-${i}`, role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content })),
  });
  const cachedIds = async () => (await sessionCache.load('user-1'))?.map(s => s.id);

  it('shows cached sessions immediately, then overwrites UI and cache with Supabase data', async () => {
    await sessionCache.replaceAll('user-1', [cachedSession('c1', 'Cached chat', ['缓存里的问题'])]);
    let release!: () => void;
    db.selectGate = new Promise<void>(r => { release = r; });

    render(<Home />);
    // Supabase 还没返回，缓存内容已经显示
    expect(await screen.findByText('Cached chat')).toBeTruthy();
    expect(screen.getByText('缓存里的问题')).toBeTruthy();
    expect(screen.queryByText('Existing chat')).toBeNull();

    await act(async () => release());
    expect(await screen.findByText('Existing chat')).toBeTruthy();
    expect(screen.queryByText('Cached chat')).toBeNull();
    await waitFor(async () => expect(await cachedIds()).toEqual(['s1']));
  });

  it('keeps showing the cache when Supabase is unreachable', async () => {
    await sessionCache.replaceAll('user-1', [cachedSession('c1', 'Cached chat', ['离线也能看'])]);
    db.selectError = true;
    render(<Home />);
    expect(await screen.findByText('离线也能看')).toBeTruthy();
    expect(await cachedIds()).toEqual(['c1']); // a failed revalidation does not wipe the cache
  });

  it('after a successful reply is saved to Supabase, the cache holds both messages', async () => {
    fetchMock.mockResolvedValue(streamResponse(sse('缓存', '回复')));
    await renderAndSend('问题');
    await screen.findByText('缓存回复');

    await waitFor(async () => {
      const s1 = (await sessionCache.load('user-1'))?.find(s => s.id === 's1');
      expect(s1?.messages.map(m => [m.role, m.content])).toEqual([['user', '问题'], ['assistant', '缓存回复']]);
    });
  });

  it('the first exchange of a brand-new session is cached as well', async () => {
    fetchMock.mockResolvedValue(streamResponse(sse('新会话回复')));
    render(<Home />);
    await screen.findByText('Existing chat');
    fireEvent.click(screen.getByRole('button', { name: '+ New Chat' }));
    fireEvent.change(screen.getByPlaceholderText('输入消息...'), { target: { value: '新问题' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送' }));
    });
    await screen.findByText('新会话回复');

    await waitFor(async () => {
      const created = (await sessionCache.load('user-1'))?.find(s => s.id === 'new-session');
      expect(created?.messages.map(m => m.content)).toEqual(['新问题', '新会话回复']);
    });
  });

  it.each([
    ['HTTP 502', () => new Response(null, { status: 502 })],
    ['empty reply', () => streamResponse([DONE])],
    ['mid-stream error event', () => streamResponse([frame('半截'), 'event: error\ndata: {"message":"x"}\n\n'])],
  ])('a failed reply (%s) is never cached', async (_label, makeResponse) => {
    fetchMock.mockResolvedValue(makeResponse());
    await renderAndSend('不会被缓存的问题');
    await screen.findByRole('alert');

    const s1 = (await sessionCache.load('user-1'))?.find(s => s.id === 's1');
    expect(s1?.messages ?? []).toEqual([]);
  });

  it('a save failure (Supabase update error) does not update the cache either', async () => {
    db.updateError = { message: 'permission denied' };
    fetchMock.mockResolvedValue(streamResponse(sse('没保存成功')));
    await renderAndSend('你好');
    await screen.findByRole('alert');
    const s1 = (await sessionCache.load('user-1'))?.find(s => s.id === 's1');
    expect(s1?.messages ?? []).toEqual([]);
  });

  it('a send during a slow revalidation is not wiped out by the older server response', async () => {
    let release!: () => void;
    db.selectGate = new Promise<void>(r => { release = r; });
    await sessionCache.replaceAll('user-1', [cachedSession('s1', 'Existing chat')]);
    fetchMock.mockResolvedValue(streamResponse(sse('先发出的回复')));

    await renderAndSend('先发出的问题'); // uses the cached session while Supabase is still loading
    await screen.findByText('先发出的回复');
    await waitFor(() => expect(db.updates).toHaveLength(1));

    await act(async () => release()); // the server snapshot was taken before the save
    expect(screen.getByText('先发出的问题', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText('先发出的回复')).toBeTruthy();
  });

  it('deleting a session removes it from the cache', async () => {
    render(<Home />);
    await screen.findByText('Existing chat');
    await waitFor(async () => expect(await cachedIds()).toEqual(['s1']));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });
    await waitFor(async () => expect(await cachedIds()).toEqual([]));
  });

  it('signing out clears this user\'s cache', async () => {
    render(<Home />);
    await screen.findByText('Existing chat');
    await waitFor(async () => expect(await cachedIds()).toEqual(['s1']));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    });
    await waitFor(async () => expect(await cachedIds()).toEqual([]));
  });

  it('when the cache is unavailable (load returns null, as local-db does on IndexedDB errors), Supabase alone still works', async () => {
    vi.spyOn(sessionCache, 'load').mockResolvedValue(null);
    fetchMock.mockResolvedValue(streamResponse(sse('照常工作')));
    await renderAndSend('你好');
    expect(await screen.findByText('照常工作')).toBeTruthy();
    await waitFor(() => expect(db.updates).toHaveLength(1));
  });
});

describe('Home – responsive layout (mobile drawer below md)', () => {
  const toggle = () => screen.getByRole('button', { name: /会话列表/ });
  const drawer = () => document.getElementById('session-drawer') as HTMLElement;

  async function renderLoaded() {
    db.sessions.push({ id: 's2', user_id: 'user-1', title: 'Second chat', created_at: '2025-12-31', messages: [] });
    render(<Home />);
    await screen.findByText('Existing chat');
  }

  it('has a toggle with aria-label / aria-expanded / aria-controls; the drawer starts closed on mobile', async () => {
    await renderLoaded();
    expect(toggle().getAttribute('aria-label')).toBe('打开会话列表');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().getAttribute('aria-controls')).toBe('session-drawer');
    expect(toggle().className).toContain('md:hidden'); // toggle only exists below md
    expect(drawer().className).toContain('-translate-x-full'); // off-canvas below md
    // at md and above the drawer is a normal, always-visible column (layout unchanged)
    expect(drawer().className).toContain('md:static');
    expect(drawer().className).toContain('md:translate-x-0');
    expect(screen.queryByTestId('drawer-overlay')).toBeNull();
  });

  it('toggle opens and closes the drawer', async () => {
    await renderLoaded();
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-label')).toBe('关闭会话列表');
    expect(drawer().className).toContain('translate-x-0');
    expect(drawer().className).not.toMatch(/(^|\s)-translate-x-full/);

    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(drawer().className).toContain('-translate-x-full');
  });

  it('clicking the overlay closes the drawer; the overlay is hidden at md and above', async () => {
    await renderLoaded();
    fireEvent.click(toggle());
    const overlay = screen.getByTestId('drawer-overlay');
    expect(overlay.className).toContain('md:hidden');
    fireEvent.click(overlay);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('drawer-overlay')).toBeNull();
  });

  it('selecting a session switches to it and closes the drawer', async () => {
    db.sessions[0].messages = [{ id: 'm1', role: 'user', content: '第一个会话的消息' }];
    await renderLoaded();
    expect(await screen.findByText('第一个会话的消息')).toBeTruthy();

    fireEvent.click(toggle());
    fireEvent.click(screen.getByText('Second chat'));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('第一个会话的消息')).toBeNull(); // switched to "Second chat"
  });

  it('starting a new chat from the drawer also closes it', async () => {
    await renderLoaded();
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: '+ New Chat' }));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('Escape closes the open drawer', async () => {
    await renderLoaded();
    fireEvent.click(toggle());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });
});
