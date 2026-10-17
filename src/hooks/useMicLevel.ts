// src/hooks/useMicLevel.ts
// 语音输入时的麦克风音量（Web Audio API）：
//   getUserMedia 拿到麦克风流 → AudioContext.createMediaStreamSource → AnalyserNode
//   → 每一帧用 getByteTimeDomainData 读时域波形，计算 RMS 得到 0~100 的音量。
// active 变为 false（停止、识别出错）或组件卸载时，完整释放资源：
//   取消动画帧、断开节点、停止所有音轨（浏览器的"正在使用麦克风"提示随之消失）、关闭 AudioContext。
// 不支持（没有 mediaDevices / AudioContext）或用户拒绝权限时，只是不显示音量，不影响语音识别本身。
import { useEffect, useState } from 'react';

export type MicLevelStatus = 'idle' | 'active' | 'denied';

export function useMicLevel(active: boolean): { level: number; status: MicLevelStatus } {
  const [level, setLevel] = useState(0);
  const [status, setStatus] = useState<MicLevelStatus>('idle');

  useEffect(() => {
    if (!active) return;
    const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
    const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!AudioContextCtor || !mediaDevices?.getUserMedia) return; // 不支持：不显示音量

    let cancelled = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let frame = 0;

    const release = () => {
      cancelAnimationFrame(frame);
      source?.disconnect();
      stream?.getTracks().forEach(track => track.stop());
      void context?.close();
      source = null;
      stream = null;
      context = null;
    };

    mediaDevices.getUserMedia({ audio: true }).then(
      (mediaStream) => {
        stream = mediaStream;
        // 权限弹窗期间已经停止（或组件已卸载）：拿到的流立刻释放，不再创建 AudioContext
        if (cancelled) {
          release();
          return;
        }
        try {
          context = new AudioContextCtor();
          source = context.createMediaStreamSource(mediaStream);
          const analyser = context.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const samples = new Uint8Array(analyser.fftSize);

          const tick = () => {
            analyser.getByteTimeDomainData(samples);
            // 128 是静音的基线；RMS 衡量波形偏离基线的程度
            let sum = 0;
            for (const value of samples) {
              const x = (value - 128) / 128;
              sum += x * x;
            }
            const rms = Math.sqrt(sum / samples.length);
            // 正常说话的 RMS 大多在 0~0.5，放大 2 倍便于观察；取整后值不变时 React 会跳过重渲染
            setLevel(Math.min(100, Math.round(rms * 200)));
            frame = requestAnimationFrame(tick);
          };
          setStatus('active');
          tick();
        } catch (error) {
          console.error('麦克风音量初始化失败:', error);
          release();
        }
      },
      (error) => {
        // 例如 NotAllowedError（拒绝权限）、NotFoundError（没有麦克风）
        console.warn('无法获取麦克风音量:', error);
        if (!cancelled) setStatus('denied');
      },
    );

    return () => {
      cancelled = true;
      release();
      setLevel(0);
      setStatus('idle');
    };
  }, [active]);

  return { level, status };
}
