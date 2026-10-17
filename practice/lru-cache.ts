// practice/lru-cache.ts
// 算法练习：LRU 缓存（LeetCode 146）。与聊天应用无关；最初写在 src/hooks/useStreamingAI.ts 末尾（该文件已删除），迁移至此。
// 逻辑保持原样，只补充了 TypeScript 类型：
//   - 利用 Map 保持插入顺序：最近使用的在末尾，最久未使用的在开头
//   - get / put 都是 O(1)
//   - get 未命中时返回 -1（沿用题目约定）

export class LRUCache<K = number, V = number> {
  private readonly capacity: number;
  private readonly map: Map<K, V>;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.map = new Map<K, V>();
  }

  get(key: K): V | -1 {
    if (!this.map.has(key)) return -1;

    const value = this.map.get(key) as V;
    this.map.delete(key);      // 删掉旧位置
    this.map.set(key, value);  // 重新插入到最后，表示最近使用
    return value;
  }

  put(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }

    this.map.set(key, value);

    if (this.map.size > this.capacity) {
      const oldestKey = this.map.keys().next().value as K;
      this.map.delete(oldestKey);
    }
  }
}
