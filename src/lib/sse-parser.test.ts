import { describe, expect, it } from 'vitest';
import { SseParser } from './sse-parser';

describe('SseParser', () => {
  it('parses a single complete event', () => {
    expect(new SseParser().push('data: hello\n\n')).toEqual([{ event: 'message', data: 'hello' }]);
  });

  it('parses multiple events delivered in one chunk', () => {
    const events = new SseParser().push('data: a\n\ndata: b\n\ndata: c\n\n');
    expect(events.map(e => e.data)).toEqual(['a', 'b', 'c']);
  });

  it('reassembles an event split mid-line across chunks', () => {
    const parser = new SseParser();
    expect(parser.push('da')).toEqual([]);
    expect(parser.push('ta: {"text":"你')).toEqual([]);
    expect(parser.push('好"}\n')).toEqual([]);
    expect(parser.push('\n')).toEqual([{ event: 'message', data: '{"text":"你好"}' }]);
  });

  it('supports CRLF and CR line endings, including a CRLF split across chunks', () => {
    const parser = new SseParser();
    expect(parser.push('data: x\r')).toEqual([]);
    expect(parser.push('\n\r\n')).toEqual([{ event: 'message', data: 'x' }]);
    // CR-only line endings: the first event is complete once the next line starts;
    // a trailing lone '\r' is held back because it may be the first half of a split '\r\n'
    const crOnly = new SseParser();
    expect(crOnly.push('data: y\r\rdata: z\r\r')).toEqual([{ event: 'message', data: 'y' }]);
    expect(crOnly.push('data: next\n\n')).toEqual([
      { event: 'message', data: 'z' },
      { event: 'message', data: 'next' },
    ]);
  });

  it('ignores comment lines (keep-alives)', () => {
    expect(new SseParser().push(': ping\n\n: another\ndata: real\n\n')).toEqual([{ event: 'message', data: 'real' }]);
  });

  it('reads the event type and resets it after dispatch', () => {
    const events = new SseParser().push('event: error\ndata: {"message":"x"}\n\ndata: next\n\n');
    expect(events).toEqual([
      { event: 'error', data: '{"message":"x"}' },
      { event: 'message', data: 'next' },
    ]);
  });

  it('joins multiple data lines with a newline', () => {
    expect(new SseParser().push('data: line1\ndata: line2\n\n')).toEqual([{ event: 'message', data: 'line1\nline2' }]);
  });

  it('strips exactly one leading space after the colon, and accepts no space', () => {
    expect(new SseParser().push('data:  two spaces\n\ndata:none\n\n').map(e => e.data)).toEqual([' two spaces', 'none']);
  });

  it('does not dispatch an event without data lines, and ignores id/retry/unknown fields', () => {
    expect(new SseParser().push('event: ping\n\nid: 1\nretry: 3000\nfoo: bar\ndata: ok\n\n')).toEqual([
      { event: 'message', data: 'ok' },
    ]);
  });

  it('keeps an incomplete trailing event buffered (never dispatched without its blank line)', () => {
    const parser = new SseParser();
    expect(parser.push('data: complete\n\ndata: incomplete')).toEqual([{ event: 'message', data: 'complete' }]);
    expect(parser.push('\n')).toEqual([]);
  });
});
