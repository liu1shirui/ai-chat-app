// src/lib/height-cache.ts
// 按消息 id 记录已测量的高度；未测量的消息使用估计高度。
// set() 返回高度变化量（新 − 旧），供"视口上方消息变高/变矮时修正滚动位置"使用。

export const ESTIMATED_MESSAGE_HEIGHT = 120;

export class HeightCache {
  private readonly heights = new Map<string, number>();

  constructor(private readonly estimate: number = ESTIMATED_MESSAGE_HEIGHT) {}

  get(id: string): number {
    return this.heights.get(id) ?? this.estimate;
  }

  has(id: string): boolean {
    return this.heights.has(id);
  }

  /** 记录测量值，返回相对此前有效高度的变化量；0 或负数视为"尚未布局"，忽略 */
  set(id: string, height: number): number {
    if (!(height > 0)) return 0;
    const previous = this.get(id);
    if (this.heights.has(id) && previous === height) return 0;
    this.heights.set(id, height);
    return height - previous;
  }
}
