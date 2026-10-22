import { describe, expect, it } from 'vitest';

import { ESTIMATED_MESSAGE_HEIGHT, HeightCache } from './height-cache';

describe('HeightCache', () => {
  it('returns the estimate for messages that were never measured', () => {
    expect(new HeightCache().get('a')).toBe(ESTIMATED_MESSAGE_HEIGHT);
    expect(new HeightCache(90).get('a')).toBe(90);
  });

  it('stores a measurement by id and reports the change from the estimate', () => {
    const cache = new HeightCache(100);
    expect(cache.set('a', 160)).toBe(60);
    expect(cache.get('a')).toBe(160);
    expect(cache.has('a')).toBe(true);
    expect(cache.get('b')).toBe(100);
  });

  it('reports the change between two measurements', () => {
    const cache = new HeightCache(100);
    cache.set('a', 160);
    expect(cache.set('a', 140)).toBe(-20);
  });

  it('reports 0 when the height did not change', () => {
    const cache = new HeightCache(100);
    cache.set('a', 160);
    expect(cache.set('a', 160)).toBe(0);
  });

  it('records a first measurement equal to the estimate (change 0)', () => {
    const cache = new HeightCache(100);
    expect(cache.set('a', 100)).toBe(0);
    expect(cache.has('a')).toBe(true);
  });

  it('ignores zero or negative heights (element not laid out yet)', () => {
    const cache = new HeightCache(100);
    expect(cache.set('a', 0)).toBe(0);
    expect(cache.set('a', -5)).toBe(0);
    expect(cache.has('a')).toBe(false);
    expect(cache.get('a')).toBe(100);
  });
});
