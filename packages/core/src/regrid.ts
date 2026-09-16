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
