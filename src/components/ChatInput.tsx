// src/components/ChatInput.tsx
'use client'

import { useState, useEffect, useRef } from 'react';

// 定义接口，防止 TypeScript 报红
interface ChatInputProps {
  input: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSend: () => void;
  isLoading: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ input, onChange, onSend, isLoading }) => {
  const [recognitionActive, setRecognitionActive] = useState(false);
  const recognitionRef = useRef<any>(null);

  // 初始化语音识别
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0].transcript)
        .join('');
      
      // 触发父组件的 onChange
      onChange({ target: { value: transcript } } as any);
    };

    recognition.onend = () => setRecognitionActive(false);
    recognitionRef.current = recognition;
  }, [onChange]);

  const handleMicClick = () => {
    if (!recognitionRef.current) {
      alert("浏览器不支持语音识别");
      return;
    }
    if (recognitionActive) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
      setRecognitionActive(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isLoading && input.trim()) {
      onSend();
    }
  };

  return (
    <div className="flex items-center space-x-2 p-2 bg-gray-800 rounded-lg">
      <input
        type="text"
        value={input}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        placeholder="输入消息..."
        className="flex-1 bg-transparent text-white outline-none px-2"
      />
      
      {/* 语音按钮 */}
      <button
        type="button"
        onClick={handleMicClick}
        className={`p-2 rounded-full transition ${
          recognitionActive ? 'bg-red-500 animate-pulse' : 'hover:bg-gray-700'
        }`}
      >
        {recognitionActive ? '🛑' : '🎤'}
      </button>

      {/* 发送按钮 */}
      <button
        onClick={onSend}
        disabled={isLoading || !input.trim()}
        className="px-4 py-1 bg-blue-600 rounded text-white disabled:opacity-50"
      >
        {isLoading ? '...' : '发送'}
      </button>
    </div>
  );
};