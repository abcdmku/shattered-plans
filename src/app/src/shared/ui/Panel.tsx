import type { ReactNode } from 'react';

interface PanelProps {
  title?: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, eyebrow, children, className = '' }: PanelProps) {
  return (
    <section className={`panel p-5 ${className}`}>
      {(eyebrow || title) && (
        <header className="mb-4 space-y-1 border-b border-white/8 pb-4">
          {eyebrow ? <div className="label">{eyebrow}</div> : null}
          {title ? <h2 className="text-base font-semibold tracking-tight text-slate-100">{title}</h2> : null}
        </header>
      )}
      {children}
    </section>
  );
}
