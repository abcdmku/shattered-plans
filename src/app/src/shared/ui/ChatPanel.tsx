import { useState } from 'react';
import type { ChatMessage } from '../types';

interface ChatPanelProps {
  messages: ChatMessage[];
  disabled?: boolean;
  placeholder?: string;
  submitLabel?: string;
  onSend: (message: string) => void;
}

export function ChatPanel({
  messages,
  disabled = false,
  placeholder = 'Message',
  submitLabel = 'Send',
  onSend
}: ChatPanelProps) {
  const [value, setValue] = useState('');

  return (
    <div className="space-y-3">
      <div className="scroll-panel flex max-h-72 flex-col gap-2">
        {messages.length === 0 ? (
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-4 text-sm text-slate-400">
            Quiet.
          </div>
        ) : (
          messages.map((message, index) => (
            <article key={`${message.timestamp}-${message.senderId}-${index}`} className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3">
              <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.24em] text-slate-500">
                <span>{message.senderName}</span>
                <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{message.message}</p>
            </article>
          ))
        )}
      </div>

      <form
        className="flex gap-2"
        onSubmit={event => {
          event.preventDefault();
          const next = value.trim();
          if (!next || disabled) {
            return;
          }
          onSend(next);
          setValue('');
        }}
      >
        <input
          className="input flex-1"
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          onChange={event => setValue(event.target.value)}
        />
        <button className="button button-primary shrink-0" type="submit" disabled={disabled || !value.trim()}>
          {submitLabel}
        </button>
      </form>
    </div>
  );
}
