// src/lib/read-text-stream.ts
// 逐块读取流式文本响应，每收到一块就回调当前累计的完整文本。
//
// 中文解码：一个汉字在 UTF-8 里占 3 个字节，网络分块可能把一个字切在两块之间。
// 必须整个流共用同一个 TextDecoder 并传 { stream: true }，让它把不完整的字节留到下一块再解码；
// 每块 new 一个 TextDecoder 会把被切开的字解成乱码（�）。流结束时再调用一次 decode() 刷出剩余字节。
//
// 取消：signal 触发后立刻 reader.cancel()，让挂起的 read() 结束，并且不再回调 onText，
// 保证取消之后界面不会再被更新。

export interface ReadTextStreamResult {
  text: string;
  aborted: boolean;
}

export async function readTextStream(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<ReadTextStreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';

  const cancelReader = () => {
    reader.cancel().catch(() => {});
  };
  if (signal?.aborted) {
    cancelReader();
    return { text, aborted: true };
  }
  signal?.addEventListener('abort', cancelReader, { once: true });

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        // fetch 被 abort 时，挂起的 read() 会以 AbortError 拒绝：按取消处理，其余错误继续抛出
        if (signal?.aborted) return { text, aborted: true };
        throw err;
      }
      if (signal?.aborted) return { text, aborted: true };
      if (chunk.done) break;

      text += decoder.decode(chunk.value, { stream: true });
      onText(text);
    }

    // 刷出解码器里剩余的字节（流在一个字中间结束时会得到 �，而不是悄悄丢掉）
    const rest = decoder.decode();
    if (rest) {
      text += rest;
      onText(text);
    }
    return { text, aborted: false };
  } catch (err) {
    // 读流出错，或 onText 回调抛错（例如 SSE 解析到错误事件）：释放底层流，不再继续接收数据
    cancelReader();
    throw err;
  } finally {
    signal?.removeEventListener('abort', cancelReader);
  }
}
