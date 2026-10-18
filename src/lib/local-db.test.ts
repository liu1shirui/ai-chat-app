// IndexedDB（Dexie）本地缓存的单元测试：用 fake-indexeddb 提供内存版 IndexedDB，每个测试一个独立数据库。
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { SessionWithMessages } from '../types';
import { createSessionCache } from './local-db';

let seq = 0;
function freshCache() {
  return createSessionCache({ dbName: `test-cache-${seq++}`, indexedDB: new IDBFactory(), IDBKeyRange });
}

function session(id: string, createdAt: string, contents: string[] = []): SessionWithMessages {
  return {
    id,
    user_id: 'ignored-by-cache-key',
    title: `title ${id}`,
    created_at: createdAt,
    messages: contents.map((content, i) => ({
      id: `${id}-m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })),
  };
}

describe('session cache (Dexie / IndexedDB)', () => {
  it('returns [] for a user with nothing cached', async () => {
    expect(await freshCache().load('user-1')).toEqual([]);
  });

  it('round-trips sessions and messages (including Date values), newest session first', async () => {
    const cache = freshCache();
    await cache.replaceAll('user-1', [session('old', '2026-01-01', ['q']), session('new', '2026-02-01', ['问题', '回答'])]);

    const loaded = await cache.load('user-1');
    expect(loaded?.map(s => s.id)).toEqual(['new', 'old']);
    expect(loaded?.[0].messages.map(m => [m.role, m.content])).toEqual([['user', '问题'], ['assistant', '回答']]);
    expect(loaded?.[0].messages[0].createdAt).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it('isolates users: one user never sees or clears another user\'s sessions', async () => {
    const cache = freshCache();
    await cache.replaceAll('user-1', [session('a', '2026-01-01')]);
    await cache.replaceAll('user-2', [session('b', '2026-01-01')]);

    expect((await cache.load('user-1'))?.map(s => s.id)).toEqual(['a']);
    expect((await cache.load('user-2'))?.map(s => s.id)).toEqual(['b']);

    await cache.clearUser('user-1');
    expect(await cache.load('user-1')).toEqual([]);
    expect((await cache.load('user-2'))?.map(s => s.id)).toEqual(['b']);
  });

  it('replaceAll overwrites on revalidate: removed sessions disappear, changed ones are updated', async () => {
    const cache = freshCache();
    await cache.replaceAll('user-1', [session('keep', '2026-01-01', ['old']), session('gone', '2026-01-02')]);
    await cache.replaceAll('user-1', [session('keep', '2026-01-01', ['new', 'reply']), session('added', '2026-01-03')]);

    const loaded = await cache.load('user-1');
    expect(loaded?.map(s => s.id)).toEqual(['added', 'keep']);
    expect(loaded?.find(s => s.id === 'keep')?.messages.map(m => m.content)).toEqual(['new', 'reply']);
  });

  it('replaceAll can keep rows for sessions changed locally during revalidation', async () => {
    const cache = freshCache();
    await cache.replaceAll('user-1', [session('server', '2026-01-01')]);
    await cache.saveSession('user-1', session('just-saved', '2026-01-02', ['新消息']));
    // the older server snapshot does not contain "just-saved" yet
    await cache.replaceAll('user-1', [session('server', '2026-01-01')], new Set(['just-saved']));
    expect((await cache.load('user-1'))?.map(s => s.id)).toEqual(['just-saved', 'server']);
  });

  it('saveSession upserts one session without touching the others; removeSession deletes one', async () => {
    const cache = freshCache();
    await cache.replaceAll('user-1', [session('a', '2026-01-01'), session('b', '2026-01-02')]);
    await cache.saveSession('user-1', session('a', '2026-01-01', ['hi', 'hello']));
    await cache.saveSession('user-1', session('c', '2026-01-03', ['new']));

    let loaded = await cache.load('user-1');
    expect(loaded?.map(s => s.id)).toEqual(['c', 'b', 'a']);
    expect(loaded?.find(s => s.id === 'a')?.messages).toHaveLength(2);

    await cache.removeSession('user-1', 'b');
    loaded = await cache.load('user-1');
    expect(loaded?.map(s => s.id)).toEqual(['c', 'a']);
  });

  it('falls back silently when IndexedDB throws: load() returns null and writes resolve without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = { open: () => { throw new DOMException('blocked by browser settings', 'SecurityError'); } };
    const cache = createSessionCache({ dbName: 'broken', indexedDB: broken as unknown as IDBFactory, IDBKeyRange });

    await expect(cache.load('user-1')).resolves.toBeNull();
    await expect(cache.replaceAll('user-1', [session('a', '2026-01-01')])).resolves.toBeUndefined();
    await expect(cache.saveSession('user-1', session('a', '2026-01-01'))).resolves.toBeUndefined();
    await expect(cache.removeSession('user-1', 'a')).resolves.toBeUndefined();
    await expect(cache.clearUser('user-1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('falls back silently when IndexedDB is not available at all (e.g. server render, old browser)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // node 测试环境里没有全局 indexedDB
    const cache = createSessionCache({ dbName: 'missing' });
    await expect(cache.load('user-1')).resolves.toBeNull();
    await expect(cache.saveSession('user-1', session('a', '2026-01-01'))).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('drops malformed cached messages instead of crashing (uses the same normalisation as Supabase data)', async () => {
    const cache = freshCache();
    const bad = { ...session('a', '2026-01-01'), messages: [{ role: 'user', content: 'ok' }, { nonsense: true }] };
    await cache.saveSession('user-1', bad as unknown as SessionWithMessages);
    const loaded = await cache.load('user-1');
    expect(loaded?.[0].messages.map(m => m.content)).toEqual(['ok']);
  });
});
