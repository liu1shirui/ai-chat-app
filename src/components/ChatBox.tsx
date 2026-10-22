import React, { useRef, useEffect, useLayoutEffect } from 'react';
import { ChatMessage } from './ChatMessage';
import { Message } from '../types';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { isNearBottom } from '../lib/scroll-position';

interface Props {
  messages: Message[];
  /** 最后一条 AI 回复是否仍在生成（生成中不提供朗读按钮） */
  isStreaming?: boolean;
}

export const ChatBox: React.FC<Props> = ({ messages, isStreaming = false }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const speech = useSpeechSynthesis();
  const { stop } = speech;

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

  const handleScroll = () => {
    const el = scrollRef.current;
    if (el) pinnedRef.current = isNearBottom(el);
  };

  // 有新消息（用户发了新问题、或切换了会话）时停止正在进行的朗读，避免和新内容"抢话"
  const lastId = messages[messages.length - 1]?.id;
  const prevLastIdRef = useRef(lastId);
  useEffect(() => {
    if (prevLastIdRef.current !== lastId) stop();
    prevLastIdRef.current = lastId;
  }, [lastId, stop]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto overflow-x-hidden p-2 md:p-4 space-y-2 bg-gray-900 rounded-md"
    >
      {messages.map((msg, i) => {
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
      })}
    </div>
  );
};
