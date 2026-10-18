// src/lib/frame-batcher.ts
// 把高频更新合并到动画帧：流式回复每来一块都 setState 会导致每块一次重渲染；
// 用 requestAnimationFrame 合并后，一帧最多渲染一次（浏览器本来也只按帧绘制）。
// - 第一个值立即应用：首字不额外等待一帧
// - 之后的值只记住最新的一个，下一帧统一应用
// - flush()：立即应用待处理的值（流结束/停止时调用，保证最后一块一定显示）
// - cancel()：丢弃待处理的值（失败回滚前调用，防止回滚之后某一帧又把内容加回来）

interface FrameApi {
  raf: (callback: () => void) => number;
  caf: (handle: number) => void;
}

export interface FrameBatcher<T> {
  push(value: T): void;
  flush(): void;
  cancel(): void;
}

export function createFrameBatcher<T>(
  apply: (value: T) => void,
  { raf = (cb) => requestAnimationFrame(cb), caf = (h) => cancelAnimationFrame(h) }: Partial<FrameApi> = {},
): FrameBatcher<T> {
  let first = true;
  let pending: { value: T } | null = null;
  let frame: number | null = null;

  const applyPending = () => {
    if (!pending) return;
    const { value } = pending;
    pending = null;
    apply(value);
  };

  return {
    push(value) {
      if (first) {
        first = false;
        apply(value);
        return;
      }
      pending = { value };
      if (frame === null) {
        frame = raf(() => {
          frame = null;
          applyPending();
        });
      }
    },
    flush() {
      if (frame !== null) {
        caf(frame);
        frame = null;
      }
      applyPending();
    },
    cancel() {
      if (frame !== null) {
        caf(frame);
        frame = null;
      }
      pending = null;
    },
  };
}
