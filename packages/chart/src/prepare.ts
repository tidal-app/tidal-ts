import { applyDerived, COMPARE_PREFIX, joinUnderPrefix, usesCompare } from '@tidal-ts/core';
import type { DeriveSpec } from '@tidal-ts/core';
import { configColumns, type SeriesConfig } from './series.js';
import type { ChartSeries } from './types.js';
import { finiteColumns, lastRow } from './seriesFacts.js';

/**
 * The **prepare step**: from the host's raw series and its seated configs to
 * what the chart eats. Pure functions, so a host memoises each at the grain it
 * needs — the fold is the expensive one and must not re-run on a recolour; the
 * row assembly is cheap and re-runs whenever the configs do.
 *
 * Three moves, in order:
 *
 * 1. {@link foldSources} — join the comparison series under the compare prefix
 *    where a config asks for it, then fold every study spec onto its source so
 *    the derived columns exist before the chart reads them.
 * 2. {@link sourceFacts} — read, columnar, which columns actually carry data
 *    and what the latest bar holds.
 * 3. {@link assembleRows} — per row, the configs the data can honour (plus the
 *    ones that must stay listed even when it cannot), each stamped with its
 *    latest value.
 *
 * {@link prepareChart} is the three in one call for a host that does not need
 * the memo split.
 */

/** One keyed source as the host holds it: the primary series, and the
 *  comparison entity's series when a comparison is on. */
export interface SourceInput {
  series: ChartSeries;
  compare?: ChartSeries | null;
}
export type SourceInputs = Record<string, SourceInput>;

/** A row of seated configs — the shape the terminal machine holds. */
export interface ConfigRow {
  id: string;
  configs: readonly SeriesConfig[];
}

/** A prepared row: the configs the chart and the chips should see, valued. */
export interface PreparedRow {
  id: string;
  configs: SeriesConfig[];
}

/** What the folded sources carry, read columnar (never `toObjects()`). */
export interface SourceFacts {
  /** Per source: the columns with at least one finite value. */
  columns: Record<string, ReadonlySet<string>>;
  /** Per source: the last bar, as a plain row. Absent for an empty series. */
  last: Record<string, Readonly<Record<string, number>>>;
}

const specsBySource = (configs: readonly SeriesConfig[]): Record<string, DeriveSpec[]> => {
  const m: Record<string, DeriveSpec[]> = {};
  for (const c of configs) if (c.derive && c.source) (m[c.source] ??= []).push(c.derive);
  return m;
};

/** Sources with a config reading a RAW compare column — a split pair's leg,
 *  which carries no spec at all but needs the compare join exactly as a
 *  compare-bound spec does. (Asking only the specs left such a leg reading a
 *  column nothing ever joined on: it drew nothing and, having no `derive`, was
 *  filtered out of the panel too — an invisible, unremovable leg.) */
const rawCompareSources = (configs: readonly SeriesConfig[]): string[] =>
  [
    ...new Set(
      configs
        .filter((c) => c.source && !c.derive && c.column.startsWith(COMPARE_PREFIX))
        .map((c) => c.source!),
    ),
  ].sort();

/**
 * A stable string of everything {@link foldSources} depends on in the configs —
 * the specs per source and the raw-compare set — so a host can key its fold
 * memo on this rather than on the configs' identity, and a recolour, a
 * reorder, a visibility toggle never re-fold. Two config lists that differ only
 * in presentation or order yield the same key: the fold is dependency-ordered
 * inside the engine, so the order the specs arrive in cannot change its result,
 * and the key sorts them (by content) so a reorder cannot change the key either.
 */
export function foldKey(configs: readonly SeriesConfig[]): string {
  const bySource = specsBySource(configs);
  const sorted = Object.fromEntries(
    Object.keys(bySource)
      .sort()
      .map((source) => [source, bySource[source]!.map((spec) => JSON.stringify(spec)).sort()]),
  );
  return JSON.stringify([sorted, rawCompareSources(configs)]);
}

/**
 * The fold: each source, joined with its comparison under the compare prefix
 * when any config on it asks (a compare-bound spec, or a raw compare leg), then
 * every study spec on it applied so the derived columns exist. A spec whose
 * inputs are missing is skipped by the engine and simply yields no column — the
 * chart's column-absence handling is the render half of that contract, and
 * {@link assembleRows} keeps the config listed so the user can still remove it.
 *
 * Only sources present in `inputs` are produced; a config naming an absent
 * source is the caller's affair (it will not be carried).
 */
export function foldSources(
  inputs: SourceInputs,
  configs: readonly SeriesConfig[],
): Record<string, ChartSeries> {
  const specs = specsBySource(configs);
  const rawCompare = new Set(rawCompareSources(configs));
  const out: Record<string, ChartSeries> = {};
  for (const [key, input] of Object.entries(inputs)) {
    const mine = specs[key] ?? [];
    let series = input.series;
    // A compare-bound leg needs the compare entity's columns on the PRIMARY
    // series before the fold — a left exact-key join, every conflicting column
    // prefixed. Only when asked and the compare series exists; otherwise the
    // fold's own skip leaves the spread as a gap (compare off ⇒ not drawn).
    // Rename-then-join lives in core (`joinUnderPrefix`; F-charts-14 for why
    // not the library's `onConflict: 'prefix'`).
    if (input.compare && (rawCompare.has(key) || mine.some(usesCompare)))
      series = joinUnderPrefix(series, input.compare);
    out[key] = applyDerived(series, mine);
  }
  return out;
}

/** Per-source data facts, read columnar: which columns carry real (finite)
 *  values ("show only what the data carries") and the latest bar (the chip /
 *  controls value readout). One `toObjects()` pass per source here was the
 *  single largest cost of a range change at intraday scale (`seriesFacts.ts`
 *  has the measurements). */
export function sourceFacts(sources: Record<string, ChartSeries>): SourceFacts {
  const columns: Record<string, ReadonlySet<string>> = {};
  const last: Record<string, Readonly<Record<string, number>>> = {};
  for (const [key, series] of Object.entries(sources)) {
    columns[key] = finiteColumns(series);
    const row = lastRow(series);
    if (row) last[key] = row;
  }
  return { columns, last };
}

/** Whether a config's columns exist in its folded source — the "this config
 *  draws" predicate. A derived spec that did not fold is CONFIGURED but not
 *  CARRIED: anything reading "what is on the canvas" (dimming, the price pill,
 *  an axis panel's drawn set) tests this, not mere visibility.
 *
 *  `configColumns`, not `c.column`: a multi-output config's column is a spec id
 *  naming NONE of its own columns, so testing it directly said "not carried" for
 *  every band and every multi-output study — a MACD's chip sat blank while the
 *  hover readout, which reads the series itself, showed a value. `every`,
 *  because one op's fold either produces all its outputs or none. */
export function carries(
  facts: SourceFacts,
  c: Pick<SeriesConfig, 'source' | 'column' | 'style' | 'derive'>,
): boolean {
  const cols = c.source ? facts.columns[c.source] : undefined;
  if (!cols) return false;
  return configColumns(c).every((col) => cols.has(col));
}

/**
 * Per row, the configs to show, each stamped with its latest value (or `null`).
 *
 * A raw metric is kept only when the data carries its column — a feed lacking
 * a column hides the series rather than drawing nothing. A DERIVED config is
 * kept even when its spec did not fold (compare off, a leg's column gone): its
 * value reads `—` and the chart just does not draw it. Silently dropping it was
 * the "ghost spread" debt — a seated series with no visible trace that nothing
 * could remove. A LEG-GROUP member is kept for the same reason even when raw:
 * it is half of a pair the user built, so it stays listed (dimmed, by the
 * host) rather than vanishing.
 *
 * The raw-metric test is {@link carries} (every declared output), where the
 * terminal used to test the bare `column`. Equivalent for every reachable
 * config — a band or multi-output study always carries `derive`, which keeps
 * it listed regardless — and one predicate rather than two for "does the data
 * carry this", so the chip and the canvas cannot disagree.
 */
export function assembleRows(rows: readonly ConfigRow[], facts: SourceFacts): PreparedRow[] {
  return rows.map((row) => ({
    id: row.id,
    configs: row.configs
      .filter((c) => carries(facts, c) || !!c.derive || !!c.group)
      .map((c) => ({
        ...c,
        // The PRIMARY output's column, not `c.column`: a multi-output config's
        // column is a spec id naming none of its columns, so reading it directly
        // left the chip blank. `configColumns` returns the declared outputs in
        // order, so `[0]` is the reading the study is named for (a band's
        // centre, a MACD's line).
        value:
          (c.source ? facts.last[c.source] : undefined)?.[configColumns(c)[0] ?? c.column] ?? null,
      })),
  }));
}

/** The whole prepare step in one call, for a host that does not need the memo
 *  split: fold, read the facts, assemble the rows. */
export function prepareChart(
  inputs: SourceInputs,
  rows: readonly ConfigRow[],
): { sources: Record<string, ChartSeries>; facts: SourceFacts; rows: PreparedRow[] } {
  const sources = foldSources(
    inputs,
    rows.flatMap((r) => r.configs),
  );
  const facts = sourceFacts(sources);
  return { sources, facts, rows: assembleRows(rows, facts) };
}
