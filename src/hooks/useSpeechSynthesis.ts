// src/hooks/useSpeechSynthesis.ts
// 朗读 AI 回复（Web Speech Synthesis API）：同一时间只朗读一条，zh-CN。
// - toggle(id, text)：朗读这条；如果正在朗读的就是这条，则停止
// - stop()：停止当前朗读
// - 组件卸载时，如果是本组件发起的朗读，则取消
// 不支持 speechSynthesis 时 supported = false，调用方不显示朗读按钮。
// toggle / stop 的引用保持稳定（内部用 ref 读最新状态），配合 React.memo 不会让所有消息重渲染。
import { useCallback, useEffect, useRef, useState } from 'react';

export function useSpeechSynthesis() {
  const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis;
  const supported = !!synth && typeof window.SpeechSynthesisUtterance === 'function';

  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const speakingIdRef = useRef<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const reset = useCallback(() => {
    utteranceRef.current = null;
    speakingIdRef.current = null;
    setSpeakingId(null);
  }, []);

  const stop = useCallback(() => {
    if (!synth || !utteranceRef.current) return;
    synth.cancel();
    reset();
  }, [synth, reset]);

  const toggle = useCallback(
    (id: string, text: string) => {
      if (!synth || !supported) return;
      if (speakingIdRef.current === id) {
        stop();
        return;
      }
      synth.cancel(); // 停掉正在朗读的另一条

      const utterance = new window.SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      // 只有"当前这一条"结束才重置状态：被打断的上一条稍后触发的 onend 不能影响新的这条
      const finish = () => {
        if (utteranceRef.current === utterance) reset();
      };
      utterance.onend = finish;
      utterance.onerror = finish;

      utteranceRef.current = utterance;
      speakingIdRef.current = id;
      setSpeakingId(id);
      synth.speak(utterance);
    },
    [synth, supported, stop, reset],
  );

  // 卸载时取消本组件发起的朗读（没有在朗读时不调用 cancel，避免影响其他地方）
  useEffect(() => () => {
    if (utteranceRef.current) synth?.cancel();
  }, [synth]);

  return { supported, speakingId, toggle, stop };
}
