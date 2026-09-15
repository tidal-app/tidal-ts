import { readNumericColumn } from '@tidal-ts/core';

/**
 * The facts the prepare step (and a host's readouts) need from a series, read
 * **columnar**.
 *
 * Both were previously taken from `series.toObjects()`, which materialises one
 * JS object per bar. At the ~250–1,260 daily bars Tidal was built on that is
 * unnoticeable; at a year of 1-minute bars (250,291) it is the dominant cost of
 * every range change — measured at **885 ms for 6M and 1,714 ms for 1Y** of
 * blocked main thread, scaling with row count, while the same interaction on
 * daily data produced no long task at all.
 *
 * It is also the exact trap pond's "columns, not events" guidance names, and one
 * `TimeSeriesChart` already avoids by comment. These readers keep to the packed typed
 * arrays.
 */

/** A series as the terminal holds it — schema-erased. */
type AnySeries = Parameters<typeof readNumericColumn>[0];

interface Indexable {
  readonly length: number;
  at(index: number): { data(): Record<string, unknown> } | undefined;
}

/** One row, via `at(i)`.
 *
 *  pond documents `at` as routing through the store's per-row `eventAt` cache —
 *  "O(1) materialization for the requested row" — explicitly *unlike* indexing
 *  `series.events`, which forces the whole series to materialise. `toObjects()`
 *  is built on `this.events`, so it is exactly that full materialisation; that is
 *  what `toEvents()` shows up as in a profile.
 *
 *  (A one-row `slice(...).toObjects()` measures fine too — `slice` is
 *  column-native — but it builds an intermediate series to read one row, and
 *  relies on that staying true. `at` says what it means.) */
function rowAt(series: AnySeries, index: number): Record<string, unknown> | undefined {
  const s = series as unknown as Indexable;
  if (index < 0 || index >= s.length) return undefined;
  return s.at(index)?.data();
}

/** Column names, from the first row only. */
export function columnNames(series: AnySeries): string[] {
  const row = rowAt(series, 0);
  return row ? Object.keys(row) : [];
}

/**
 * Which columns carry at least one finite number — "show only what the data
 * carries".
 *
 * The early exit is what makes this cheap: a column with data almost always has
 * it in the first row, so this is O(columns) in practice rather than
 * O(rows × columns). Only a genuinely empty column is scanned to the end, and
 * that is the case worth being sure about.
 */
export function finiteColumns(series: AnySeries): Set<string> {
  const found = new Set<string>();
  for (const name of columnNames(series)) {
    const col = readNumericColumn(series, name);
    if (!col) continue;
    for (let i = 0; i < col.length; i += 1) {
      const v = col.read(i);
      if (typeof v === 'number' && Number.isFinite(v)) {
        found.add(name);
        break;
      }
    }
  }
  return found;
}

/** The last bar, as a plain row — that row only, never the whole series. */
export function lastRow(series: AnySeries): Record<string, number> | undefined {
  const n = (series as unknown as Indexable).length;
  return rowAt(series, n - 1) as Record<string, number> | undefined;
}

/** First and last value of one column, without materialising anything. */
export function firstLast(
  series: AnySeries,
  column: string,
): { first: number | null; last: number | null } {
  const col = readNumericColumn(series, column);
  if (!col || col.length === 0) return { first: null, last: null };
  // `null`, not 0. A zero here used to mean "nothing to report", which is the
  // same conflation the archive makes with a sentinel price of 0 — and it read
  // downstream as a genuine quote of 0.00 for a ticker the dataset simply does
  // not carry (MSFT has daily bars but no minute bars). Absence has to be a
  // different value from a number.
  return { first: col.read(0) ?? null, last: col.read(col.length - 1) ?? null };
}
