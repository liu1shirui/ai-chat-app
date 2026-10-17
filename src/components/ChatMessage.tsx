import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Message } from '../types';
import { toSpeechText } from '../lib/speech-text';

interface Props {
  message: Message;
  /** 这条消息是否正在被朗读 */
  speaking?: boolean;
  /** 提供时显示朗读按钮（只用于 AI 回复）；引用应保持稳定，以免破坏 React.memo */
  onToggleSpeak?: (id: string, text: string) => void;
}

// React.memo：流式回复时只有正在生成的那条消息对象会变化，其余消息对象引用不变
// （更新时用 map 只替换那一条），因此旧消息不会随每一块数据重新渲染 Markdown。
export const ChatMessage = React.memo(function ChatMessage({ message, speaking = false, onToggleSpeak }: Props) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex w-full my-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`min-w-0 max-w-[80%] break-words [overflow-wrap:anywhere] p-3 rounded-2xl ${
          isUser ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-200'
        }`}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="font-bold text-xs opacity-50">{isUser ? 'YOU' : 'AI'}</span>
          {onToggleSpeak && (
            <button
              type="button"
              onClick={() => onToggleSpeak(message.id, toSpeechText(message.content))}
              aria-label={speaking ? '停止朗读' : '朗读'}
              aria-pressed={speaking}
              className="rounded px-1 text-xs opacity-70 hover:bg-gray-700 hover:opacity-100"
            >
              {speaking ? '⏹' : '🔊'}
            </button>
          )}
        </div>
        {/* 长代码块在气泡内横向滚动，不撑破页面宽度 */}
        <div className="prose prose-invert max-w-none [&_pre]:overflow-x-auto">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
});
