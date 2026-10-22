// src/lib/scroll-position.ts
// 判断滚动容器是否"贴底"：距离底部不超过 threshold 像素即视为贴底。
// 用于聊天列表：贴底时新内容到来才自动滚到底；用户向上翻看历史时不再被拉回底部。

export const NEAR_BOTTOM_PX = 80;

interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export function isNearBottom(
  { scrollTop, scrollHeight, clientHeight }: ScrollMetrics,
  threshold = NEAR_BOTTOM_PX,
): boolean {
  // 内容不足一屏时距离为负数，也算贴底
  return scrollHeight - scrollTop - clientHeight <= threshold;
}
