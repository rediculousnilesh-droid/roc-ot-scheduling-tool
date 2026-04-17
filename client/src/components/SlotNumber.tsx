import { useState, useEffect, useRef, useCallback } from 'react';

interface Props {
  value: number;
  delay: number;
  animKey: number;
}

/**
 * Lucky-draw style spinning number.
 * Uses setTimeout chain for reliable deceleration.
 */
export default function SlotNumber({ value, delay, animKey }: Props) {
  const [display, setDisplay] = useState(value);
  const [spinning, setSpinning] = useState(false);
  const mountedRef = useRef(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAllTimeouts = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearAllTimeouts();
    };
  }, [clearAllTimeouts]);

  useEffect(() => {
    clearAllTimeouts();

    if (animKey === 0) {
      setDisplay(value);
      setSpinning(false);
      return;
    }

    // Start after staggered delay
    timeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      setSpinning(true);

      const totalTicks = 14 + Math.floor(Math.random() * 8);
      let tick = 0;

      function nextTick() {
        if (!mountedRef.current) return;
        tick++;

        if (tick < totalTicks) {
          // Show random digit
          setDisplay(Math.floor(Math.random() * 9) + 1);
          // Decelerate: starts fast (50ms), slows to ~180ms
          const nextDelay = 50 + Math.pow(tick / totalTicks, 2) * 150;
          timeoutRef.current = setTimeout(nextTick, nextDelay);
        } else {
          // Land on final value
          setDisplay(value);
          setSpinning(false);
        }
      }

      nextTick();
    }, delay);

    return clearAllTimeouts;
  }, [animKey, value, delay, clearAllTimeouts]);

  return (
    <span style={{
      display: 'inline-block',
      minWidth: '1.2em',
      fontWeight: 700,
      fontSize: spinning ? '1.15em' : '1em',
      color: spinning ? '#3b82f6' : '#1e293b',
      transition: spinning ? 'none' : 'color 0.3s, font-size 0.3s',
      textShadow: spinning ? '0 0 10px rgba(59,130,246,0.5)' : 'none',
    }}>
      {display}
    </span>
  );
}
