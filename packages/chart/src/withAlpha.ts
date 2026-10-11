// The chart's one colour transform: fading an ink by an opacity.

/** A colour with its alpha multiplied by `alpha` — `#rgb`, `#rrggbb`,
 *  `#rrggbbaa`, `rgb()` and `rgba()`. Any other colour form comes back
 *  unchanged (dimming then simply no-ops). `1` is the identity. */
export function withAlpha(color: string, alpha: number): string {
  if (alpha >= 1) return color;
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(
    color.trim(),
  );
  if (fn) {
    const a0 = fn[4] == null ? 1 : fn[4].endsWith('%') ? parseFloat(fn[4]) / 100 : Number(fn[4]);
    return `rgba(${fn[1]}, ${fn[2]}, ${fn[3]}, ${round3(a0 * alpha)})`;
  }
  let h = color.trim().replace(/^#/, '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const m = /^([\da-f]{6})([\da-f]{2})?$/i.exec(h);
  if (!m) return color;
  const n = parseInt(m[1]!, 16);
  const a0 = m[2] ? parseInt(m[2], 16) / 255 : 1;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${round3(a0 * alpha)})`;
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
