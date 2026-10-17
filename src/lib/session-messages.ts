// src/lib/session-messages.ts
// 规范化从 Supabase 读出的 messages（jsonb 数组）：过滤掉格式不对的项，并给缺少 id 的旧数据补上 id。
// 旧版本保存的 AI 回复没有 id，渲染列表时会出现重复/缺失的 React key。
import type { Message, SessionWithMessages } from '../types';

const ROLES: readonly string[] = ['user', 'assistant', 'system'];

export function normalizeMessages(raw: unknown): Message[] {
  if (!Array.isArray(raw)) return [];
  const result: Message[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, role, content, createdAt } = item as Record<string, unknown>;
    if (typeof role !== 'string' || !ROLES.includes(role) || typeof content !== 'string') continue;
    result.push({
      id: typeof id === 'string' && id !== '' ? id : crypto.randomUUID(),
      role: role as Message['role'],
      content,
      // Supabase jsonb 里存的是 ISO 字符串；IndexedDB（结构化克隆）里存的是 Date 对象
      createdAt: createdAt instanceof Date ? createdAt : typeof createdAt === 'string' ? new Date(createdAt) : undefined,
    });
  }
  return result;
}

// stale-while-revalidate 合并：服务端返回的列表覆盖本地（含缓存）数据，
// 但"在这次重新验证开始之后被本地修改过"的会话以本地为准——服务端的快照可能比本地更旧：
//   - 本地还存在：保留本地版本（例如刚发出的消息、刚新建还没出现在服务端结果里的会话）
//   - 本地已不存在：说明刚被删除，不要让旧的服务端数据把它"复活"
export function mergeRevalidated(
  fresh: SessionWithMessages[],
  prev: SessionWithMessages[],
  changedLocally: ReadonlySet<string>,
): SessionWithMessages[] {
  if (changedLocally.size === 0) return fresh;

  const localById = new Map(prev.map(s => [s.id, s]));
  const merged: SessionWithMessages[] = [];
  // 本地新建、服务端结果里还没有的会话，按本地顺序放在最前面
  for (const s of prev) {
    if (changedLocally.has(s.id) && !fresh.some(f => f.id === s.id)) merged.push(s);
  }
  for (const s of fresh) {
    if (!changedLocally.has(s.id)) merged.push(s);
    else if (localById.has(s.id)) merged.push(localById.get(s.id)!);
  }
  return merged;
}
