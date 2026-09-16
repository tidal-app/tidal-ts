import { BoundedSequence, Interval, Sequence, TimeSeries } from 'pond-ts';
import { DATA_TIME_ZONE } from './timeZone.js';
import type { SeriesSchema } from 'pond-ts';
import type { Segment } from './sessions.js';

/**
 * Time-window aggregation for chart styles that bin a continuous series — bars
 * and coarser-than-native candles (OHLC roll-ups). Pond does the windowing
 * (`TimeSeries.aggregate` over a grid); this module is the thin, typed seam
 * Tidal renders against, and it owns the one thing a calendar grid cannot know
 * for a trading chart: **what a "day" means once the bars are intraday** — a
 * session, not a midnight-to-midnight span.
 *
 * It used to own a second thing, **which bucket the first bar lands in**: pond
 * dropped every event before its first emitted bucket, so this module floored
 * the aggregation range by hand (F-charts-16). `pond-ts` 0.64.0 fixed that in
 * the default, and the compensation is gone.
 *
 * A **calendar** window bins via `Sequence.calendar` — `'1d'` (one day), `'1w'`
 * (a calendar week, Monday-anchored), or `'1mo'` (a calendar month), anchored to
 * `UTC` boundaries, which match our UTC-midnight daily bars. A **fixed-duration**
 * window (`'1m'` / `'5m'` / `'1h'`) is instead subdivided inside each session.
 *
 * Kept pure + React-free in `@tidal-ts/core` so it can move to `@pond-ts/finance`.
 */

/** The window a bar/box bins into.
 *
 *  Two families, and the difference decides how the bucket is built: `'1m'` /
 *  `'5m'` / `'1h'` are **fixed durations** subdivided inside a session, while
 *  `'1d'` / `'1w'` / `'1mo'` are **calendar spans** made of whole sessions.
 *
 *  **Not** "the native bar": `'1d'` is one day, which is native only for daily
 *  data. On intraday data a `'1d'` window is a real roll-up of ~390 bars, and code
 *  that treats `'1d'` as a no-op draws one mark per minute instead of per day. */
export type SeriesWindow = '1m' | '5m' | '1h' | '1d' | '1w' | '1mo';

/** Approximate span of each window, for deciding whether it is coarser than the
 *  data's native interval. Approximate is enough — months vary, and this only
 *  ever answers "is this window bigger than one bar?" */
export const WINDOW_MS: Record<SeriesWindow, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '1h': 3_600_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
  '1mo': 2_592_000_000,
};

/** The window ladder, finest → coarsest — the order {@link autoBarWindow} steps
 *  through. Derived from {@link WINDOW_MS} rather than restated, so a new window
 *  token cannot be added to one and forgotten in the other. */
export const WINDOW_LADDER: readonly SeriesWindow[] = (
  Object.keys(WINDOW_MS) as SeriesWindow[]
).sort((a, b) => WINDOW_MS[a] - WINDOW_MS[b]);

/** How wide a bar has to be, in CSS px, to be worth drawing as a bar. Three is
 *  the smallest that survives a device-pixel grid with a gap either side; below
 *  it, neighbouring bars share pixels and the last one drawn wins. */
export const MIN_BAR_PX = 3;

/** Bars a window yields from `bars` source bars spaced `nativeMs` apart. Counts
 *  the SOURCE bars rather than the calendar span, because a calendar estimate
 *  over trading-day data is 7/5 too high — it counts weekends that carry no bar,
 *  and coarsens a year of dailies that would have fitted. */
function barsAtWindow(bars: number, nativeMs: number, window: SeriesWindow): number {
  const span = WINDOW_MS[window];
  if (!(span > nativeMs)) return bars;
  return Math.max(1, Math.ceil((bars * nativeMs) / span));
}

/**
 * The finest window whose bars are at least `minPx` wide — the fix for bars
 * drawn narrower than a pixel.
 *
 * **Why this exists.** A rise/fall bar is drawn as two layers (the library takes
 * one fill per series; F-charts-12), fall on top. Once bars go sub-pixel they
 * share pixel columns, and the upper layer wins every shared column — so a series
 * that is 47.5% down days renders 82% red. Measured on AAPL's full history:
 * ~42–43% red pixels while bars stayed above 4.5px, climbing to 50% at 0.9px and
 * 82% at 0.31px. The colour was reporting bar density, not the market.
 *
 * Re-ordering the layers only moves the lie to the other colour, and per-pixel
 * blending would average two categorical colours into a third that means nothing.
 * The honest fix is to stop asking for more bars than there are pixels: roll up to
 * a window that fits, where each bar's direction is its own bucket's `open`→
 * `close` — a real weekly or monthly candle rather than an accident of overdraw.
 *
 * Never goes finer than the data (`nativeMs`) — coarser is the only direction,
 * and it is forced by the pixels.
 *
 * This decides only the AUTO case. A series whose window the user set explicitly
 * is drawn at that window, overdraw included: the control panel names the window,
 * and a control that says `1D` while the canvas draws months is a worse failure
 * than the one being fixed. Auto is the default, and says "Auto".
 */
export function autoBarWindow(opts: {
  /** Source bars in view. */
  bars: number;
  /** Their spacing, ms. */
  nativeMs: number;
  /** Plot width, CSS px. */
  widthPx: number;
  /** Minimum drawable bar width. Default {@link MIN_BAR_PX}. */
  minPx?: number;
}): SeriesWindow {
  const { bars, nativeMs, widthPx, minPx = MIN_BAR_PX } = opts;
  const usable = WINDOW_LADDER.filter((w) => WINDOW_MS[w] >= (nativeMs > 0 ? nativeMs : 0));
  // The path for a zero/unknown width too: undecidable, so change nothing.
  const finest = usable[0] ?? WINDOW_LADDER[WINDOW_LADDER.length - 1]!;
  if (!(widthPx > 0) || !(bars > 0)) return finest;
  return (
    usable.find((w) => barsAtWindow(bars, nativeMs, w) * minPx <= widthPx) ??
    usable[usable.length - 1] ??
    finest
  );
}

/** A single-column aggregation reducer name (a pond built-in). The subset Tidal
 *  actually offers a bar; the fuller set lives in pond. */
export type BarReducer = 'sum' | 'avg' | 'min' | 'max' | 'first' | 'last';

/** Window token → pond calendar unit. Calendar windows only. */
const CAL_UNIT = { '1d': 'day', '1w': 'week', '1mo': 'month' } as const;

/** The fixed-duration windows, and their step. A window in here is subdivided
 *  *within* a session rather than aligned to a calendar boundary. */
const SUB_DAY_MS = { '1m': 60_000, '5m': 300_000, '1h': 3_600_000 } as const;

const isSubDay = (w: SeriesWindow): w is keyof typeof SUB_DAY_MS => w in SUB_DAY_MS;

const buildGrid = (window: SeriesWindow): Sequence =>
  isSubDay(window)
    ? // Epoch-anchored fixed steps — the sessionless fallback. Buckets straddle
      // the close here, which is why a session grid is preferred when there is one.
      Sequence.every(SUB_DAY_MS[window])
    : // Calendar-aware buckets in UTC (our daily bars are UTC-midnight). Weeks are
      // Monday-anchored (`weekStartsOn: 1`); ignored for day/month.
      Sequence.calendar(CAL_UNIT[window], {
        timeZone: DATA_TIME_ZONE,
        weekStartsOn: 1,
      });

/** One grid per window token. `buildGrid` is deterministic in its argument, and
 *  `floorToWindow` asks for a grid per session, so building them once keeps that
 *  loop to a lookup. */
const GRIDS = new Map<SeriesWindow, Sequence>();

const gridFor = (window: SeriesWindow): Sequence => {
  const held = GRIDS.get(window);
  if (held) return held;
  const built = buildGrid(window);
  GRIDS.set(window, built);
  return built;
};

/**
 * The start of the bucket **containing** `t`, on the same grid `gridFor` walks.
 *
 * Asked of pond rather than computed here. This used to hand-roll the UTC
 * day / Monday-week / month flooring, which meant keeping a second
 * implementation of `Sequence.calendar`'s anchoring in step with pond's by
 * eye — duplication we carried only to compensate for F-charts-16. `pond-ts`
 * 0.64.0 exposes the flooring primitive directly: a single-instant range under
 * `coverage: 'overlap'` selects exactly the bucket containing that instant. So
 * the floor is now the grid's own answer, and the two agree by construction
 * instead of by maintenance.
 *
 * Still needed after F-charts-16's fix — {@link sessionGrid} and
 * {@link liveWindowMs} key sessions by the calendar bucket their open falls in,
 * which is a domain question, not a workaround.
 */
export function floorToWindow(t: number, window: SeriesWindow): number {
  // Guard the input BEFORE pond does. It throws its own `TypeError` on a
  // non-finite start, which is right — but it fires before the diagnostic
  // below, and that diagnostic would itself throw building `new
  // Date(NaN).toISOString()`. Say which value and which window, once (PR #173
  // review). The arithmetic this replaced returned `NaN` and let it spread.
  if (!Number.isFinite(t)) throw new Error(`floorToWindow: ${t} is not a timestamp (${window})`);
  const bucket = gridFor(window).bounded({ start: t, end: t }, { coverage: 'overlap' }).first();
  // `'overlap'` on a single instant is documented to return exactly the bucket
  // containing it; a miss would mean a pond contract change, and silently
  // returning the wrong bucket is the failure mode F-charts-16 taught us to
  // refuse.
  if (!bucket) throw new Error(`no ${window} bucket contains ${new Date(t).toISOString()}`);
  return bucket.begin();
}

/**
 * Buckets shaped like **trading sessions** rather than calendar spans — the grid
 * an intraday series must roll up on.
 *
 * A calendar day is the wrong bucket for intraday bars in three separate ways,
 * all of which a session bucket fixes:
 *
 * 1. **It spans time that did not trade.** A `[00:00, 24:00)` bucket is mostly
 *    closed market. The candle drawn over it stretches across the collapsed
 *    overnight seam of a trading-time axis, so the body is wider than the session
 *    it describes.
 * 2. **Its midpoint is not a live instant.** Noon UTC is inside the overnight
 *    gap, so anything that anchors on the slot centre — the crosshair readout —
 *    clamps out of the gap onto the session open and lands on the candle's left
 *    edge instead of its middle.
 * 3. **It splits a session across buckets it does not mean to.** A session that
 *    runs past midnight UTC lands half in each calendar day, so one trading
 *    session draws as two candles. Keying a session by the bucket its OPEN falls
 *    in keeps it whole.
 *
 * The two window families divide the sessions in opposite directions:
 *
 * - **Coarser than a session** — `'1d'` is one bucket per session; `'1w'` /
 *   `'1mo'` group the sessions of a calendar week / month into one bucket
 *   spanning `[first open, last close)`, so a bucket still contains only
 *   sessions, never the weekend between them.
 * - **Finer than a session** — `'1m'` / `'5m'` / `'1h'` subdivide each session
 *   into fixed steps **anchored on the session open**, with the last step of a
 *   session clipped to its close.
 *
 * Anchoring on the open rather than the epoch is the trading convention and it
 * matters at `'1h'`: US equities open at 13:30 UTC, so an epoch-anchored hourly
 * grid would cut a 30-minute stub at 14:00 and put the open in the middle of a
 * bucket, where a session-anchored one runs 13:30–14:30 like every terminal
 * draws it. (At `'5m'` the two coincide — 13:30 is already a 5-minute multiple —
 * which is exactly the kind of coincidence that hides the rule.) Clipping the
 * last step keeps a short final bar instead of letting a bucket run past the
 * close into collapsed time.
 *
 * Returns `undefined` for no segments, so the caller falls back to the calendar
 * grid rather than aggregating over nothing.
 */
export function sessionGrid(
  segments: readonly Segment[],
  window: SeriesWindow,
): BoundedSequence | undefined {
  if (segments.length === 0) return undefined;
  if (isSubDay(window)) {
    const step = SUB_DAY_MS[window];
    const steps: Interval[] = [];
    for (const [start, end] of segments)
      for (let t = start; t < end; t += step)
        steps.push(new Interval({ value: t, start: t, end: Math.min(t + step, end) }));
    return new BoundedSequence(steps);
  }
  const groups = new Map<number, [start: number, end: number]>();
  for (const [start, end] of segments) {
    const key = floorToWindow(start, window);
    const held = groups.get(key);
    // A session is keyed by the bucket its OPEN falls in, so a session that runs
    // past midnight UTC stays with the day it opened rather than splitting.
    if (held) held[1] = Math.max(held[1], end);
    else groups.set(key, [start, end]);
  }
  const intervals = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, [start, end]]) => new Interval({ value: start, start, end }));
  return new BoundedSequence(intervals);
}

/**
 * How much **live** time one bucket of `window` covers — the unit a
 * trading-time axis measures durations in, and therefore the unit a zoom limit
 * has to be expressed in.
 *
 * A calendar day is 24 hours; the session inside it is 6.5, and the axis has
 * excised the other 17.5. So a zoom floor of "five days" reads on screen as five
 * days of *trading*, which is nineteen sessions — nearly four times the intended
 * span. The fixed-duration windows have no such gap (a five-minute step inside a
 * session is five live minutes), which is why only the calendar family needs
 * this.
 *
 * Measured from the sessions rather than assumed: the median bucket's live span,
 * where a bucket's span is the session time inside it. That way a half-day
 * before a holiday, or a market that trades 23 hours, needs no special case.
 *
 * `undefined` when there are no sessions to measure — the caller should fall
 * back to {@link WINDOW_MS} and accept the calendar approximation.
 */
export function liveWindowMs(
  window: SeriesWindow,
  sessions: readonly Segment[] | undefined,
): number | undefined {
  if (isSubDay(window)) return SUB_DAY_MS[window];
  if (!sessions || sessions.length === 0) return undefined;
  const perBucket = new Map<number, number>();
  for (const [start, end] of sessions) {
    const key = floorToWindow(start, window);
    perBucket.set(key, (perBucket.get(key) ?? 0) + (end - start));
  }
  const spans = [...perBucket.values()].sort((a, b) => a - b);
  return spans[spans.length >> 1];
}

/** The grid a roll-up runs on. Session-shaped when the caller supplies sessions
 *  (intraday), calendar otherwise.
 *
 *  The calendar case used to floor an explicit `range` here so the leading
 *  partial bucket survived — pond emitted its first bucket at the first grid
 *  boundary *at or after* the first event, silently dropping everything before
 *  it (F-charts-16). `pond-ts` 0.64.0 makes the default do that flooring, so the
 *  default range (the series extent) is now the right one and there is nothing
 *  to override. */
function bucketing(
  window: SeriesWindow,
  sessions: readonly Segment[] | undefined,
): Sequence | BoundedSequence {
  // A bounded sequence's intervals are used as-is; otherwise the calendar grid,
  // which pond bounds by the series extent.
  return sessionGrid(sessions ?? [], window) ?? gridFor(window);
}

/**
 * Bin one numeric column into fixed windows, reducing each window to a single
 * value — the data behind a {@link https://…|BarChart}. Returns an
 * interval-keyed series whose one value column keeps the source column's name
 * (so the chart reads it with the same `column`). At the native window each
 * bucket holds one source point, so the reducer is a no-op; it only bites when
 * the window is coarser than the data.
 *
 * Pass `sessions` for intraday data so the buckets are sessions rather than
 * calendar spans — see {@link sessionGrid}.
 */
export function aggregateColumn(
  series: TimeSeries<SeriesSchema>,
  column: string,
  window: SeriesWindow,
  reducer: BarReducer = 'avg',
  sessions?: readonly Segment[],
): TimeSeries<SeriesSchema> {
  // Computed key ⇒ the mapping lands in aggregate's `string extends K` branch;
  // the spec form ties the output column to `from`. Cast the result to the
  // erased schema — callers read columns by name, not by static type.
  return series.aggregate(bucketing(window, sessions), {
    [column]: { from: column, using: reducer },
  }) as unknown as TimeSeries<SeriesSchema>;
}

/**
 * Roll a `time`-keyed OHLCV series up into interval-keyed OHLC windows — the
 * series a coarser-than-native candle draws. `open` is the window's first,
 * `high`/`low` its max/min, `close` its last; volume sums. The `<Candlestick>`
 * layer reads `open`/`high`/`low`/`close` directly and derives the body itself,
 * so there's no extent precompute here.
 *
 * Only needed when the window is coarser than the data's own interval: at the
 * native interval a candle takes the raw point-keyed series straight
 * (neighbour-derived slot), no aggregate pass.
 *
 * Pass `sessions` for intraday data so the buckets are sessions rather than
 * calendar spans — see {@link sessionGrid}.
 *
 * The source must carry `open`/`high`/`low`/`close` columns (Tidal's price
 * series does; vol series don't — the caller gates candles to the price panel).
 */
export function ohlcWindow(
  series: TimeSeries<SeriesSchema>,
  window: SeriesWindow,
  sessions?: readonly Segment[],
): TimeSeries<SeriesSchema> {
  return series.aggregate(bucketing(window, sessions), {
    open: { from: 'open', using: 'first' },
    high: { from: 'high', using: 'max' },
    low: { from: 'low', using: 'min' },
    close: { from: 'close', using: 'last' },
    volume: { from: 'volume', using: 'sum' },
  }) as unknown as TimeSeries<SeriesSchema>;
}
