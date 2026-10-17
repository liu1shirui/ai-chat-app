import { describe, expect, it } from 'vitest';
import { toSpeechText } from './speech-text';

describe('toSpeechText (markdown → plain text for read-aloud)', () => {
  it('removes emphasis, inline code and heading markers', () => {
    expect(toSpeechText('# 标题\n**加粗** 和 *斜体* 以及 `code` ~~删除~~')).toBe('标题\n加粗 和 斜体 以及 code 删除');
  });

  it('keeps link text and drops the URL; drops images', () => {
    expect(toSpeechText('看[官方文档](https://react.dev)吧 ![图](x.png)')).toBe('看官方文档吧');
  });

  it('keeps code block content but drops the fences and language tag', () => {
    expect(toSpeechText('示例：\n```ts\nconst a = 1;\n```\n结束')).toBe('示例：\nconst a = 1;\n结束');
  });

  it('removes list bullets and blockquote markers at line start', () => {
    expect(toSpeechText('- 第一\n* 第二\n1. 第三\n> 引用')).toBe('第一\n第二\n第三\n引用');
  });

  it('leaves plain Chinese text unchanged', () => {
    expect(toSpeechText('你好，我是 AI 助手。')).toBe('你好，我是 AI 助手。');
  });
});
