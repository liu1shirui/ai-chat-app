import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Message } from '../types';

interface Props {
  message: Message;
}

export const ChatMessage: React.FC<Props> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <div className={`flex w-full my-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] p-3 rounded-2xl ${
          isUser ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-200'
        }`}
      >
        <div className="font-bold text-xs opacity-50 mb-1">{isUser ? 'YOU' : 'AI'}</div>
        <div className="prose prose-invert max-w-none">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
};