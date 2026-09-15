import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Track an element's content-box width via `ResizeObserver`. `@pond-ts/charts`'
 * `ChartContainer` needs an explicit pixel width, so a responsive chart wraps a
 * measured element and feeds this width down. Returns `[ref, width]`; width is
 * `0` until the first measurement (callers render a placeholder until > 0).
 */
// NOTE (React 18): the ref is typed `RefObject<T>` because that's what the DOM
// `ref` prop accepts under @types/react@18 (a nullable `RefObject<T | null>` is
// rejected there). React 19 flips this — revisit to `RefObject<T | null>` on the
// React 19 bump.
export function useMeasuredWidth<T extends HTMLElement = HTMLDivElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/**
 * Track an element's border-box width AND height via `ResizeObserver`, seeded by
 * a **synchronous** first read (`getBoundingClientRect` in a layout effect) — RO's
 * initial callback isn't guaranteed to fire, and a fill layout that waits on it
 * can mount at zero and never recover. Returns `[ref, { width, height }]`.
 */
export function useMeasuredSize<T extends HTMLElement = HTMLDivElement>(): [
  RefObject<T>,
  { width: number; height: number },
] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const width = Math.round(r.width);
      const height = Math.round(r.height);
      setSize((p) => (p.width === width && p.height === height ? p : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}
