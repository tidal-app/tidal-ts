import type { SeriesSchema, TimeSeries } from 'pond-ts';
import { COMPARE_PREFIX } from './derive.js';

/** The erased-schema series the join reads/writes (like derive.ts). */
type JoinedSeries = TimeSeries<SeriesSchema>;

/**
 * Join `other`'s value columns onto `primary` with every one renamed under
 * `prefix` (default {@link COMPARE_PREFIX}) — a **left exact-key join** whose
 * output keeps the primary's column names untouched. This is what carries the
 * compare ticker's columns onto the primary series so a role-bound pair leg
 * (`cmp_iv21`) can fold (TDL-PAIR stage 1), and it is the consumer-side
 * stand-in for per-input source qualification (PND-PROCJOIN).
 *
 * Deliberately rename-then-join, NOT pond's `join(…, { onConflict: 'prefix' })`:
 * pond inserts an implicit `_` separator (`prefixes: ['', 'cmp_']` yields
 * `_iv21` / `cmp__iv21`), which destroys the primary's names — an empty prefix
 * cannot mean "keep the name" (CHARTS_FRICTION F-charts-14).
 *
 * Exact-key caveat: rows join on identical timestamps. Aligned daily grids
 * (both a fixture and a daily feed) match. An intraday feed does NOT — two
 * symbols don't print in the same minutes — and every unmatched primary row
 * leaves its `cmp_*` columns null, which a derive then propagates.
 *
 * The fix is a pre-step, not a different join: `fill(…, { maxGap })` to cap how
 * far a gap may be carried (all-or-nothing, so a real outage stays a gap), then
 * `align(Sequence.every(grain), { method: 'hold' })` on both series so a point
 * exists on every boundary and this join matches by construction. `'hold'`
 * carries the last print; `'linear'` would invent trades between them. Note
 * `align` CREATES ROWS, so a series aligned for rendering is not automatically
 * safe as a derive input — see `TDL-CMPGAP` and F-charts-19.
 */
export function joinUnderPrefix(
  primary: JoinedSeries,
  other: JoinedSeries,
  prefix: string = COMPARE_PREFIX,
): JoinedSeries {
  // Structural, like readNumericColumn: the join runs in the erased schema
  // while pond's rename/join are schema-narrowed.
  const o = other as unknown as {
    schema: readonly { name: string; kind: string }[];
    rename(m: Record<string, string>): unknown;
  };
  const mapping = Object.fromEntries(
    o.schema.filter((col) => col.kind !== 'time').map((col) => [col.name, `${prefix}${col.name}`]),
  );
  const renamed = o.rename(mapping);
  const p = primary as unknown as { join(x: unknown, opts: unknown): unknown };
  return p.join(renamed, { type: 'left' }) as JoinedSeries;
}
