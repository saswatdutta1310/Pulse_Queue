import { useCallback, useRef, useState } from 'react';

/**
 * Micro-interaction for primary CTAs only (per design guidance - overusing
 * this on a dense dashboard full of buttons would feel gimmicky):
 * - Magnetic hover: the element translates slightly toward the cursor
 *   within a bounded radius, snapping back once the cursor leaves that
 *   radius or the element.
 * - Ripple on click: a small circle expands from the click point and fades.
 *
 * Spread the returned props onto any clickable element (button, Link, a);
 * it doesn't call preventDefault/stopPropagation so it composes cleanly
 * with existing onClick/navigation behavior.
 */

interface Ripple {
  id: number;
  x: number;
  y: number;
}

const MAGNET_RADIUS = 70;
const MAGNET_STRENGTH = 10;

let rippleSeq = 0;

export function useMagneticRipple<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [ripples, setRipples] = useState<Ripple[]>([]);

  const onMouseMove = useCallback((e: React.MouseEvent<T>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const dist = Math.hypot(dx, dy);

    if (dist > MAGNET_RADIUS) {
      setOffset((prev) => (prev.x === 0 && prev.y === 0 ? prev : { x: 0, y: 0 }));
      return;
    }
    const pull = 1 - dist / MAGNET_RADIUS;
    setOffset({ x: (dx / MAGNET_RADIUS) * MAGNET_STRENGTH * pull, y: (dy / MAGNET_RADIUS) * MAGNET_STRENGTH * pull });
  }, []);

  const onMouseLeave = useCallback(() => setOffset({ x: 0, y: 0 }), []);

  const onClick = useCallback((e: React.MouseEvent<T>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const id = ++rippleSeq;
    setRipples((prev) => [...prev, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), 650);
  }, []);

  return {
    ref,
    style: { transform: `translate(${offset.x}px, ${offset.y}px)` },
    onMouseMove,
    onMouseLeave,
    onClick,
    ripples
  };
}
