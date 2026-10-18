// src/lib/model.ts
// Groq 模型名从环境变量 GROQ_MODEL 读取，未配置时使用默认值。
// 模型下线时（如 llama-3.3-70b-versatile）只需改环境变量，不用改代码。

export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b';

export function resolveGroqModel(value: string | undefined = process.env.GROQ_MODEL): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : DEFAULT_GROQ_MODEL;
}
