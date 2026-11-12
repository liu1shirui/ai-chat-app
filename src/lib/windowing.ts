// src/lib/windowing.ts
// 长列表"窗口化"：只渲染视口附近的消息，上下用占位 div 撑起总高度。
// 纯函数，便于测试：给定每条消息的高度、滚动位置、视口高度和缓冲条数，算出要渲染的区间。

export interface WindowInput {
  /** 每条消息的高度（已测量的用实际值，未测量的用估计值） */
  heights: number[];
  scrollTop: number;
  viewportHeight: number;
  /** 视口上下各额外渲染的条数，减少快速滚动时的空白 */
  overscan: number;
}

export interface WindowRange {
  /** 渲染区间 [start, end) */
  start: number;
  end: number;
  /** 区间上方、下方占位 div 的高度 */
  topSpacer: number;
  bottomSpacer: number;
  totalHeight: number;
}

/** offsets[i] 是第 i 条消息的顶部位置；offsets[n] 是总高度 */
export function prefixOffsets(heights: number[]): number[] {
  const offsets = new Array<number>(heights.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < heights.length; i++) offsets[i + 1] = offsets[i] + heights[i];
  return offsets;
}

/** 满足 offsets[i] <= value（strict 时为 <）的最大 i，范围 [0, count - 1]；二分查找 */
function lastIndexAt(offsets: number[], count: number, value: number, strict: boolean): number {
  let low = 0;
  let high = count - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const fits = strict ? offsets[mid] < value : offsets[mid] <= value;
    if (fits) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

export function computeWindow({ heights, scrollTop, viewportHeight, overscan }: WindowInput): WindowRange {
  const count = heights.length;
  const offsets = prefixOffsets(heights);
  const totalHeight = offsets[count];
  if (count === 0) return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0, totalHeight: 0 };

  // 和浏览器一样把滚动位置限制在 [0, 总高度 - 视口高度]
  const top = Math.min(Math.max(0, scrollTop), Math.max(0, totalHeight - viewportHeight));
  const bottom = top + viewportHeight;

  const firstVisible = lastIndexAt(offsets, count, top, false);
  const lastVisible = lastIndexAt(offsets, count, bottom, true);

  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(count, lastVisible + 1 + overscan);

  return {
    start,
    end,
    topSpacer: offsets[start],
    bottomSpacer: totalHeight - offsets[end],
    totalHeight,
  };
}
