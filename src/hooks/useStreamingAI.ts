// src/hooks/useStreamingAI.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import { Message } from '../types';

interface UseStreamingAIProps {
  sessionId: string; // 当前会话 ID
}

export const useStreamingAI = ({ sessionId }: UseStreamingAIProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const controllerRef = useRef<AbortController | null>(null);

  // 发送用户消息，并开始接收 AI 流式回复
  const sendMessage = useCallback(async (content: string) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: new Date(),
    };

    // 先把用户消息加到消息列表里
    setMessages((prev) => [...prev, userMessage]);

    setIsLoading(true);
    setError(null);

    controllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        sessionId,
        messages: [
         ...messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    {
      role: 'user',
      content,
    },
  ],
}),
        signal: controllerRef.current.signal,
      });

      if (!response.ok) throw new Error('AI 服务请求失败');

      // 流式读取
      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取 AI 响应流');

      let aiContent = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = new TextDecoder().decode(value);
        aiContent += chunk;

        // 实时更新最后一条 AI 消息
        setMessages((prev) => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.role === 'assistant') {
            return [...prev.slice(0, -1), { ...lastMessage, content: aiContent }];
          } else {
            return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: aiContent, createdAt: new Date() }];
          }
        });
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setIsLoading(false);
      controllerRef.current = null;
    }
  }, [sessionId]);

  const cancelStreaming = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsLoading(false);
  };

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    cancelStreaming,
    setMessages, // 如果你想初始化或者清空消息
  };
};