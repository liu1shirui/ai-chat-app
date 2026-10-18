import React, { useRef, useEffect } from 'react';
import { ChatMessage } from './ChatMessage';
import { Message } from '../types';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';

interface Props {
  messages: Message[];
  /** 最后一条 AI 回复是否仍在生成（生成中不提供朗读按钮） */
  isStreaming?: boolean;
}

export const ChatBox: React.FC<Props> = ({ messages, isStreaming = false }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const speech = useSpeechSynthesis();
  const { stop } = speech;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

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
