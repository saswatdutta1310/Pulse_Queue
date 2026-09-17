import React, { useRef } from 'react';

interface GlowCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Reusable card shell for the carbon design system: dark surface, subtle
 * border, and a cursor-tracking radial "candle glow" spotlight on hover
 * (see .glow-card-spotlight in theme.css). Wrap any card-like content in
 * this instead of hand-rolling the hover treatment per page.
 */
export const GlowCard = React.forwardRef<HTMLDivElement, GlowCardProps>(
  ({ children, className = '', onMouseMove, ...rest }, forwardedRef) => {
    const localRef = useRef<HTMLDivElement | null>(null);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
      const el = localRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        el.style.setProperty('--x', `${e.clientX - rect.left}px`);
        el.style.setProperty('--y', `${e.clientY - rect.top}px`);
      }
      onMouseMove?.(e);
    };

    return (
      <div
        ref={(node) => {
          localRef.current = node;
          if (typeof forwardedRef === 'function') forwardedRef(node);
          else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }}
        onMouseMove={handleMouseMove}
        className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-carbon-card transition-colors duration-300 hover:border-white/25 ${className}`}
        {...rest}
      >
        <div className="glow-card-spotlight pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <div className="relative z-10">{children}</div>
      </div>
    );
  }
);

GlowCard.displayName = 'GlowCard';
