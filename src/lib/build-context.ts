// src/lib/build-context.ts
// 组装发给模型的多轮上下文：从最近的消息往前取，直到达到条数或字符预算，再按时间顺序返回。
// 预算必须不超过服务端校验上限（chat-validation.ts），否则长对话会被服务端以 413 拒绝。
import type { Message } from '../types';
import { MAX_MESSAGE_CHARS, MAX_MESSAGES, MAX_TOTAL_CHARS, type ChatMessageInput } from './chat-validation';

export const CONTEXT_MAX_MESSAGES = 20; // 含本轮用户消息
export const CONTEXT_MAX_CHARS = 12_000; // 留出余量，低于服务端 MAX_TOTAL_CHARS

const TRUNCATION_MARK = '…';

// 编译期之外再做一次保护：预算若被改得比服务端上限还大，立即报错而不是在运行时被 413
if (CONTEXT_MAX_MESSAGES > MAX_MESSAGES || CONTEXT_MAX_CHARS > MAX_TOTAL_CHARS) {
  throw new Error('Context budget must not exceed the server validation limits');
}

// 历史消息超过单条上限时截断（保留开头），避免一条很长的 AI 回复让整个请求被拒绝
function clampHistory(content: string): string {
  return content.length > MAX_MESSAGE_CHARS
    ? content.slice(0, MAX_MESSAGE_CHARS - TRUNCATION_MARK.length) + TRUNCATION_MARK
    : content;
}

export function buildContext(
  history: readonly Message[],
  newUserContent: string,
  { maxMessages = CONTEXT_MAX_MESSAGES, maxChars = CONTEXT_MAX_CHARS } = {},
): ChatMessageInput[] {
  // 本轮用户消息原样发送、不截断；超长时由服务端返回 413，前端提示用户缩短
  const latest: ChatMessageInput = { role: 'user', content: newUserContent };
  let budget = maxChars - newUserContent.length;
  const picked: ChatMessageInput[] = [];

  // 从最新往最旧遍历，只保留 user / assistant 且内容非空的消息
  for (let i = history.length - 1; i >= 0 && picked.length < maxMessages - 1; i--) {
    const m = history[i];
    if ((m.role !== 'user' && m.role !== 'assistant') || m.content.trim() === '') continue;

    const content = clampHistory(m.content);
    if (content.length > budget) break; // 再往前的更旧消息也不要了，保证上下文连续
    budget -= content.length;
    picked.push({ role: m.role, content });
  }

  picked.reverse();
  // 截断后若以 assistant 开头，去掉这些"没有对应提问"的回复，让上下文从用户提问开始
  while (picked.length > 0 && picked[0].role === 'assistant') picked.shift();

  return [...picked, latest];
}
