import { TimeSeries, type SeriesSchema } from 'pond-ts';
import { buildVolSeries, VOL_SCHEMA, type VolSeries } from './vol.js';

/**
 * Hold a **coarse** vol series at a **finer** grid — the daily ATM curve drawn on
 * an intraday axis.
 *
 * The archive has no intraday vol (finest is 30-minute surfaces, and none of them
 * loaded), so a 1-minute request returns a vol series with *no vol columns at
 * all* — the panel goes blank. That reads as breakage, when the honest answer is
 * "we know this daily, and here it is". So the service fetches vol at the finest
 * grain that has it and this holds each daily value across that day's bars.
 *
 * A **step function**, deliberately, and not interpolation. The daily ATM vol is
 * one observation attributed to a session; drawing a slope between two of them
 * would invent intraday structure we have no evidence for and that the surface
 * datasets would contradict once loaded. A flat segment says "constant as far as
 * we know", which is true.
 *
 * ## Why the coarse series cannot simply be handed to the chart
 *
 * A daily series keyed at UTC midnight, placed on an axis built from 1-minute
 * bars, poisons the axis rather than the panel: `TimeSeriesChart` derives its trading
 * sessions from the **union** of every source's timestamps, so midnight — which is
 * not a trading minute — would enter the session model, and the inferred bar
 * interval would be a mix of one day and one minute. Regridding first means the
 * two series share one grid and the axis sees only real trading minutes.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC midnight a timestamp belongs to — the daily series' own key. */
const dayOf = (t: number): number => Math.floor(t / DAY_MS) * DAY_MS;

/** The structural column read the hold needs, in the erased schema. */
type HeldColumn = { at(i: number): unknown };

/**
 * Re-key `coarse` onto `grid`, holding each row across the grid points inside
 * its own bar. **Every column comes through**, whatever the schema: the vol
 * curve's, a joined comparison's (`cmp_*`), a study's.
 *
 * This is the hold to use on a series that has already been **folded** — a
 * study, or a compare join, computed at the coarse series' own grain. Fold
 * first, then hold, never the other way round: a 20-bar average of a daily
 * series held across one-minute bars is a 20-*minute* average of a step, and
 * reads that day's raw value rather than the average. A join is the same
 * shape: joining two daily series is ~250 rows a year, and joining them after
 * the hold is ~100,000.
 *
 * A row holds over `[key, key + grainMs)`, and only until the next row starts.
 * So a grid point takes the **last row at or before it**, provided it is still
 * inside that row's bar; past the bar it is a gap. That makes three promises:
 *
 * - **No look-ahead.** A grid point never reads a bar that starts after it,
 *   whatever the coarse bars' phase. (Flooring both sides to a multiple of
 *   `grainMs` would break this for an hourly bar that starts at :30.)
 * - **A gap stays a gap.** A day the coarse series has no row for is `NaN`
 *   (`undefined` for a string column) across that day, not the day before's
 *   value carried on. "Nothing published for this session" is not "the same
 *   as yesterday".
 * - **A restatement wins.** Rows sharing a key: the later one holds.
 *
 * It assumes the coarse keys mark the **start** of each bar, which is how a
 * daily series keyed at midnight reads.
 *
 * `grid` must be ascending — a series' own keys are; `series.keyColumn().begin`
 * hands them over without a copy. The coarse series must be keyed by `time`,
 * and its value columns must be `number` or `string` (what
 * `TimeSeries.fromColumns` can take back); anything else throws, naming the
 * column, rather than dropping it.
 *
 * Returns `coarse` unchanged when there is nothing to hold onto: an empty grid
 * or an empty series.
 */
export function holdAcrossGrid<S extends SeriesSchema>(
  coarse: TimeSeries<S>,
  grid: ArrayLike<number>,
  grainMs: number,
): TimeSeries<S> {
  if (grid.length === 0 || coarse.length === 0) return coarse;
  const [keySpec, ...valueSpecs] = coarse.schema as unknown as readonly {
    name: string;
    kind: string;
  }[];
  if (keySpec!.kind !== 'time')
    throw new Error(
      `holdAcrossGrid: "${coarse.name}" is keyed by ${keySpec!.kind}; only a time key can be held`,
    );

  // One walk of both key buffers: for each grid point, the source row it holds
  // (`-1` for a gap). Shared by every column below, so the per-column work is a
  // plain gather.
  const keys = (coarse.keyColumn() as unknown as { begin: Float64Array }).begin;
  const rows = new Int32Array(grid.length);
  let j = -1;
  for (let i = 0; i < grid.length; i += 1) {
    const t = grid[i]!;
    while (j + 1 < keys.length && keys[j + 1]! <= t) j += 1;
    rows[i] = j >= 0 && t < keys[j]! + grainMs ? j : -1;
  }

  const columns: Record<string, Float64Array | (string | undefined)[]> = {
    [keySpec!.name]: Float64Array.from(grid),
  };
  for (const spec of valueSpecs) {
    const src = (coarse as unknown as { column(n: string): HeldColumn }).column(spec.name);
    if (spec.kind === 'number') {
      // Through `at`, not `toFloat64Array()`: the raw buffer does not mark a
      // missing cell (a join's unmatched row reads 0 there). The coarse side is
      // the short one, so this is a few hundred reads.
      const values = new Float64Array(coarse.length);
      for (let r = 0; r < coarse.length; r += 1) {
        const v = src.at(r);
        values[r] = typeof v === 'number' ? v : NaN;
      }
      const out = new Float64Array(grid.length);
      for (let i = 0; i < grid.length; i += 1) {
        const r = rows[i]!;
        out[i] = r < 0 ? NaN : values[r]!;
      }
      columns[spec.name] = out;
    } else if (spec.kind === 'string') {
      const out = new Array<string | undefined>(grid.length);
      for (let i = 0; i < grid.length; i += 1) {
        const r = rows[i]!;
        out[i] = r < 0 ? undefined : (src.at(r) as string | undefined);
      }
      columns[spec.name] = out;
    } else {
      throw new Error(
        `holdAcrossGrid: column "${spec.name}" of "${coarse.name}" is ${spec.kind}; only number and string columns can be held`,
      );
    }
  }
  type FromColumnsInput = Parameters<typeof TimeSeries.fromColumns>[0];
  return TimeSeries.fromColumns({
    name: coarse.name,
    schema: coarse.schema as unknown as FromColumnsInput['schema'],
    columns: columns as unknown as FromColumnsInput['columns'],
  }) as unknown as TimeSeries<S>;
}

/**
 * Re-key `coarse` onto `times`, holding each source row across every target
 * timestamp that falls on its day.
 *
 * `times` must be ascending (the price series' own keys). A target day the coarse
 * series has no row for yields `NaN` across that day, which the chart reads as a
 * gap rather than as zero — correct, since "no vol published for this session" is
 * not "vol was nothing".
 *
 * Returns the coarse series unchanged when there is **nothing to hold** — an empty
 * target grid, or an empty source.
 *
 * It does NOT short-circuit a source that is already as dense as the target; an
 * earlier version of this sentence claimed it did, and did not. Today that path is
 * unreachable (`volGrains` is `['1d']` everywhere, so the fallback grain is always
 * coarser), but `resolveGrain` does not guarantee it: a source declaring
 * `volGrains: ['30m']` answers a `1d` request with `'30m'` via its
 * last-resort branch, and this would then re-key a 30-minute series onto a daily
 * grid, silently keeping each day's LAST intraday value.
 *
 * @deprecated Use {@link holdAcrossGrid}, which keeps every column. This one
 * emits `VOL_SCHEMA` columns only, so holding a folded series with it silently
 * drops each joined comparison column and each study.
 */
export function holdVolAcrossGrid(
  coarse: VolSeries,
  times: readonly number[],
  name = 'vol',
): VolSeries {
  if (times.length === 0 || coarse.length === 0) return coarse;

  // Row index per source day. Later rows win: a day appearing twice is a
  // restatement (a daily-history feed does restate `ccVar`), and the newer value is
  // the one to hold.
  const key = coarse.keyColumn() as unknown as { at(i: number): number | undefined };
  const rowOfDay = new Map<number, number>();
  for (let i = 0; i < coarse.length; i += 1) {
    const t = key.at(i);
    if (t !== undefined) rowOfDay.set(dayOf(t), i);
  }

  // Read every schema column once, then walk the target grid per column. Column
  // access is the cheap direction here (columnar storage), and the day lookup is
  // shared across columns via `rows` below.
  const rows: (number | undefined)[] = times.map((t) => rowOfDay.get(dayOf(t)));

  const columns: Record<string, number[]> = { time: [...times] };
  for (const spec of VOL_SCHEMA) {
    if (spec.name === 'time') continue;
    const src = coarse.column(spec.name) as unknown as
      { at(i: number): number | undefined } | undefined;
    // Every `VOL_SCHEMA` column is emitted whether the source has it or not:
    // `buildVolSeries` requires the full schema, and keeping the vol series' TYPE
    // stable is worth more than signalling absence through a missing column. A
    // column the source lacks comes through as all-NaN, which the chart reads as a
    // series with no points — an empty layer, not a wrong one.
    const out = new Array<number>(times.length);
    for (let i = 0; i < times.length; i += 1) {
      const r = src === undefined || rows[i] === undefined ? undefined : src.at(rows[i]!);
      out[i] = typeof r === 'number' && Number.isFinite(r) ? r : NaN;
    }
    columns[spec.name] = out;
  }
  return buildVolSeries(name, columns);
}
