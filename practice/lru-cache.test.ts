import { describe, expect, it } from 'vitest';
import { LRUCache } from './lru-cache';

describe('LRUCache', () => {
  it('passes the LeetCode 146 example', () => {
    const cache = new LRUCache(2);
    cache.put(1, 1);
    cache.put(2, 2);
    expect(cache.get(1)).toBe(1);   // 1 becomes most recently used
    cache.put(3, 3);                // evicts key 2
    expect(cache.get(2)).toBe(-1);
    cache.put(4, 4);                // evicts key 1
    expect(cache.get(1)).toBe(-1);
    expect(cache.get(3)).toBe(3);
    expect(cache.get(4)).toBe(4);
  });

  it('returns -1 for a missing key', () => {
    expect(new LRUCache(1).get(42)).toBe(-1);
  });

  it('updating an existing key refreshes its value and recency without growing the cache', () => {
    const cache = new LRUCache(2);
    cache.put(1, 1);
    cache.put(2, 2);
    cache.put(1, 10);               // 1 is now most recent
    cache.put(3, 3);                // evicts 2, not 1
    expect(cache.get(1)).toBe(10);
    expect(cache.get(2)).toBe(-1);
    expect(cache.get(3)).toBe(3);
  });

  it('get() counts as a use: the key read most recently survives eviction', () => {
    const cache = new LRUCache<string, string>(2);
    cache.put('a', 'A');
    cache.put('b', 'B');
    cache.get('a');
    cache.put('c', 'C');
    expect(cache.get('b')).toBe(-1);
    expect(cache.get('a')).toBe('A');
  });

  it('capacity 1 keeps only the latest entry', () => {
    const cache = new LRUCache(1);
    cache.put(1, 1);
    cache.put(2, 2);
    expect(cache.get(1)).toBe(-1);
    expect(cache.get(2)).toBe(2);
  });

  it('supports generic key/value types', () => {
    const cache = new LRUCache<string, { title: string }>(2);
    cache.put('s1', { title: '会话一' });
    expect(cache.get('s1')).toEqual({ title: '会话一' });
  });
});
