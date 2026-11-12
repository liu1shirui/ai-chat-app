import React, { useRef, useEffect, useLayoutEffect, useState } from 'react';
import { ChatMessage } from './ChatMessage';
import { Message } from '../types';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useMeasuredHeights, type HeightChange } from '../hooks/useMeasuredHeights';
import { ESTIMATED_MESSAGE_HEIGHT } from '../lib/height-cache';
import { isNearBottom } from '../lib/scroll-position';
import { computeWindow } from '../lib/windowing';

/** 超过这个条数才窗口化渲染；普通长度的会话保持原样（全部渲染） */
export const VIRTUALIZE_THRESHOLD = 100;
/** 视口上下各额外渲染的条数 */
const OVERSCAN = 6;
/** 还没读到容器高度时的默认视口高度 */
const DEFAULT_VIEWPORT = 800;

interface Props {
  messages: Message[];
  /** 最后一条 AI 回复是否仍在生成（生成中不提供朗读按钮） */
  isStreaming?: boolean;
}

export const ChatBox: React.FC<Props> = ({ messages, isStreaming = false }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const speech = useSpeechSynthesis();
  const { stop } = speech;

  // 窗口化：只渲染视口附近的消息（超过阈值时）。滚动位置和容器高度存为 state，变化时重新计算渲染区间。
  const virtualized = messages.length > VIRTUALIZE_THRESHOLD;
  // 初始滚动位置取"尽量靠下"：computeWindow 会把它限制到底部，首次渲染直接画出最后几条（会话从底部打开）
  const [viewport, setViewport] = useState({ scrollTop: Number.MAX_SAFE_INTEGER, height: DEFAULT_VIEWPORT });
  // 高度变化的处理函数在下面（贴底逻辑之后）安装；这里只转发，保证传给 hook 的函数稳定
  const heightChangeHandlerRef = useRef<(changes: HeightChange[]) => void>(() => {});
  const { getHeight, measureRef } = useMeasuredHeights(
    ESTIMATED_MESSAGE_HEIGHT,
    (changes) => heightChangeHandlerRef.current(changes),
  );

  // "贴底"：用户在底部附近（80px 内）时，新内容到来才自动滚到底；向上翻看历史时不再被拉回。
  // 每次用户滚动都重新判断；程序设置的滚动也会触发 scroll 事件，此时仍在底部，保持贴底。
  const pinnedRef = useRef(true);
  const firstId = messages[0]?.id;
  const lastMessage = messages[messages.length - 1];
  const prevIdsRef = useRef<{ firstId?: string; lastId?: string }>({});

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = prevIdsRef.current;
    // 切换会话（首条消息变了，包括首次挂载）或用户刚发出新消息：无论之前翻到哪里，都回到底部
    const switchedChat = prev.firstId !== firstId;
    const sentNewMessage = lastMessage?.role === 'user' && prev.lastId !== lastMessage.id;
    prevIdsRef.current = { firstId, lastId: lastMessage?.id };
    if (switchedChat || sentNewMessage) pinnedRef.current = true;
    // 直接设置 scrollTop（瞬时）：流式时每帧都会触发，平滑滚动会互相打断
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, firstId, lastMessage]);

  const readViewport = (el: HTMLDivElement) => {
    const next = { scrollTop: el.scrollTop, height: el.clientHeight || DEFAULT_VIEWPORT };
    setViewport((prev) => (prev.scrollTop === next.scrollTop && prev.height === next.height ? prev : next));
  };

  // 窗口化模式下同步容器高度（挂载、窗口大小或消息变化后）
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && virtualized) readViewport(el);
  });

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = isNearBottom(el);
    if (virtualized) readViewport(el);
  };

  // 视口上方的消息高度变化时，下面的内容整体移动；把差值加到 scrollTop 上，正在看的内容保持不动
  const pendingCorrectionRef = useRef(0);
  const heightsChangedRef = useRef(false);
  useLayoutEffect(() => {
    heightChangeHandlerRef.current = (changes) => {
      const el = scrollRef.current;
      if (!el) return;
      heightsChangedRef.current = true;
      const changed = new Map(changes.map((c) => [c.id, c.delta]));
      const scrollTop = el.scrollTop;
      // 按"变化之前"的高度累加位置：只有完全在视口上方的消息才需要修正
      let offset = 0;
      for (const m of messages) {
        if (offset >= scrollTop) break;
        const delta = changed.get(m.id) ?? 0;
        const oldHeight = getHeight(m.id) - delta;
        if (delta !== 0 && offset + oldHeight <= scrollTop) pendingCorrectionRef.current += delta;
        offset += oldHeight;
      }
    };
  });

  // 高度变化引起的重渲染之后、浏览器绘制之前：
  // - 贴底时：总高度可能变了（流式回复变长、底部消息首次测得真实高度），重新滚到底，保持贴底
  // - 否则：应用上面的修正量，正在看的内容不动
  useLayoutEffect(() => {
    const heightsChanged = heightsChangedRef.current;
    const correction = pendingCorrectionRef.current;
    heightsChangedRef.current = false;
    pendingCorrectionRef.current = 0;
    const el = scrollRef.current;
    if (!el || !heightsChanged) return;
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    else if (correction !== 0) el.scrollTop += correction;
    else return;
    readViewport(el);
  });

  // 有新消息（用户发了新问题、或切换了会话）时停止正在进行的朗读，避免和新内容"抢话"
  const lastId = messages[messages.length - 1]?.id;
  const prevLastIdRef = useRef(lastId);
  useEffect(() => {
    if (prevLastIdRef.current !== lastId) stop();
    prevLastIdRef.current = lastId;
  }, [lastId, stop]);

  const renderMessage = (msg: Message, i: number) => {
    const streamingThis = isStreaming && i === messages.length - 1;
    const canRead = speech.supported && msg.role === 'assistant' && !streamingThis && msg.content.trim() !== '';
    return (
      <ChatMessage
        key={msg.id}
        message={msg}
        speaking={speech.speakingId === msg.id}
        onToggleSpeak={canRead ? speech.toggle : undefined}
      />
    );
  };

  if (!virtualized) {
    return (
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden p-2 md:p-4 space-y-2 bg-gray-900 rounded-md"
      >
        {messages.map(renderMessage)}
      </div>
    );
  }

  const range = computeWindow({
    heights: messages.map((m) => getHeight(m.id)),
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.height,
    overscan: OVERSCAN,
  });

  // 每条消息包在一个被测量的 div 里：flow-root 让内部 margin 计入高度；pb-2 代替 space-y-2 的间距
  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto overflow-x-hidden p-2 md:p-4 bg-gray-900 rounded-md"
    >
      <div aria-hidden="true" data-spacer="top" style={{ height: range.topSpacer }} />
      {messages.slice(range.start, range.end).map((msg, k) => (
        <div key={msg.id} ref={measureRef(msg.id)} data-message-id={msg.id} className="flow-root pb-2">
          {renderMessage(msg, range.start + k)}
        </div>
      ))}
      <div aria-hidden="true" data-spacer="bottom" style={{ height: range.bottomSpacer }} />
    </div>
  );
};
