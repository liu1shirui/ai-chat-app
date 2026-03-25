// src/types.ts

// 单条消息
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: Date;
}

// 会话类型（带消息）
export interface SessionWithMessages {
  id: string;
  user_id: string;       // 绑定 Supabase 用户
  title: string;
  created_at: string;
  messages: Message[];
}
