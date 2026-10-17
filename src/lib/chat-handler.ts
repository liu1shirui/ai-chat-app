// src/lib/chat-handler.ts
// /api/chat 的处理流程，依赖通过参数注入，方便在测试里替换鉴权、限流和模型调用。
// 顺序：方法检查 → 鉴权（401）→ 限流（429）→ 解析 JSON（400）→ 校验（400/413）→ 调用模型流式返回。
import type { ChatMessageInput } from './chat-validation';
import { validateChatBody } from './chat-validation';
import type { VerifyToken } from './auth';
import { getBearerToken } from './auth';
import type { RateLimiter } from './rate-limit';

export type StreamReply = (messages: ChatMessageInput[], signal: AbortSignal) => Promise<Response> | Response;

interface Deps {
  verifyToken: VerifyToken;
  rateLimiter: RateLimiter;
  streamReply: StreamReply;
}

function jsonError(status: number, error: string, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function createChatHandler({ verifyToken, rateLimiter, streamReply }: Deps) {
  return async function handler(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
      return jsonError(405, 'Method not allowed', { Allow: 'POST' });
    }

    const token = getBearerToken(req);
    if (!token) return jsonError(401, 'Unauthorized');

    let user;
    try {
      user = await verifyToken(token);
    } catch (error) {
      // 鉴权服务不可用或配置缺失：不把内部错误细节返回给客户端
      console.error('Auth verification failed:', error);
      return jsonError(503, 'Authentication service unavailable');
    }
    if (!user) return jsonError(401, 'Unauthorized');

    // 按验证后的用户 id 限流，而不是按客户端自报的信息
    const limit = rateLimiter.check(user.id);
    if (!limit.allowed) {
      return jsonError(429, 'Too many requests', {
        'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)),
      });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'Invalid JSON body');
    }

    const result = validateChatBody(body);
    if (!result.ok) return jsonError(result.status, result.error);

    try {
      // 传入 req.signal：客户端中止请求时，服务端也能停止调用模型
      return await streamReply(result.messages, req.signal);
    } catch (error) {
      console.error('Model call failed:', error);
      return jsonError(502, 'AI service request failed');
    }
  };
}
