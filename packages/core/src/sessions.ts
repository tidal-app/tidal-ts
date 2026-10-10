import { TimeSeries } from 'pond-ts';
import type { SeriesSchema } from 'pond-ts';
/** A live (non-excised) span of the time axis — everything between spans is
 *  collapsed. Structurally pond's `LiveSegment`. */
export type Segment = readonly [start: number, end: number];

export interface SessionSegmentOptions {
  /**
   * A gap larger than `barMs × gapFactor` starts a new segment. Default `1.5`.
   *
   * Deliberately just above one bar: on a trading-time axis, time with no bar is
   * time that did not trade, and collapsing it is the point. That covers
   * overnight, weekends, holidays and half-days with one rule and no calendar.
   */
  gapFactor?: number;
  /** The bar interval. Inferred from the median gap when omitted, which is
   *  robust to holes as long as under half the bars are missing. */
  barMs?: number;
}

/**
 * Derive the axis's live segments **from the data**, so non-trading time
 * collapses.
 *
 * Good enough for most windows, and **measurably not good enough for short ones**
 * — see {@link exactSessionSegments}, which supersedes this wherever a calendar is
 * available.
 *
 * The threshold is relative to the *median* gap in the window, so it is only right
 * while the median is representative. Measured over the app's own ranges, on daily
 * bars spanning Thanksgiving 2025:
 *
 * | range | bars | median gap | threshold | holiday |
 * | ----- | ---- | ---------- | --------- | ------- |
 * | `5D`  | 5    | 2d         | 3.00d     | **inside a live span → a gap on screen** |
 * | `1M`+ | 21+  | 1d         | 1.50d     | collapsed correctly |
 *
 * At five bars, half the gaps are weekends, so the median is 2 days and a 1-day
 * holiday gap no longer clears the bar. The same holiday therefore renders
 * differently depending on how far you are zoomed out — and a market closure is a
 * property of the market, not of the viewport.
 *
 * This still earns its place: it needs no calendar, it handles a symbol that simply
 * did not print, and intraday it is unambiguous (an overnight gap is ~100× a bar,
 * so no median can blur it). Prefer {@link exactSessionSegments} at daily grain, and
 * keep this for intraday and for any source with no calendar behind it.
 *
 * Why it matters: `weekendSkip()` collapses weekends only. On a year of 1-minute
 * bars that leaves ~190 overnight gaps of ~8 hours on the axis, so each trading
 * day's 6.5 hours occupies about a quarter of its day's width — roughly a 1px
 * stripe separated by 3px of nothing. Most of the axis is empty.
 *
 * Returns `[]` for fewer than two points — the caller should fall back to a
 * continuous axis rather than excise everything.
 */
export function sessionSegments(
  times: readonly number[],
  options: SessionSegmentOptions = {},
): Segment[] {
  const finite = times.filter((t) => Number.isFinite(t));
  if (finite.length < 2) return [];

  // Duplicates are expected — a union of several symbols repeats every shared
  // minute — and a zero gap must not be mistaken for a bar interval.
  const gaps: number[] = [];
  for (let i = 1; i < finite.length; i += 1) {
    const d = finite[i]! - finite[i - 1]!;
    if (d > 0) gaps.push(d);
  }
  if (gaps.length === 0) return [];

  const barMs = options.barMs ?? median(gaps);
  const threshold = barMs * (options.gapFactor ?? 1.5);

  const segments: Segment[] = [];
  let start = finite[0]!;
  let prev = finite[0]!;
  for (let i = 1; i < finite.length; i += 1) {
    const t = finite[i]!;
    if (t - prev > threshold) {
      // Close the run one bar past its last point, so the final bar of a session
      // has width instead of collapsing to a hairline at the boundary.
      segments.push([start, prev + barMs]);
      start = t;
    }
    prev = t;
  }
  segments.push([start, prev + barMs]);
  return segments;
}

/**
 * Live segments by **exact adjacency** — one span per contiguous run of bars.
 *
 * Two bars are in the same span iff the second starts exactly one interval after
 * the first. No threshold, so nothing to tune and — the point — nothing that
 * changes with the window. {@link sessionSegments} compares each gap against the
 * *median* gap in view, which is only right while the median is representative;
 * at five daily bars it is 2 days, and a 1-day holiday gap stops clearing it. This
 * has no median to distort.
 *
 * **Requires dense data**: every interval inside a session must be present, because
 * a single missing bar reads as a session boundary. That holds for daily bars (a
 * trading day either printed or was not a session) and for our 1-minute archive,
 * which is gap-free in session — and it does NOT hold for a sparse or thinly-traded
 * series, where {@link sessionSegments}'s tolerance is the right trade.
 *
 * `starts` must be sorted ascending. Consecutive intervals merge rather than
 * becoming one segment each: adjacent bars have no gap to collapse, and 53 segments
 * a year draw the same axis as 252 for a fraction of the work.
 *
 * It takes the instants it is **given**, which is what makes it work for either
 * input: pass the days you hold and the axis shows real bars; pass a trading
 * calendar and it shows that a session *should* have been there. That choice is the
 * caller's, not this function's.
 *
 * Returns `[]` for an empty input, so a caller falls back rather than excising
 * everything.
 */
export function exactSessionSegments(starts: readonly number[], intervalMs: number): Segment[] {
  const days = starts.filter((t) => Number.isFinite(t));
  if (days.length === 0 || !(intervalMs > 0)) return [];

  const segments: Segment[] = [];
  let start = days[0]!;
  let prev = days[0]!;
  for (let i = 1; i < days.length; i += 1) {
    const t = days[i]!;
    // Adjacent sessions extend the run; anything else — a weekend, a holiday, a
    // day the caller filtered out — closes it. No threshold, so nothing to tune
    // and nothing that changes with the window.
    if (t !== prev + intervalMs) {
      segments.push([start, prev + intervalMs]);
      start = t;
    }
    prev = t;
  }
  segments.push([start, prev + intervalMs]);
  return segments;
}

/**
 * The series' native bar interval, inferred as the **median** gap between keys.
 *
 * Median rather than min or mean: a missing bar doubles one gap and a session
 * boundary multiplies another by hundreds, so anything sensitive to outliers
 * reports nonsense. The median lands on the true interval as long as under half
 * the bars are missing.
 *
 * Returns `undefined` for fewer than two points — the caller should not guess.
 */
export function inferBarMs(times: readonly number[]): number | undefined {
  const finite = times.filter((t) => Number.isFinite(t));
  const gaps: number[] = [];
  for (let i = 1; i < finite.length; i += 1) {
    const d = finite[i]! - finite[i - 1]!;
    if (d > 0) gaps.push(d);
  }
  return gaps.length ? median(gaps) : undefined;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Shift every key forward by `ms`, keeping the values where they are.
 *
 * Exists because **a bar's timestamp is its OPEN, and a line through `close`
 * belongs at the bar's END.** The archive stamps the bar that covers 13:30–13:31
 * as `13:30`, so its `close` is the price at ~13:31; plotting that close at 13:30
 * draws every intraday close one bar early. Uniform, so invisible mid-series —
 * and exactly visible at a session seam, where the day's final close lands at
 * 21:59 instead of 22:00 and the first close of the next session lands on the
 * open instead of a minute after it.
 *
 * Shifting the KEY rather than fixing it at the source is deliberate: a candle
 * needs the span `[open, close]` and draws from the open, so the two styles want
 * different x for the same row. Charts plots a line at the key's `begin`
 * whichever key kind it is, so the only way to move the line is to move the key —
 * and only for the layers that want it moved.
 *
 * **The values are handed over, not walked.** `toArrow()` gives pond's own
 * buffers, a numeric column goes back in as it stands (unless its gaps need
 * marking, below), and only the key buffer is always new. This used to go
 * through `toColumns()`, pond's JSON wire envelope: a plain array per column and
 * a boxed cell at a time. On a 118-column, 97k-row series that cost 239–409 ms;
 * this costs 26–35 ms (Node).
 *
 * It rebuilds through `fromColumns` with the input's own schema, not through
 * `fromArrow`. `fromArrow` takes its schema from the Arrow fields, so every
 * column comes back without `required: false`: a column with gaps would be
 * declared required, and the shifted series could not go back in through its
 * own JSON.
 *
 * A gap is a cleared bitmap bit to `toArrow` and a non-finite value to
 * `fromColumns`, and the slot under a cleared bit can hold anything (pond adopts
 * an Arrow buffer as it stands, and a row-built series leaves its own value
 * there). Such a slot is written `NaN` in a copy, never in pond's buffer. A
 * column with no gaps, or whose gaps already hold `NaN`, is not copied.
 *
 * Still a copy of the key, and still worth a per-fetch memo rather than a render
 * path. Moving a point key without any copy needs a public key offset in pond.
 */
export function shiftKeys(series: TimeSeries<SeriesSchema>, ms: number): TimeSeries<SeriesSchema> {
  if (ms === 0) return series;
  const key = series.schema[0]!;
  // No time key (a range- or interval-keyed series) ⇒ nothing to shift, and
  // shifting the wrong column would corrupt values rather than fail.
  if (key.kind !== 'time') return series;
  // `fromColumns` takes number and string value columns only. Any other kind
  // keeps the envelope route, so it fails (or, if pond's ingest grows, works)
  // exactly as it always has.
  if (series.schema.some((c, i) => i > 0 && c.kind !== 'number' && c.kind !== 'string')) {
    return viaEnvelope(series, key.name, ms);
  }
  const { length, fields } = series.toArrow();
  const columns: Record<string, Float64Array | ReadonlyArray<string | null>> = {};
  for (const f of fields) {
    if (f.name === key.name) {
      // A time key exports as epoch-ms `f64` under `'timestamp'`. Anything else
      // would be read as a value column below and come back unshifted.
      if (f.type !== 'timestamp') return viaEnvelope(series, key.name, ms);
      const shifted = new Float64Array(length);
      for (let i = 0; i < length; i += 1) shifted[i] = f.values[i]! + ms;
      columns[f.name] = shifted;
    } else if (f.type === 'float64') {
      columns[f.name] = numbersWithGaps(f.values, f.nullBitmap, length);
    } else if (f.type === 'utf8') {
      columns[f.name] = stringsWithGaps(f.values, f.nullBitmap, length);
    } else if (f.type === 'dictionary') {
      columns[f.name] = decodeDictionary(f.values, f.dictionary, f.nullBitmap, length);
    } else {
      return viaEnvelope(series, key.name, ms);
    }
  }
  return TimeSeries.fromColumns({
    name: series.name,
    schema: series.schema,
    columns,
  } as never) as unknown as TimeSeries<SeriesSchema>;
}

/** Whether slot `i` is a gap. No bitmap ⇒ every slot is valid. */
const isGap = (bits: Uint8Array | undefined, i: number): boolean =>
  bits !== undefined && (bits[i >> 3]! & (1 << (i & 7))) === 0;

/** The values with every gap non-finite, as `fromColumns` reads a gap. Pond's
 *  buffer when its gaps already are; otherwise a copy. */
function numbersWithGaps(
  values: Float64Array,
  bits: Uint8Array | undefined,
  length: number,
): Float64Array {
  let out = values;
  if (bits === undefined) return out;
  for (let i = 0; i < length; i += 1) {
    if (bits[i >> 3] === 0xff) {
      i += 7; // eight valid slots
      continue;
    }
    if (isGap(bits, i) && Number.isFinite(out[i]!)) {
      if (out === values) out = new Float64Array(values);
      out[i] = NaN;
    }
  }
  return out;
}

/** The strings with every gap `null`. The array as given when its gaps already
 *  are; otherwise a copy. */
function stringsWithGaps(
  values: ReadonlyArray<string | null>,
  bits: Uint8Array | undefined,
  length: number,
): ReadonlyArray<string | null> {
  let out: (string | null)[] | undefined;
  if (bits === undefined) return values;
  for (let i = 0; i < length; i += 1) {
    if (isGap(bits, i) && values[i] != null) {
      out ??= values.slice();
      out[i] = null;
    }
  }
  return out ?? values;
}

/** A dictionary-encoded string column as the plain array `fromColumns` takes. */
function decodeDictionary(
  indices: Int32Array,
  dictionary: ReadonlyArray<string>,
  bits: Uint8Array | undefined,
  length: number,
): (string | null)[] {
  const out = new Array<string | null>(length);
  for (let i = 0; i < length; i += 1) out[i] = isGap(bits, i) ? null : dictionary[indices[i]!]!;
  return out;
}

/** The old route, through pond's JSON envelope. Kept for the column kinds
 *  `fromColumns` does not take. */
function viaEnvelope(
  series: TimeSeries<SeriesSchema>,
  key: string,
  ms: number,
): TimeSeries<SeriesSchema> {
  const out = (series as unknown as { toColumns(): ColumnarOut }).toColumns();
  const src = out.columns[key] as ArrayLike<number>;
  const shifted = new Float64Array(src.length);
  for (let i = 0; i < src.length; i += 1) shifted[i] = src[i]! + ms;
  return TimeSeries.fromColumns({
    ...out,
    columns: { ...out.columns, [key]: shifted },
  } as never) as unknown as TimeSeries<SeriesSchema>;
}

interface ColumnarOut {
  name: string;
  schema: readonly { name: string; kind: string }[];
  columns: Record<string, unknown>;
}

/**
 * The series cut into one sub-series per live segment — `[start, end)` on the
 * time key, empty segments dropped.
 *
 * For the layer pond gives no `sessionBreaks` of its own — `<AreaChart>`
 * (`<LineChart>` has always had it; `<BandChart>` gained it in charts 0.70.0,
 * which retired this function's other caller). A fill drawn across a
 * collapsed overnight gap bridges seventeen hours of closed market in one
 * confident sweep and contradicts the line drawn over it; one layer per segment
 * ends the fill at the close and restarts it at the open, which is what that
 * line already does. The cost is `segments.length` layers instead of one, so a
 * caller asks only when the axis actually collapses.
 *
 * Pond does the cutting — `bisect` finds each edge in O(log n) on the packed key
 * buffer and `slice` is positional and half-open — so nothing here is
 * materialised or rebuilt. Segments must be ascending and non-overlapping, which
 * is what `sessionSegments` / `exactSessionSegments` produce; no segments means
 * nothing is known to be closed, and the series comes back whole.
 *
 * **Cut before you shift.** A series whose keys were moved to the bar's END
 * (`shiftKeys`) puts every session's last point exactly ON its segment's end,
 * which the half-open bound excludes — one close lost per session, at the seam,
 * where it shows. Slice the raw series and shift each slice.
 */
export function sliceBySegments(
  series: TimeSeries<SeriesSchema>,
  segments: readonly Segment[],
): TimeSeries<SeriesSchema>[] {
  if (segments.length === 0) return [series];
  const s = series as unknown as {
    bisect(key: number): number;
    slice(begin: number, end: number): TimeSeries<SeriesSchema>;
  };
  const out: TimeSeries<SeriesSchema>[] = [];
  for (const [start, end] of segments) {
    const lo = s.bisect(start);
    const hi = s.bisect(end);
    if (hi > lo) out.push(s.slice(lo, hi));
  }
  return out;
}

/**
 * The price path a session actually traced: its **open**, then every close.
 *
 * A line of closes alone starts a minute late. The bar covering 15:30–15:31 has
 * its close at 15:31, so a close-keyed line's first point is 15:31 — while the
 * axis holds 15:30 as live time with nothing drawn on it. The opening print is a
 * real observed price at 15:30, and omitting it is a consequence of picking one
 * column, not of what happened.
 *
 * So each session contributes `bars + 1` points: `(open time, open)` followed by
 * one `(close time, close)` per bar. Every point remains an observation — the
 * price at 15:30 was the open, at 15:31 the first close, at 15:32 the second — and
 * the line now spans the whole live segment instead of starting inside it.
 *
 * Emits ONE column, named after `close`, so a chart already asking for that column
 * needs no change. Only a series carrying both columns can use this; a vol series
 * has no open, and its line keeps the shifted closes (see {@link shiftKeys}).
 *
 * A session boundary is a key gap wider than `barMs × gapFactor` — the same rule
 * {@link sessionSegments} uses, so the two cannot disagree about where a session
 * starts.
 */
export function sessionOpenLine(
  series: TimeSeries<SeriesSchema>,
  barMs: number,
  columns: { open: string; close: string },
  gapFactor = 1.5,
): TimeSeries<SeriesSchema> {
  const out = (series as unknown as { toColumns(): ColumnarOut }).toColumns();
  const keyName = out.schema.find((c) => c.kind === 'time')?.name;
  const opens = out.columns[columns.open] as ArrayLike<number | null> | undefined;
  const closes = out.columns[columns.close] as ArrayLike<number | null> | undefined;
  if (keyName === undefined || !opens || !closes) return series;
  const keys = out.columns[keyName] as ArrayLike<number>;
  const n = keys.length;

  const t: number[] = [];
  const v: (number | null)[] = [];
  const threshold = barMs * gapFactor;
  for (let i = 0; i < n; i += 1) {
    // A session start: the first bar, or one whose predecessor is a gap away.
    if (i === 0 || keys[i]! - keys[i - 1]! > threshold) {
      t.push(keys[i]!);
      v.push(opens[i] ?? null);
    }
    t.push(keys[i]! + barMs);
    v.push(closes[i] ?? null);
  }
  return TimeSeries.fromColumns({
    name: out.name,
    schema: [
      { name: keyName, kind: 'time' },
      { name: columns.close, kind: 'number' },
    ],
    columns: { [keyName]: t, [columns.close]: v },
  } as never) as unknown as TimeSeries<SeriesSchema>;
}
