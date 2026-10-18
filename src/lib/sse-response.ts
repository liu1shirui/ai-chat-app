// src/lib/sse-response.ts
// 把 AI SDK 的 fullStream 转成 Server-Sent Events 响应（Content-Type: text/event-stream）。
// 帧格式：
//   data: {"text":"..."}\n\n                          一段回复文本（JSON 编码，换行和引号都安全）
//   event: error\ndata: {"message":"AI service error"}\n\n   模型在流中途出错（不泄露内部细节，不再发送 [DONE]）
//   data: [DONE]\n\n                                   正常结束
// 只转发 text-delta；reasoning-delta（推理模型的思考过程）等其他部分一律不发给前端。
// 用 pull 模式按需读取上游：客户端读多快就拉多快；客户端断开时 cancel 会通知上游停止。

export interface StreamPart {
  type: string;
  text?: string;
  error?: unknown;
}

const encoder = new TextEncoder();
const DONE_FRAME = encoder.encode('data: [DONE]\n\n');
const ERROR_FRAME = encoder.encode(`event: error\ndata: ${JSON.stringify({ message: 'AI service error' })}\n\n`);
const textFrame = (text: string) => encoder.encode(`data: ${JSON.stringify({ text })}\n\n`);

export function createSseResponse(source: AsyncIterable<StreamPart>): Response {
  let iterator: AsyncIterator<StreamPart> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      iterator ??= source[Symbol.asyncIterator]();
      try {
        // 跳过不需要转发的部分，直到产出一帧或结束
        while (true) {
          const { done, value } = await iterator.next();
          if (done) {
            controller.enqueue(DONE_FRAME);
            controller.close();
            return;
          }
          if (value.type === 'text-delta' && value.text) {
            controller.enqueue(textFrame(value.text));
            return;
          }
          if (value.type === 'error') {
            console.error('Model stream error:', value.error);
            controller.enqueue(ERROR_FRAME);
            controller.close();
            await iterator.return?.();
            return;
          }
          if (value.type === 'abort') {
            // 模型调用被中止（通常是客户端已断开）：直接结束，不发送 [DONE]
            controller.close();
            return;
          }
        }
      } catch (error) {
        console.error('Model stream failed:', error);
        controller.enqueue(ERROR_FRAME);
        controller.close();
      }
    },
    async cancel() {
      await iterator?.return?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform：防止代理压缩/缓冲导致事件不能及时到达
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
