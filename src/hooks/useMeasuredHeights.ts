// src/hooks/useMeasuredHeights.ts
// 用一个共享的 ResizeObserver 测量已渲染消息的真实高度，存入按 id 的 HeightCache。
// - measureRef(id) 返回稳定的 callback ref（同一 id 每次返回同一个函数），避免每次渲染反复 observe/unobserve
// - 高度变化时：调用 onResize(变化列表)，并触发一次重渲染（version + 1）
// - 没有 ResizeObserver 的环境（如 jsdom）：不测量，全部使用估计高度
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { HeightCache } from '../lib/height-cache';

export interface HeightChange {
  id: string;
  /** 新高度 − 旧高度（旧高度可能是估计值） */
  delta: number;
}

function measuredHeight(entry: ResizeObserverEntry): number {
  // borderBoxSize 包含内边距和边框；旧浏览器退回 contentRect
  const box = entry.borderBoxSize?.[0];
  return box ? box.blockSize : entry.contentRect.height;
}

export function useMeasuredHeights(estimate: number, onResize?: (changes: HeightChange[]) => void) {
  const [cache] = useState(() => new HeightCache(estimate));
  const [refCallbacks] = useState(() => new Map<string, (el: HTMLElement | null) => void | (() => void)>());
  const [version, setVersion] = useState(0);

  const onResizeRef = useRef(onResize);
  useLayoutEffect(() => {
    onResizeRef.current = onResize;
  });

  const idsRef = useRef(new WeakMap<Element, string>());
  const observerRef = useRef<ResizeObserver | null>(null);

  const getObserver = useCallback((): ResizeObserver | null => {
    if (observerRef.current) return observerRef.current;
    if (typeof ResizeObserver === 'undefined') return null;
    observerRef.current = new ResizeObserver((entries) => {
      const changes: HeightChange[] = [];
      for (const entry of entries) {
        const id = idsRef.current.get(entry.target);
        if (id === undefined) continue;
        const delta = cache.set(id, measuredHeight(entry));
        if (delta !== 0) changes.push({ id, delta });
      }
      if (changes.length === 0) return;
      onResizeRef.current?.(changes);
      setVersion((v) => v + 1);
    });
    return observerRef.current;
  }, [cache]);

  useEffect(() => () => {
    observerRef.current?.disconnect();
    observerRef.current = null;
  }, []);

  const measureRef = useCallback((id: string) => {
    let callback = refCallbacks.get(id);
    if (!callback) {
      callback = (el: HTMLElement | null) => {
        if (!el) return;
        const observer = getObserver();
        if (!observer) return;
        idsRef.current.set(el, id);
        observer.observe(el);
        // React 19：callback ref 可返回清理函数，元素卸载时停止观察
        return () => observer.unobserve(el);
      };
      refCallbacks.set(id, callback);
    }
    return callback;
  }, [refCallbacks, getObserver]);

  const getHeight = useCallback((id: string) => cache.get(id), [cache]);

  return { getHeight, measureRef, version };
}
