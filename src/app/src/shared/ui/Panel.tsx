import type { ReactNode } from 'react';

interface PanelProps {
  title?: string;
  children: ReactNode;
  className?: string;
  compact?: boolean;
}

export function Panel({ title, children, className = '', compact }: PanelProps) {
  const padding = compact ? '12px' : '14px';

  return (
    <section
      className={`panel ${className}`}
      style={{
        position: 'relative',
        overflow: 'hidden',
        padding,
        borderRadius: '18px',
        border: '1px solid rgba(120, 160, 220, 0.12)',
        background:
          'linear-gradient(180deg, rgba(15, 20, 34, 0.96) 0%, rgba(10, 14, 24, 0.92) 100%)',
        boxShadow:
          '0 12px 28px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
        backdropFilter: 'blur(14px)'
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'linear-gradient(180deg, rgba(116, 242, 255, 0.06) 0%, transparent 20%, transparent 100%)'
        }}
      />
      {title && (
        <div className="relative mb-2 flex items-center justify-between gap-3">
          <h2
            className="font-display text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-300/80"
            style={{ lineHeight: 1.2 }}
          >
            {title}
          </h2>
          <span
            aria-hidden="true"
            style={{
              height: '1px',
              flex: 1,
              minWidth: '12px',
              borderRadius: '999px',
              background:
                'linear-gradient(90deg, rgba(116, 242, 255, 0.35) 0%, rgba(116, 242, 255, 0.08) 100%)'
            }}
          />
        </div>
      )}
      <div className="relative">{children}</div>
    </section>
  );
}
