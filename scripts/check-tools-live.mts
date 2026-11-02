// 手动验证：用真实的 Groq 模型跑一遍工具调用，看模型是否会调用 calculate / getCurrentTime。
// 运行：node --env-file=.env.local scripts/check-tools-live.mts
// （需要 Node 22.18+ / 24，可直接运行 .mts；不会打印 API key）
import { createGroq } from '@ai-sdk/groq';
import { stepCountIs, streamText } from 'ai';
import { chatTools, MAX_TOOL_STEPS } from '../src/lib/chat-tools.ts';
import { resolveGroqModel } from '../src/lib/model.ts';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  console.error('GROQ_API_KEY is not set (put it in .env.local)');
  process.exit(1);
}
const modelName = resolveGroqModel();
const questions = ['(12.5+7.5)*3 等于多少？', '迪拜现在几点？', '你好，介绍一下你自己（这题不需要工具）'];

let failed = false;
for (const question of questions) {
  const calls: string[] = [];
  try {
    const result = streamText({
      model: createGroq({ apiKey })(modelName),
      messages: [{ role: 'user', content: question }],
      tools: chatTools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
    });
    let text = '';
    for await (const part of result.fullStream) {
      if (part.type === 'tool-call') calls.push(`${part.toolName}(${JSON.stringify(part.input)})`);
      if (part.type === 'tool-result') calls.push(`  -> ${JSON.stringify(part.output)}`);
      if (part.type === 'text-delta') text += part.text;
      if (part.type === 'error') throw part.error;
    }
    console.log(`\nQ: ${question}\n   model: ${modelName}\n   tools: ${calls.length ? '\n   ' + calls.join('\n   ') : '(none)'}\n   A: ${text.trim()}`);
  } catch (error) {
    failed = true;
    console.error(`\nQ: ${question}\n   FAILED: ${error instanceof Error ? error.message : error}`);
  }
}
process.exit(failed ? 1 : 0);
