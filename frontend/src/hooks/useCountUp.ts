import { useEffect, useRef, useState } from 'react';

/** Animates 0 -> target once, when `start` first becomes true (ease-out
 * cubic). After that single reveal, further changes to `target` (this is
 * wired to live metrics, which keep changing) are reflected directly rather
 * than re-running the whole count-up animation. */
export function useCountUp(target: number, start: boolean, durationMs = 1200): number {
  const [value, setValue] = useState(0);
  const hasAnimatedRef = useRef(false);

  useEffect(() => {
    if (!start || hasAnimatedRef.current) return;
    hasAnimatedRef.current = true;

    const startTime = performance.now();
    const endValue = target;
    let frame: number;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(endValue * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  useEffect(() => {
    if (hasAnimatedRef.current) setValue(target);
  }, [target]);

  return value;
}
