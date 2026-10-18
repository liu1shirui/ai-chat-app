// src/lib/read-sse-stream.ts
// 用 fetch 返回的 ReadableStream 读取 /api/chat 的 SSE 响应。
// 分层：read-text-stream.ts 负责逐块读取 + UTF-8 流式解码（中文跨块不乱码）+ 取消，
//       sse-parser.ts 负责把文本切成 SSE 事件，本文件负责解释事件含义：
//   - 普通事件：data 是 JSON {"text": "..."}，追加到回复
//   - data: [DONE]：正常结束（completed = true），之后的内容一律忽略
//   - event: error：服务端在流中途报告模型出错，抛出 SseErrorEvent
//   - 流关闭但没收到 [DONE]：连接被截断（completed = false），由调用方按失败处理
import { readTextStream } from './read-text-stream';
import { SseParser } from './sse-parser';

export class SseErrorEvent extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SseErrorEvent';
  }
}

export interface ReadSseStreamResult {
  text: string;
  /** 调用方主动取消（signal 触发）且尚未正常结束 */
  aborted: boolean;
  /** 收到了 [DONE] */
  completed: boolean;
}

function errorMessageOf(data: string): string {
  try {
    const parsed = JSON.parse(data) as { message?: unknown };
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    // 非 JSON 的错误数据：用通用描述
  }
  return 'Stream error';
}

export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<ReadSseStreamResult> {
  // 内部控制器：收到 [DONE] 时用它提前结束读取；调用方的 signal 也转发到这里
  const stopReading = new AbortController();
  const forwardAbort = () => stopReading.abort();
  if (signal?.aborted) stopReading.abort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });

  const parser = new SseParser();
  let consumed = 0;
  let text = '';
  let completed = false;

  try {
    await readTextStream(
      body,
      (decoded) => {
        if (completed) return;
        const chunk = decoded.slice(consumed);
        consumed = decoded.length;

        for (const event of parser.push(chunk)) {
          if (event.event === 'error') throw new SseErrorEvent(errorMessageOf(event.data));
          if (event.data === '[DONE]') {
            completed = true;
            stopReading.abort();
            return;
          }
          const payload = JSON.parse(event.data) as { text?: unknown };
          if (typeof payload.text !== 'string') throw new Error('Malformed SSE payload');
          text += payload.text;
          onText(text);
        }
      },
      stopReading.signal,
    );
  } finally {
    signal?.removeEventListener('abort', forwardAbort);
  }

  return { text, aborted: !completed && signal?.aborted === true, completed };
}
