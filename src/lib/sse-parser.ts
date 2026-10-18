// src/lib/sse-parser.ts
// Server-Sent Events 解析器（增量式）：按 WHATWG 规范把文本流切成事件。
// - 行结束符支持 \n、\r\n、\r；\r\n 被切在两块之间时也能正确识别
// - 以 ':' 开头的是注释行（常用作 keep-alive），忽略
// - data 字段可有多行，用 \n 连接；遇到空行才派发事件；没有 data 的事件不派发
// - 冒号后的第一个空格会被去掉；id / retry 等本项目不用的字段忽略
// 输入必须是已解码的文本（字节解码由 read-text-stream.ts 负责）。

export interface SseEvent {
  event: string;
  data: string;
}

export class SseParser {
  private buffer = '';
  private dataLines: string[] = [];
  private eventType = '';

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];

    while (true) {
      const lf = this.buffer.indexOf('\n');
      const cr = this.buffer.indexOf('\r');
      if (lf === -1 && cr === -1) break;

      const end = lf === -1 ? cr : cr === -1 ? lf : Math.min(lf, cr);
      // 缓冲区以 \r 结尾时可能是被切开的 \r\n，等下一块再判断
      if (this.buffer[end] === '\r' && end === this.buffer.length - 1) break;

      const line = this.buffer.slice(0, end);
      const skip = this.buffer[end] === '\r' && this.buffer[end + 1] === '\n' ? 2 : 1;
      this.buffer = this.buffer.slice(end + skip);

      const event = this.processLine(line);
      if (event) events.push(event);
    }
    return events;
  }

  private processLine(line: string): SseEvent | null {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return null; // 注释

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'data') this.dataLines.push(value);
    else if (field === 'event') this.eventType = value;
    return null;
  }

  private dispatch(): SseEvent | null {
    const event = this.dataLines.length > 0
      ? { event: this.eventType || 'message', data: this.dataLines.join('\n') }
      : null;
    this.dataLines = [];
    this.eventType = '';
    return event;
  }
}
