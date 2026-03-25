// src/components/Sidebar.tsx
import React from 'react';
import { SessionWithMessages } from '../types';

interface Props {
  sessions: SessionWithMessages[];
  currentSessionId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export const Sidebar: React.FC<Props> = ({ sessions, currentSessionId, onSelect, onNew, onDelete }) => {
  return (
    <div className="w-64 bg-gray-800 h-full p-4 flex flex-col">
      <button
        onClick={onNew}
        className="mb-4 px-2 py-1 bg-blue-600 rounded text-white"
      >
        + New Chat
      </button>
      <div className="flex-1 overflow-y-auto">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`p-2 rounded mb-2 cursor-pointer ${
              s.id === currentSessionId ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-200'
            }`}
          >
            <div className="truncate">{s.title}</div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(s.id);
              }}
              className="text-xs text-red-500"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};