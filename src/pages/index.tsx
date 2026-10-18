// src/pages/index.tsx
'use client'

import { useState, useEffect, useRef, useCallback } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import { SessionWithMessages, Message } from '../types';
import { Sidebar } from '../components/Sidebar';
import { ChatBox } from '../components/ChatBox';
import { ChatInput } from '../components/ChatInput';
import {
  ChatRequestError,
  EMPTY_REPLY_MESSAGE,
  GENERIC_ERROR_MESSAGE,
  MODEL_STREAM_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  SAVE_FAILED_MESSAGE,
  STREAM_INTERRUPTED_MESSAGE,
  messageForStatus,
} from '../lib/chat-errors';
import { buildContext } from '../lib/build-context';
import { mergeRevalidated, normalizeMessages } from '../lib/session-messages';
import { sessionCache } from '../lib/local-db';
import { createFrameBatcher } from '../lib/frame-batcher';
import { SseErrorEvent, readSseStream } from '../lib/read-sse-stream';

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionWithMessages[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false); // 添加加载状态
  const [error, setError] = useState<string | null>(null); // 展示给用户的错误提示
  // 当前这一轮请求的 AbortController，用于"停止生成"
  const abortRef = useRef<AbortController | null>(null);
  // 移动端会话列表抽屉是否打开（md 及以上侧栏始终显示，这个状态不影响布局）
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 抽屉打开时按 Esc 关闭
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  // 组件卸载时中止进行中的请求，避免卸载后继续读流、更新状态
  useEffect(() => () => abortRef.current?.abort(), []);

  // 1. 监听登录状态
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // 记录每个会话最近一次被本地修改（发送、新建、删除）的序号，用于 stale-while-revalidate 合并：
  // 重新验证开始之后被本地修改过的会话，不能被（可能更旧的）服务端快照覆盖
  const changeSeqRef = useRef(0);
  const changedAtRef = useRef(new Map<string, number>());
  const inFlightSessionRef = useRef<string | null>(null);
  const markChanged = (sessionId: string) => {
    changedAtRef.current.set(sessionId, ++changeSeqRef.current);
  };

  // 加载会话列表：先显示 IndexedDB 缓存（如果有），再从 Supabase 拉取最新数据覆盖界面和缓存
  const loadSessions = useCallback(async (userId: string) => {
    const startedAt = changeSeqRef.current;
    let revalidated = false;

    const cachePromise = sessionCache.load(userId).then(cached => {
      // Supabase 已经先返回、或没有缓存时，不用缓存覆盖
      if (revalidated || !cached || cached.length === 0) return;
      setSessions(prev => (prev.length === 0 ? cached : prev));
      setCurrentSessionId(cur => cur ?? cached[0].id);
    });

    const { data, error } = await supabase
      .from('chat_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }); // 最新的在上面

    if (error || !data) {
      // 拉取失败（比如离线）：保留缓存内容，不清空
      console.error('加载会话失败:', error);
      await cachePromise;
      return;
    }
    revalidated = true;

    const fresh: SessionWithMessages[] = data.map((row) => ({ ...row, messages: normalizeMessages(row.messages) }));
    const changed = new Set(
      [...changedAtRef.current].filter(([, seq]) => seq > startedAt).map(([id]) => id),
    );
    if (inFlightSessionRef.current) changed.add(inFlightSessionRef.current);

    setSessions(prev => mergeRevalidated(fresh, prev, changed));
    setCurrentSessionId(cur =>
      cur && (fresh.some(s => s.id === cur) || changed.has(cur)) ? cur : (fresh[0]?.id ?? null),
    );
    // 用服务端数据覆盖缓存；本地刚修改过的会话由各自的保存/删除操作维护，这里不动
    void sessionCache.replaceAll(userId, fresh.filter(s => !changed.has(s.id)), changed);
  }, []);

  // 2. 当用户登录后，获取所有会话
  useEffect(() => {
    if (user) {
      void loadSessions(user.id);
    } else {
      setSessions([]);
      setCurrentSessionId(null);
    }
  }, [user, loadSessions]);

  // 3. 登录/登出逻辑
  const handleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) alert(error.message);
  };

  const handleLogout = async () => {
    // 先清掉本机上这个用户的缓存，避免下一个使用这台电脑的人看到
    if (user) await sessionCache.clearUser(user.id);
    await supabase.auth.signOut();
  };

  // 4. 发送消息逻辑
  const handleSend = async () => {
    if (!input.trim() || !user || isLoading) return;

    let targetSessionId = currentSessionId;
    // 本次发送新建的会话 id；若这一轮失败，就删除这个空会话，不留下空记录
    let createdSessionId: string | null = null;
    // 会话的元数据（标题、创建时间等），保存成功后连同完整消息写入本地缓存
    let baseSession = sessions.find(s => s.id === targetSessionId);
    setIsLoading(true);
    setError(null);

    // --- A. 如果没有当前会话，自动创建一个 ---
    if (!targetSessionId) {
      const title = input.trim().slice(0, 20);
      const { data, error } = await supabase
        .from('chat_sessions')
        .insert({
          title,
          user_id: user.id,
          messages: []
        })
        .select()
        .single();

      if (error || !data) {
        setError('创建会话失败，请稍后重试。');
        setIsLoading(false);
        return;
      }
      targetSessionId = data.id;
      createdSessionId = data.id;
      baseSession = { ...data, messages: [] };
      setCurrentSessionId(targetSessionId);
      setSessions(prev => [{ ...data, messages: [] }, ...prev]);
    }
    const sessionId = targetSessionId as string;
    inFlightSessionRef.current = sessionId;
    markChanged(sessionId);

    const newUserMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      createdAt: new Date(),
    };

    // 本轮之前的历史消息（在追加本轮用户消息之前读取；新建的会话没有历史）
    const history = sessions.find(s => s.id === targetSessionId)?.messages ?? [];

    // 更新本地 UI 状态（显示用户消息）
    setSessions(prev => prev.map(s =>
      s.id === targetSessionId ? { ...s, messages: [...s.messages, newUserMessage] } : s
    ));
    const currentInput = input;
    setInput('');

    // 本轮 AI 回复的 id 预先生成，失败时据此精确移除未完成的回复
    const assistantId = crypto.randomUUID();
    let streamStarted = false;
    const controller = new AbortController();
    abortRef.current = controller;
    // 把流式回复写入界面（按 assistantId 更新本轮回复；其余消息对象保持原引用，配合 React.memo 不重渲染）
    const renderBatcher = createFrameBatcher<string>((text) => {
      setSessions(prev => prev.map(s => {
        if (s.id !== sessionId) return s;
        const exists = s.messages.some(m => m.id === assistantId);
        const msgs = exists
          ? s.messages.map(m => (m.id === assistantId ? { ...m, content: text } : m))
          : [...s.messages, { id: assistantId, role: 'assistant' as const, content: text, createdAt: new Date() }];
        return { ...s, messages: msgs };
      }));
    });

    // --- B. 调用 AI 接口 ---
    try {
      // 带上 Supabase access token，服务端据此验证身份
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        // 发送最近的历史 + 本轮提问，让模型能理解上下文（条数和字符数有上限）
        body: JSON.stringify({
          messages: buildContext(history, currentInput),
        }),
        // 停止生成时中止请求；服务端通过 req.signal 感知并停止调用模型
        signal: controller.signal,
      });

      // 非 2xx 响应一律按错误处理，绝不当作 AI 回复去读取和展示
      if (!response.ok) {
        throw new ChatRequestError(messageForStatus(response.status, response.headers.get('Retry-After')));
      }
      if (!response.body) throw new ChatRequestError(GENERIC_ERROR_MESSAGE);

      streamStarted = true;
      // 通过 ReadableStream 逐块读取 SSE 响应并解码（多字节中文跨块也不会乱码）；取消后不再回调。
      // 每块数据交给 renderBatcher：首块立即显示，之后按动画帧合并成一次渲染
      const { text: aiContent, aborted, completed } = await readSseStream(
        response.body,
        (text) => renderBatcher.push(text),
        controller.signal,
      );
      // 流已结束（完成或被停止）：把还在等下一帧的最后一块立刻显示出来
      renderBatcher.flush();

      // 没收到 [DONE] 流就关闭了，也不是用户取消：连接被截断，已收到的部分不当作完整回复保存
      if (!aborted && !completed) throw new ChatRequestError(STREAM_INTERRUPTED_MESSAGE);

      if (!aiContent.trim()) {
        // 还没收到任何内容就取消：按"没发送过"回滚（catch 中识别为取消，不显示错误）
        if (aborted) throw new DOMException('Generation cancelled', 'AbortError');
        // 正常结束但没有任何文本：不能当作成功回复保存
        throw new ChatRequestError(EMPTY_REPLY_MESSAGE);
      }
      // 走到这里：完整回复，或者用户中途停止但已有部分内容——两种情况都保存已生成的内容

      // --- C. 最终同步：将完整的对话历史存入 Supabase ---
      // 用"本轮开始时的历史快照 + 本轮两条消息"组装完整记录，而不是在 await 之后再读 sessions：
      // 闭包里的 sessions 是点击发送那一刻的值，新建的会话根本不在里面（这正是原来第一轮丢失的原因）。
      const assistantMessage: Message = { id: assistantId, role: 'assistant', content: aiContent, createdAt: new Date() };
      const finalMessages = [...history, newUserMessage, assistantMessage];
      try {
        const { error: saveError } = await supabase
          .from('chat_sessions')
          .update({ messages: finalMessages })
          .eq('id', targetSessionId);
        if (saveError) throw saveError;
        // 只有成功保存到 Supabase 之后才写入本地缓存（失败/空回复在前面已抛错，不会走到这里）
        if (baseSession) void sessionCache.saveSession(user.id, { ...baseSession, messages: finalMessages });
      } catch (saveErr) {
        // 回复已经完整生成并显示，保存失败不回滚界面，只提示用户；下次成功保存时会写入完整历史
        console.error('保存聊天记录失败:', saveErr);
        setError(SAVE_FAILED_MESSAGE);
      }

    } catch (err) {
      // 先丢弃还没渲染的分块，防止回滚之后某一帧又把未完成的回复加回界面
      renderBatcher.cancel();
      // 用户主动停止（无论发生在请求阶段还是读流阶段）不是错误，只回滚、不提示
      const cancelled = controller.signal.aborted;
      if (!cancelled) console.error("AI 响应出错:", err);

      // 本轮新建的会话还没有任何消息，失败时一并删除，避免留下空会话
      if (createdSessionId) {
        const emptyId = createdSessionId;
        setSessions(prev => prev.filter(s => s.id !== emptyId));
        setCurrentSessionId(cur => (cur === emptyId ? null : cur));
        const { error: deleteError } = await supabase.from('chat_sessions').delete().eq('id', emptyId);
        if (deleteError) console.error('删除空会话失败:', deleteError);
        void sessionCache.removeSession(user.id, emptyId);
      }

      // 回滚：移除本轮的用户消息和未完成的 AI 回复，不保存任何失败结果
      setSessions(prev => prev.map(s =>
        s.id === targetSessionId
          ? { ...s, messages: s.messages.filter(m => m.id !== newUserMessage.id && m.id !== assistantId) }
          : s
      ));
      // 把原输入放回输入框方便重试；若用户在等待期间已输入新内容则不覆盖
      setInput(prev => (prev === '' ? currentInput : prev));

      if (cancelled) {
        // 取消不显示错误提示
      } else if (err instanceof ChatRequestError) {
        setError(err.userMessage);
      } else if (err instanceof SseErrorEvent) {
        // 服务端在流中途发送了 error 事件（模型出错）；只显示固定文案，不展示服务端内容
        setError(MODEL_STREAM_ERROR_MESSAGE);
      } else {
        // fetch 本身失败（断网等）或读流过程中出错
        setError(streamStarted ? STREAM_INTERRUPTED_MESSAGE : NETWORK_ERROR_MESSAGE);
      }
    } finally {
      setIsLoading(false);
      if (abortRef.current === controller) abortRef.current = null;
      // 结束时再记一次修改：防止发送期间开始的重新验证用旧快照覆盖本轮结果
      inFlightSessionRef.current = null;
      markChanged(sessionId);
    }
  };

  // 停止生成：中止请求和读流；已生成的部分会被保留并保存
  const handleCancel = () => {
    abortRef.current?.abort();
  };

  // 5. 新建/删除会话
  const handleNewSession = () => {
    setCurrentSessionId(null); // 清空当前 ID，下次发送会自动创建
    setInput('');
  };

  const handleDeleteSession = async (id: string) => {
    markChanged(id);
    await supabase.from('chat_sessions').delete().eq('id', id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (currentSessionId === id) setCurrentSessionId(null);
    if (user) void sessionCache.removeSession(user.id, id);
  };

  const currentSession = sessions.find(s => s.id === currentSessionId);

  // --- 渲染逻辑 ---
  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        <div className="text-center">
          <h1 className="text-2xl mb-4 font-bold">Welcome to AI Chat</h1>
          <button onClick={handleLogin} className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition">
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-900 text-white">
      {/* 移动端（md 以下）：侧栏是抽屉，打开时显示遮罩，点击遮罩关闭；md 及以上不显示遮罩 */}
      {drawerOpen && (
        <div
          data-testid="drawer-overlay"
          aria-hidden="true"
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      {/* md 以下：固定定位、默认移出屏幕左侧；md 及以上：普通的一列，始终可见（与原布局相同） */}
      <aside
        id="session-drawer"
        aria-label="会话列表"
        className={`fixed inset-y-0 left-0 z-30 transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelect={(id) => {
            setCurrentSessionId(id);
            setDrawerOpen(false); // 移动端选择会话后收起抽屉
          }}
          onNew={() => {
            handleNewSession();
            setDrawerOpen(false);
          }}
          onDelete={handleDeleteSession}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden p-3 md:p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setDrawerOpen(open => !open)}
            aria-label={drawerOpen ? '关闭会话列表' : '打开会话列表'}
            aria-expanded={drawerOpen}
            aria-controls="session-drawer"
            className="shrink-0 rounded px-2 py-1 text-lg hover:bg-gray-700 md:hidden"
          >
            ☰
          </button>
          <h2 className="min-w-0 flex-1 truncate text-sm text-gray-400">Logged in as: {user.email}</h2>
          <button onClick={handleLogout} className="shrink-0 px-3 py-1 bg-gray-700 hover:bg-red-600 rounded text-xs transition">
            Logout
          </button>
        </div>

        <ChatBox messages={currentSession?.messages || []} isStreaming={isLoading} />

        {error && (
          <div role="alert" className="mt-4 flex items-start justify-between gap-2 rounded-lg bg-red-900/60 px-3 py-2 text-sm text-red-100">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="关闭错误提示" className="text-red-200 hover:text-white">
              ✕
            </button>
          </div>
        )}

        <div className="mt-4">
          <ChatInput
            input={input}
            onChange={(e) => setInput(e.target.value)}
            onSend={handleSend}
            onCancel={handleCancel}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}