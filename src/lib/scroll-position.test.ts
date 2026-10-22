import { describe, expect, it } from 'vitest';

import { isNearBottom, NEAR_BOTTOM_PX } from './scroll-position';

// 容器高 500，内容高 2000：滚到底时 scrollTop = 1500
const at = (scrollTop: number) => ({ scrollTop, scrollHeight: 2000, clientHeight: 500 });

describe('isNearBottom', () => {
  it('is true at the very bottom', () => {
    expect(isNearBottom(at(1500))).toBe(true);
  });

  it('is true within the threshold (80px by default), inclusive', () => {
    expect(NEAR_BOTTOM_PX).toBe(80);
    expect(isNearBottom(at(1500 - 80))).toBe(true);
  });

  it('is false just beyond the threshold', () => {
    expect(isNearBottom(at(1500 - 81))).toBe(false);
  });

  it('is false when scrolled far up', () => {
    expect(isNearBottom(at(0))).toBe(false);
  });

  it('is true when the content is shorter than the container', () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 500 })).toBe(true);
  });

  it('accepts a custom threshold', () => {
    expect(isNearBottom(at(1400), 100)).toBe(true);
    expect(isNearBottom(at(1400), 99)).toBe(false);
  });
});
