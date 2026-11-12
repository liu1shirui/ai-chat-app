// 用真实的 streamText + 测试用语言模型验证完整的工具调用循环：
// 第 1 步模型请求调用工具 → SDK 校验入参并执行 → 第 2 步模型拿到工具结果后给出最终回答。
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { stepCountIs, streamText } from 'ai';
import { describe, expect, it } from 'vitest';
import { chatTools, MAX_TOOL_STEPS } from './chat-tools';
import { createSseResponse } from './sse-response';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function modelThatCalls(toolName: string, input: unknown, finalText: string) {
  let call = 0;
  const seenPrompts: unknown[] = [];
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      seenPrompts.push(options.prompt);
      call += 1;
      const chunks =
        call === 1
          ? [
              { type: 'tool-call', toolCallId: 'call-1', toolName, input: JSON.stringify(input) },
              { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
            ]
          : [
              { type: 'text-start', id: 't' },
              { type: 'text-delta', id: 't', delta: finalText },
              { type: 'text-end', id: 't' },
              { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
            ];
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
    },
  });
  return { model, calls: () => call, seenPrompts };
}

describe('tool-calling loop (real streamText, mock model)', () => {
  it('executes calculate and streams the model\'s final answer as SSE', async () => {
    const { model, calls, seenPrompts } = modelThatCalls('calculate', { expression: '(12.5 + 7.5) * 3' }, '结果是 60');
    const result = streamText({
      model,
      messages: [{ role: 'user', content: '(12.5+7.5)*3 等于多少？' }],
      tools: chatTools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
    });
    const body = await createSseResponse(result.fullStream).text();

    expect(calls()).toBe(2);
    expect(body).toBe('data: {"text":"结果是 60"}\n\ndata: [DONE]\n\n');
    // the second model call received the tool result (60), i.e. the loop really fed it back
    expect(JSON.stringify(seenPrompts[1])).toContain('"result":60');
  });

  it('feeds a tool error back to the model instead of failing the request', async () => {
    const { model, seenPrompts } = modelThatCalls('calculate', { expression: '1 / 0' }, '不能除以 0');
    const result = streamText({
      model,
      messages: [{ role: 'user', content: '1/0？' }],
      tools: chatTools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
    });
    const body = await createSseResponse(result.fullStream).text();
    expect(body).toContain('不能除以 0');
    expect(JSON.stringify(seenPrompts[1])).toContain('Division by zero');
  });

  it('does not execute a tool call whose input fails schema validation', async () => {
    const { model, seenPrompts } = modelThatCalls('calculate', { expression: '' }, '输入无效');
    const result = streamText({
      model,
      messages: [{ role: 'user', content: 'x' }],
      tools: chatTools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
    });
    await createSseResponse(result.fullStream).text();
    expect(JSON.stringify(seenPrompts[1] ?? '')).not.toContain('"result"');
  });
});
