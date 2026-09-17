import React from 'react';

/**
 * Brand mark for the re-skinned header: a small row of dots pulsing in
 * sequence ("queue heartbeat"), with the final dot rendered in the carbon
 * accent color to suggest a job working its way through to completion.
 * Stands in for WeEvolveIT's 5-dot fusion mark without copying it.
 */
export const PulseLogoMark: React.FC<{ className?: string }> = ({ className = '' }) => {
  const dots = [0, 1, 2, 3];

  return (
    <div className={`flex items-center space-x-1.5 ${className}`} aria-hidden="true">
      {dots.map((i) => {
        const isAccent = i === dots.length - 1;
        return (
          <span
            key={i}
            className={`dot-wave inline-block rounded-full ${
              isAccent ? 'h-2.5 w-2.5 bg-carbon-accent shadow-[0_0_10px_var(--carbon-accent-glow)]' : 'h-2 w-2 bg-white/70'
            }`}
            style={{ animationDelay: `${i * 180}ms` }}
          />
        );
      })}
    </div>
  );
};
