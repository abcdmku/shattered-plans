import { useState } from 'react';
import type { ChatMessage } from '../types';

interface ChatPanelProps {
  messages: ChatMessage[];
  disabled?: boolean;
  placeholder?: string;
  onSend: (message: string) => void;
}

export function ChatPanel({
  messages,
  disabled = false,
  placeholder = 'Message',
  onSend
}: ChatPanelProps) {
  const [value, setValue] = useState('');

  const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex max-h-48 flex-col gap-1 overflow-y-auto pr-1"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(143, 155, 179, 0.28) transparent'
        }}
      >
        {messages.length === 0 ? (
          <div
            className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-3"
            style={{ boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03)' }}
          >
            <div className="font-display text-[10px] uppercase tracking-[0.26em] text-slate-300/75">
              No transmissions
            </div>
            <div className="mt-1 text-[11px] leading-relaxed text-slate-400/80">
              Channel is quiet. Orders and status updates will appear here.
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              key={`${message.timestamp}-${message.senderId}-${index}`}
              className="rounded-xl border border-white/5 bg-white/[0.025] px-3 py-2"
              style={{
                borderLeft: '2px solid rgba(116, 242, 255, 0.5)',
                boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03)'
              }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-200/90">
                  {message.senderName}
                </span>
                <span className="text-[10px] text-slate-400/70">{formatTime(message.timestamp)}</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-300/90">{message.message}</p>
            </div>
          ))
        )}
      </div>

      <form
        className="flex gap-2 rounded-xl border border-white/6 bg-black/20 p-1"
        onSubmit={event => {
          event.preventDefault();
          const next = value.trim();
          if (!next || disabled) return;
          onSend(next);
          setValue('');
        }}
      >
        <input
          className="input flex-1 border-0 bg-transparent px-3 py-2 text-[11px] shadow-none"
          style={{
            background: 'transparent',
            boxShadow: 'none'
          }}
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          onChange={event => setValue(event.target.value)}
        />
        <button className="btn btn-sm min-w-[72px] px-3" type="submit" disabled={disabled || !value.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
