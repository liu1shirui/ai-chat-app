// src/lib/local-db.ts
// 会话与消息的本地缓存（IndexedDB，通过 Dexie 访问），按用户隔离。
// 用法是 stale-while-revalidate：页面加载时先显示缓存，再从 Supabase 拉取并覆盖缓存；
// 只有成功保存到 Supabase 的内容才写入缓存（失败/空回复不会进来）；退出登录时清掉该用户的缓存。
//
// 缓存只是加速和离线查看的手段，不是数据源：任何 IndexedDB 错误（隐私模式、被浏览器禁用、
// 服务端渲染时根本没有 IndexedDB）都被吞掉——load 返回 null，写操作静默失败，应用退回只用 Supabase。
import Dexie, { type Table } from 'dexie';
import type { SessionWithMessages } from '../types';
import { normalizeMessages } from './session-messages';

interface CachedSessionRow extends SessionWithMessages {
  /** 缓存所属的登录用户，复合主键 [userId+id] 的一部分 */
  userId: string;
}

class ChatCacheDb extends Dexie {
  sessions!: Table<CachedSessionRow, [string, string]>;

  constructor(name: string, deps: Pick<CacheOptions, 'indexedDB' | 'IDBKeyRange'>) {
    super(name, deps.indexedDB ? { indexedDB: deps.indexedDB, IDBKeyRange: deps.IDBKeyRange } : undefined);
    this.version(1).stores({ sessions: '[userId+id], userId' });
  }
}

export interface CacheOptions {
  dbName?: string;
  /** 测试时注入 fake-indexeddb；默认使用浏览器的全局 indexedDB */
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
}

export interface SessionCache {
  /** 该用户缓存的会话（最新的在前）；缓存不可用时返回 null */
  load(userId: string): Promise<SessionWithMessages[] | null>;
  /** 用服务端的完整列表覆盖该用户的缓存；keep 中的会话（本地刚修改过）保留现有缓存行 */
  replaceAll(userId: string, sessions: SessionWithMessages[], keep?: ReadonlySet<string>): Promise<void>;
  /** 写入/更新单个会话 */
  saveSession(userId: string, session: SessionWithMessages): Promise<void>;
  removeSession(userId: string, sessionId: string): Promise<void>;
  /** 清除该用户的全部缓存（退出登录时调用） */
  clearUser(userId: string): Promise<void>;
}

const toRow = (userId: string, s: SessionWithMessages): CachedSessionRow => ({
  userId,
  id: s.id,
  user_id: s.user_id,
  title: s.title,
  created_at: s.created_at,
  messages: s.messages,
});

export function createSessionCache({ dbName = 'ai-chat-cache', ...deps }: CacheOptions = {}): SessionCache {
  let db: ChatCacheDb | null = null;
  let warned = false;

  // 延迟到第一次使用时才创建，避免服务端渲染/构建阶段触碰 IndexedDB
  const getDb = () => (db ??= new ChatCacheDb(dbName, deps));

  async function safely<T>(operation: (db: ChatCacheDb) => Promise<T>, fallback: T): Promise<T> {
    try {
      return await operation(getDb());
    } catch (error) {
      if (!warned) {
        warned = true;
        console.warn('Local cache unavailable, falling back to Supabase only:', error);
      }
      return fallback;
    }
  }

  return {
    load: (userId) =>
      safely<SessionWithMessages[] | null>(async (d) => {
        const rows = await d.sessions.where('userId').equals(userId).toArray();
        return rows
          .map(({ id, user_id, title, created_at, messages }) => ({
            id,
            user_id,
            title,
            created_at,
            messages: normalizeMessages(messages),
          }))
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
      }, null),

    replaceAll: (userId, sessions, keep) =>
      safely(async (d) => {
        await d.transaction('rw', d.sessions, async () => {
          await d.sessions
            .where('userId')
            .equals(userId)
            .filter(row => !keep?.has(row.id))
            .delete();
          await d.sessions.bulkPut(sessions.map(s => toRow(userId, s)));
        });
      }, undefined),

    saveSession: (userId, session) =>
      safely(async (d) => {
        await d.sessions.put(toRow(userId, session));
      }, undefined),

    removeSession: (userId, sessionId) =>
      safely(async (d) => {
        await d.sessions.delete([userId, sessionId]);
      }, undefined),

    clearUser: (userId) =>
      safely(async (d) => {
        await d.sessions.where('userId').equals(userId).delete();
      }, undefined),
  };
}

// 应用使用的单例
export const sessionCache = createSessionCache();
