import { describe, expect, it } from 'vitest';

import { computeWindow, prefixOffsets } from './windowing';

const uniform = (count: number, height = 100) => Array.from({ length: count }, () => height);

function renderedHeight(heights: number[], start: number, end: number) {
  return heights.slice(start, end).reduce((sum, h) => sum + h, 0);
}

describe('prefixOffsets', () => {
  it('gives each item its top position, ending with the total height', () => {
    expect(prefixOffsets([10, 20, 30])).toEqual([0, 10, 30, 60]);
    expect(prefixOffsets([])).toEqual([0]);
  });
});

describe('computeWindow', () => {
  it('renders nothing for an empty list', () => {
    expect(computeWindow({ heights: [], scrollTop: 0, viewportHeight: 800, overscan: 5 })).toEqual({
      start: 0, end: 0, topSpacer: 0, bottomSpacer: 0, totalHeight: 0,
    });
  });

  it('renders everything when the list fits in the viewport', () => {
    const range = computeWindow({ heights: uniform(5), scrollTop: 0, viewportHeight: 800, overscan: 2 });
    expect(range).toMatchObject({ start: 0, end: 5, topSpacer: 0, bottomSpacer: 0 });
  });

  it('at the top: the visible items plus the buffer below', () => {
    // 1000 items of 100px, viewport 800px → items 0..7 visible, +3 below
    const range = computeWindow({ heights: uniform(1000), scrollTop: 0, viewportHeight: 800, overscan: 3 });
    expect(range).toMatchObject({ start: 0, end: 11, topSpacer: 0 });
  });

  it('in the middle: the buffer on both sides', () => {
    // scrollTop 5000 → item 50 at the top, items 50..57 visible
    const range = computeWindow({ heights: uniform(1000), scrollTop: 5000, viewportHeight: 800, overscan: 3 });
    expect(range).toMatchObject({ start: 47, end: 61, topSpacer: 4700 });
  });

  it('at the bottom: ends at the last item with no space below', () => {
    const heights = uniform(1000);
    const range = computeWindow({ heights, scrollTop: 100_000 - 800, viewportHeight: 800, overscan: 3 });
    expect(range).toMatchObject({ start: 989, end: 1000, bottomSpacer: 0 });
  });

  it('clamps a scroll position past the end like a browser does', () => {
    const past = computeWindow({ heights: uniform(1000), scrollTop: 1e9, viewportHeight: 800, overscan: 3 });
    const bottom = computeWindow({ heights: uniform(1000), scrollTop: 100_000 - 800, viewportHeight: 800, overscan: 3 });
    expect(past).toEqual(bottom);
    expect(computeWindow({ heights: uniform(1000), scrollTop: -50, viewportHeight: 800, overscan: 3 }).start).toBe(0);
  });

  it('handles items of different heights', () => {
    // a 1000px item starting at 300 covers the whole viewport at scrollTop 500
    const heights = [100, 100, 100, 1000, 100, 100, 100];
    const range = computeWindow({ heights, scrollTop: 500, viewportHeight: 400, overscan: 0 });
    expect(range).toMatchObject({ start: 3, end: 4, topSpacer: 300, bottomSpacer: 300 });
  });

  it('includes an item that is only partly visible at either edge', () => {
    // scrollTop 150: item 1 (100..200) is half visible at the top; item 9 (900..1000) half visible at the bottom
    const range = computeWindow({ heights: uniform(20), scrollTop: 150, viewportHeight: 800, overscan: 0 });
    expect(range).toMatchObject({ start: 1, end: 10 });
  });

  it('spacers plus rendered items always add up to the total height', () => {
    const heights = Array.from({ length: 300 }, (_, i) => 40 + ((i * 37) % 160));
    for (const scrollTop of [0, 1234, 9999, 20_000, 1e9]) {
      const r = computeWindow({ heights, scrollTop, viewportHeight: 800, overscan: 4 });
      expect(r.topSpacer + renderedHeight(heights, r.start, r.end) + r.bottomSpacer).toBe(r.totalHeight);
      expect(r.start).toBeLessThan(r.end);
    }
  });
});
