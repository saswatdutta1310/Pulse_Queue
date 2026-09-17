import React from 'react';

const TAGLINE = 'ZERO DATA LOSS';
const REPEAT = 5;

/** Large, dimmed/outlined repeated-tagline belt - a slow horizontal loop
 * used as a visual breather between major sections, mirroring WeEvolveIT's
 * repeated mission-text band. */
export const TaglineMarquee: React.FC = () => {
  const base = Array.from({ length: REPEAT });
  const track = [...base, ...base];

  return (
    <div className="relative w-full overflow-hidden border-y border-white/5 py-6 [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
      <div className="marquee-track marquee-track-slow flex w-max items-center">
        {track.map((_, i) => (
          <React.Fragment key={i}>
            <span className="outline-text whitespace-nowrap font-display text-5xl font-bold sm:text-7xl">{TAGLINE}</span>
            <span className="mx-8 inline-block h-2 w-2 rounded-full bg-carbon-accent/40" />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
