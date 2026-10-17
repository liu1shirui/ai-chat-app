// src/lib/chat-errors.ts
// 把 /api/chat 的失败情况转换成给用户看的提示。
// 只根据状态码生成固定文案，不展示服务端返回的错误内容，避免泄露内部细节。

export class ChatRequestError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
    this.name = 'ChatRequestError';
  }
}

export const NETWORK_ERROR_MESSAGE = '网络连接失败，请检查网络后重试。';
export const STREAM_INTERRUPTED_MESSAGE = 'AI 回复中断，请重试。';
export const EMPTY_REPLY_MESSAGE = 'AI 没有返回内容，请稍后重试。';
export const MODEL_STREAM_ERROR_MESSAGE = 'AI 服务出错，回复未完成，请重试。';
export const GENERIC_ERROR_MESSAGE = '请求失败，请稍后重试。';
export const SAVE_FAILED_MESSAGE = '回复已生成，但保存失败，刷新页面后可能丢失。';

export function messageForStatus(status: number, retryAfter: string | null): string {
  switch (status) {
    case 400:
      return '请求内容无效，请修改后重试。';
    case 401:
      return '登录已失效，请重新登录后再试。';
    case 413:
      return '消息或对话内容过长，请缩短后重试。';
    case 429: {
      const seconds = Number(retryAfter);
      return Number.isFinite(seconds) && seconds > 0
        ? `请求太频繁，请 ${Math.ceil(seconds)} 秒后再试。`
        : '请求太频繁，请稍后再试。';
    }
    case 502:
      return 'AI 服务暂时不可用，请稍后重试。';
    case 503:
      return '认证服务暂时不可用，请稍后重试。';
    default:
      return GENERIC_ERROR_MESSAGE;
  }
}
