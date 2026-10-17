// src/lib/chat-validation.ts
// /api/chat 请求体的校验：只接受 user / assistant 两种角色（不允许前端注入 system 提示），
// 并限制消息条数、单条长度和总长度，防止滥用和超大请求。

export const MAX_MESSAGES = 40;
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_TOTAL_CHARS = 16000;

export type ChatRole = 'user' | 'assistant';

export interface ChatMessageInput {
  role: ChatRole;
  content: string;
}

export type ValidationResult =
  | { ok: true; messages: ChatMessageInput[] }
  | { ok: false; status: 400 | 413; error: string };

const ALLOWED_ROLES: readonly string[] = ['user', 'assistant'];

export function validateChatBody(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null || !('messages' in body)) {
    return { ok: false, status: 400, error: 'messages is required' };
  }

  const raw = (body as { messages: unknown }).messages;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, status: 400, error: 'messages must be a non-empty array' };
  }
  if (raw.length > MAX_MESSAGES) {
    return { ok: false, status: 413, error: `Too many messages (max ${MAX_MESSAGES})` };
  }

  const messages: ChatMessageInput[] = [];
  let totalChars = 0;

  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      return { ok: false, status: 400, error: 'Each message must be an object' };
    }
    const { role, content } = item as { role?: unknown; content?: unknown };

    if (typeof role !== 'string' || !ALLOWED_ROLES.includes(role)) {
      return { ok: false, status: 400, error: 'role must be "user" or "assistant"' };
    }
    if (typeof content !== 'string' || content.trim() === '') {
      return { ok: false, status: 400, error: 'content must be a non-empty string' };
    }
    if (content.length > MAX_MESSAGE_CHARS) {
      return { ok: false, status: 413, error: `Message too long (max ${MAX_MESSAGE_CHARS} characters)` };
    }

    totalChars += content.length;
    // 只保留 role 和 content，丢弃客户端附带的其他字段
    messages.push({ role: role as ChatRole, content });
  }

  if (totalChars > MAX_TOTAL_CHARS) {
    return { ok: false, status: 413, error: `Conversation too long (max ${MAX_TOTAL_CHARS} characters)` };
  }
  if (messages[messages.length - 1].role !== 'user') {
    return { ok: false, status: 400, error: 'The last message must come from the user' };
  }

  return { ok: true, messages };
}
