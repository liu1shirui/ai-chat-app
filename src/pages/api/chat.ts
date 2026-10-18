// pages/api/chat.ts
import { streamText } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { verifySupabaseToken } from '../../lib/auth';
import { createChatHandler } from '../../lib/chat-handler';
import { resolveGroqModel } from '../../lib/model';
import { createSlidingWindowLimiter } from '../../lib/rate-limit';
import { createSseResponse } from '../../lib/sse-response';

export const config = {
  runtime: 'edge',
};

// 模块级实例：同一个 Edge 实例内的请求共享计数（多实例之间不共享，见 rate-limit.ts 的说明）
const rateLimiter = createSlidingWindowLimiter({ limit: 10, windowMs: 60_000 });

export default createChatHandler({
  verifyToken: verifySupabaseToken,
  rateLimiter,
  streamReply: (messages, signal) => {
    // 显式（静态写法）读取 API key 并传给 provider，不依赖 SDK 内部的 process.env[name] 动态查找。
    // 缺失时直接抛错：handler 返回 502 并记录 "Model call failed"，而不是返回一个看似成功的 200。
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY is not configured');

    const result = streamText({
      // 每次请求读取，修改 GROQ_MODEL 后重启服务即可生效
      model: createGroq({ apiKey })(resolveGroqModel()),
      messages,
      abortSignal: signal,
    });
    // 以 Server-Sent Events 返回：文本帧 + [DONE]，模型中途出错时发送 error 事件（见 sse-response.ts）
    return createSseResponse(result.fullStream);
  },
});
