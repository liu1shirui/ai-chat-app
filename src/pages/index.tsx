// src/pages/index.tsx
'use client'

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { SessionWithMessages, Message } from '../types';
import { Sidebar } from '../components/Sidebar';
import { ChatBox } from '../components/ChatBox';
import { ChatInput } from '../components/ChatInput';

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionWithMessages[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false); // 添加加载状态

  // 1. 监听登录状态
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // 2. 当用户登录后，获取所有会话
  useEffect(() => {
    if (user) {
      fetchSessions();
    } else {
      setSessions([]);
      setCurrentSessionId(null);
    }
  }, [user]);

  const fetchSessions = async () => {
    const { data, error } = await supabase
      .from('chat_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }); // 最新的在上面

    if (data) {
      setSessions(data.map((s: any) => ({ ...s, messages: s.messages || [] })));
      if (data.length > 0 && !currentSessionId) {
        setCurrentSessionId(data[0].id);
      }
    }
  };

  // 3. 登录/登出逻辑
  const handleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) alert(error.message);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // 4. 发送消息逻辑
  const handleSend = async () => {
    if (!input.trim() || !user || isLoading) return;

    let targetSessionId = currentSessionId;
    setIsLoading(true);

    // --- A. 如果没有当前会话，自动创建一个 ---
    if (!targetSessionId) {
      const title = input.trim().slice(0, 20);
      const { data, error } = await supabase
        .from('chat_sessions')
        .insert({
          title,
          user_id: user.id,
          messages: []
        })
        .select()
        .single();

      if (error || !data) {
        alert("创建会话失败");
        setIsLoading(false);
        return;
      }
      targetSessionId = data.id;
      setCurrentSessionId(targetSessionId);
      setSessions(prev => [{ ...data, messages: [] }, ...prev]);
    }

    const newUserMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      createdAt: new Date(),
    };

    // 更新本地 UI 状态（显示用户消息）
    setSessions(prev => prev.map(s => 
      s.id === targetSessionId ? { ...s, messages: [...s.messages, newUserMessage] } : s
    ));
    const currentInput = input;
    setInput('');

    // --- B. 调用 AI 接口 ---
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: currentInput }],
        }),
      });

      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let aiContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        aiContent += decoder.decode(value, { stream: true });

        // 实时更新流式回复到 UI
        setSessions(prev => prev.map(s => {
          if (s.id !== targetSessionId) return s;
          const msgs = [...s.messages];
          const lastMsg = msgs[msgs.length - 1];

          if (lastMsg?.role === 'assistant') {
            msgs[msgs.length - 1] = { ...lastMsg, content: aiContent };
          } else {
            msgs.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: aiContent,
              createdAt: new Date(),
            });
          }
          return { ...s, messages: msgs };
        }));
      }

      // --- C. 最终同步：将完整的对话历史存入 Supabase ---
      const finalSessions = sessions.find(s => s.id === targetSessionId);
      if (finalSessions) {
        const updatedMessages = [...finalSessions.messages, newUserMessage, {
          role: 'assistant',
          content: aiContent,
          createdAt: new Date()
        }];
        
        await supabase
          .from('chat_sessions')
          .update({ messages: updatedMessages })
          .eq('id', targetSessionId);
      }

    } catch (err) {
      console.error("AI 响应出错:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // 5. 新建/删除会话
  const handleNewSession = () => {
    setCurrentSessionId(null); // 清空当前 ID，下次发送会自动创建
    setInput('');
  };

  const handleDeleteSession = async (id: string) => {
    await supabase.from('chat_sessions').delete().eq('id', id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (currentSessionId === id) setCurrentSessionId(null);
  };

  const currentSession = sessions.find(s => s.id === currentSessionId);

  // --- 渲染逻辑 ---
  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        <div className="text-center">
          <h1 className="text-2xl mb-4 font-bold">Welcome to AI Chat</h1>
          <button onClick={handleLogin} className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition">
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-900 text-white">
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelect={setCurrentSessionId}
        onNew={handleNewSession}
        onDelete={handleDeleteSession}
      />

      <div className="flex flex-col flex-1 p-4 overflow-hidden">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-sm text-gray-400">Logged in as: {user.email}</h2>
          <button onClick={handleLogout} className="px-3 py-1 bg-gray-700 hover:bg-red-600 rounded text-xs transition">
            Logout
          </button>
        </div>

        <ChatBox messages={currentSession?.messages || []} />

        <div className="mt-4">
          <ChatInput
            input={input}
            onChange={(e) => setInput(e.target.value)}
            onSend={handleSend}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}