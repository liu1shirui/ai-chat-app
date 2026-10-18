// src/components/ChatInput.tsx
'use client'

import { useState, useEffect, useRef } from 'react';
import { useMicLevel } from '../hooks/useMicLevel';

// 定义接口，防止 TypeScript 报红
interface ChatInputProps {
  input: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSend: () => void;
  /** 生成中显示"停止"按钮，点击时调用；不传则沿用原来的"..."按钮 */
  onCancel?: () => void;
  isLoading: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ input, onChange, onSend, onCancel, isLoading }) => {
  const [recognitionActive, setRecognitionActive] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // 识别进行中时，用 Web Audio API 显示麦克风音量；识别结束/出错/卸载时自动释放麦克风
  const micLevel = useMicLevel(recognitionActive);

  // 父组件每次渲染都会传入新的 onChange（内联箭头函数）。用 ref 保存最新的回调，
  // 识别实例就不必依赖 onChange、也不会因每次渲染而被重新创建。
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // 初始化语音识别：只在挂载时创建一次，卸载时中止并解绑回调
  useEffect(() => {
    const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join('');

      // 复用父组件的 onChange 接口，传入只包含 target.value 的最小事件对象
      onChangeRef.current({ target: { value: transcript } } as React.ChangeEvent<HTMLInputElement>);
    };
    recognition.onend = () => setRecognitionActive(false);
    // 例如麦克风权限被拒绝、无语音输入：重置按钮状态，避免一直显示"录音中"
    recognition.onerror = () => setRecognitionActive(false);
    recognitionRef.current = recognition;

    return () => {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  const handleMicClick = () => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      alert("浏览器不支持语音识别");
      return;
    }
    if (recognitionActive) {
      recognition.stop();
    } else {
      try {
        recognition.start();
        setRecognitionActive(true);
      } catch (err) {
        // 已在识别中再次 start 会抛 InvalidStateError；保持未激活状态，不让组件崩溃
        console.error('语音识别启动失败:', err);
        setRecognitionActive(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 中文输入法组合中（拼音选词）按回车是"确认候选词"，不能当作发送。
    // isComposing 是标准判断；keyCode 229 兜底部分浏览器/输入法在组合期间上报的 keydown。
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
        className="min-w-0 flex-1 bg-transparent text-white outline-none px-2"
      />
      
      {/* 语音按钮 */}
      <button
        type="button"
        onClick={handleMicClick}
        aria-label={recognitionActive ? '停止语音输入' : '开始语音输入'}
        className={`shrink-0 p-2 rounded-full transition ${
          recognitionActive ? 'bg-red-500 animate-pulse' : 'hover:bg-gray-700'
        }`}
      >
        {recognitionActive ? '🛑' : '🎤'}
      </button>

      {/* 麦克风音量指示：只在录音中且成功拿到麦克风流时显示 */}
      {recognitionActive && micLevel.status === 'active' && (
        <div
          role="meter"
          aria-label="麦克风音量"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={micLevel.level}
          className="h-2 w-12 shrink-0 overflow-hidden rounded bg-gray-700"
        >
          <div className="h-full bg-green-500 transition-[width] duration-75" style={{ width: `${micLevel.level}%` }} />
        </div>
      )}

      {/* 生成中显示停止按钮，否则显示发送按钮 */}
      {isLoading && onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 px-4 py-1 bg-red-600 hover:bg-red-700 rounded text-white"
        >
          停止
        </button>
      ) : (
        <button
          onClick={onSend}
          disabled={isLoading || !input.trim()}
          className="shrink-0 px-4 py-1 bg-blue-600 rounded text-white disabled:opacity-50"
        >
          {isLoading ? '...' : '发送'}
        </button>
      )}
    </div>
  );
};