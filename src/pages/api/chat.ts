// pages/api/chat.ts
import { streamText } from 'ai';
import { groq } from '@ai-sdk/groq';

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  try {
    const { messages } = await req.json();

    // ✅ 防止空 messages 报错
    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No messages provided' }),
        { status: 400 }
      );
    }

    const result = await streamText({
      model: groq('llama-3.3-70b-versatile'),
      messages,
    });

    return result.toTextStreamResponse();

  } catch (error: any) {
    console.error('Groq 服务调用失败:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500 }
    );
  }
}