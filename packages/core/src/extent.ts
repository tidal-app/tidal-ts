import type { SeriesSchema, TimeSeries } from 'pond-ts';
import { readNumericColumn } from './derive.js';

/** The erased-schema series the extent reads (like derive.ts / join.ts). */
type ExtentSeries = TimeSeries<SeriesSchema>;

/**
 * The min/max of one numeric column, optionally limited to a time `range`
 * (`[from, to]` epoch ms, inclusive) — the **natural extent** an axis-panel
 * member row shows next to its axis's shared range, and the approximation of
 * an axis's auto fit (the union of its members' extents; pond's own fit adds
 * padding on top, which a readout doesn't need to reproduce).
 *
 * Columnar throughout: `bisect` finds the index bounds (O(log N), no Event
 * allocations), `readNumericColumn` walks the packed buffer between them.
 * Gaps (`undefined`/non-finite cells) are skipped; a column that is absent or
 * all-gap in the window yields `null`.
 */
export function columnExtent(
  series: ExtentSeries,
  column: string,
  range?: readonly [number, number] | null,
): { min: number; max: number } | null {
  const col = readNumericColumn(series, column);
  if (!col) return null;
  let lo = 0;
  let hi = col.length;
  if (range) {
    // `bisect` returns the LOWER-BOUND insertion index (first key ≥ the
    // probe), so [bisect(from), bisect(to + 1)) covers exactly the rows with
    // from ≤ t ≤ to. NOT `bisect(to) + 1`: on an unaligned `to` (every
    // pan/zoom window) that lands on the first sample PAST the window and +1
    // would include it — an off-screen spike then poisons the extent (PR #132
    // review, MEDIUM). Keys are epoch-ms integers, so +1 is the exact
    // exclusive bound for an inclusive `to`.
    const s = series as unknown as { bisect(key: number): number };
    lo = Math.max(0, s.bisect(range[0]));
    hi = Math.min(col.length, s.bisect(range[1] + 1));
  }
  let min = Infinity;
  let max = -Infinity;
  for (let i = lo; i < hi; i += 1) {
    const v = col.read(i);
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? { min, max } : null;
}
