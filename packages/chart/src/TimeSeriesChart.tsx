import {
  useRef,
  useCallback,
  Fragment,
  memo,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { ChartSeries } from './types.js';
import {
  AreaChart,
  BandChart,
  BarChart,
  Candlestick,
  ChartContainer,
  ChartRow,
  Layers,
  LineChart,
  Marker,
  Region,
  TimeAxis,
  YAxis,
  YAxisIndicator,
} from '@pond-ts/charts';
import type {
  AxisMouseEvent,
  CandleStyle,
  ChartTheme,
  DrawStatsFrame,
  LiveValue,
  TrackerInfo,
} from '@pond-ts/charts';
import { segmentDiscontinuity, weekendSkip } from '@pond-ts/financial';
import {
  resolveTimeZone,
  aggregateColumn,
  hasPairOp,
  inferBarMs,
  liveWindowMs,
  ohlcWindow,
  readNumericColumn,
  sessionOpenLine,
  exactSessionSegments,
  sessionSegments,
  shiftKeys,
  sliceBySegments,
  WINDOW_MS,
  autoBarWindow,
  type BarReducer,
  type Segment,
  type SeriesWindow,
  opOutputs,
  outputMark,
} from '@tidal-ts/core';
import { candleStyleForColor, candleStyleForPair } from './candleStyle.js';
import { useMeasuredWidth } from './useMeasuredWidth.js';
import { DEFAULT_CHART_SETTINGS, type ChartSettings } from './chartSettings.js';
import {
  configAxisId,
  seriesDrawn,
  DASH_PATTERN,
  effectiveSplit,
  seriesAxisId,
  seriesLineDashArray,
  seriesLineWidth,
  sharedAxisId,
  axisFormat,
  fractionTicks,
  bandColumns,
  outputKey,
  configColumns,
  type SeriesAxis,
  type SeriesConfig,
} from './series.js';

/** The schema-erased series type every layer reads. Rows carry heterogeneous
 *  sources (vol `%`, price `$`), so the chart works in the erased schema and each
 *  config names its `column`. Callers build the {@link TimeSeriesChartProps.sources} map
 *  in this type — cast their specific `TimeSeries` in (schema erasure, like
 *  `@tidal-ts/core`'s aggregate output). */

/** Fallback for a series too short to infer sessions from (< 2 points): collapse
 *  weekends and nothing else. Built once — the container rebuilds the scale if the
 *  reference changes. */
const WEEKEND_SKIP = weekendSkip();

/** Stable empty default: a fresh `[]` per render would re-run the sessions memo
 *  (and rebuild the container's scale) on every frame. */
const EMPTY_DAYS: readonly number[] = [];

/** One time marker. */
export interface ChartAnnotation {
  id: string;
  /** Epoch ms on the time axis. */
  at: number;
  /**
   * Which theme annotation role this mark draws in. The charts library takes no
   * per-mark colour prop ("colour is a theme concern"), so a user-chosen colour
   * reaches the canvas by this role being redefined — see {@link ChartAnnotation.color}.
   */
  role: string;
  /**
   * The mark's colour — a palette key (`'amber'`) or raw CSS.
   *
   * Stated per mark and folded into the theme's `annotation.roles` by role, rather
   * than passed to `<Marker>`, because the library has no colour prop. Marks
   * sharing a role must therefore agree on a colour; the last one wins, which is
   * exactly right when the colour is a property of the *kind*.
   */
  color: string;
  /**
   * `[from, to]` in axis units — draws a **shaded band** behind the line, so the
   * mark reads as a property of a *span* rather than an instant.
   *
   * Earnings use it: an announcement belongs to a session, not to a moment inside
   * one, and a bare vertical rule reads as the latter. The band is inert and
   * edgeless (fill only, no side rules) and sits at the back of the depth ramp, so
   * it tints under the data instead of competing with it. Absent ⇒ line only,
   * which is what expirations want — an expiry really is a boundary.
   */
  band?: readonly [number, number];
}

/** Dash ladders for a multi-output study's 2nd..Nth line. Distinguishable at a
 *  glance and ordered so a longer dash reads as "further from the main output".
 *  Cycles past the end — a 12-output ribbon (`guppy`) wants a colour ramp
 *  rather than twelve dashes, which is a named TDL-STUDYDRAW case. */
const OUTPUT_DASHES: readonly (readonly number[])[] = [
  [6, 3],
  [2, 2],
  [9, 3, 2, 3],
  [1, 3],
];

const EMPTY_ANNOTATIONS: readonly ChartAnnotation[] = [];
const EMPTY_SOURCES: readonly string[] = [];

/**
 * Is this mark within the data's span?
 *
 * Clips on the mark's **own extent**, not on its line position — which is the bug
 * this exists to prevent. A session-spanning annotation puts its line through the
 * middle of the day (`at + 12h`), so at daily grain, where the last bar's key IS a
 * UTC midnight, an event on the last in-view session sat half a day past the upper
 * bound and the whole mark — band included — was filtered out. That silently
 * dropped the MOST RECENT earnings, the one most worth seeing.
 *
 * The test is **overlap, not containment**: a band straddling either edge is still
 * partly on screen, and should draw the part that is.
 *
 * Exported for its own test. Nothing about the failure is visible in a screenshot —
 * a dropped annotation looks exactly like a quarter with no earnings.
 */
export function annotationInView(a: ChartAnnotation, lo: number, hi: number): boolean {
  // A band is HALF-OPEN — `[day, day + 1d]`, where the upper bound is the NEXT
  // day's midnight and belongs to that day, not this one. So a band merely
  // touching `lo` at its end covers only time before the first visible bar, and is
  // outside. Hence the strict `>` here and the inclusive `>=` for a bare rule,
  // which is a point and is visible when it lands exactly on the edge.
  if (!a.band) return a.at >= lo && a.at <= hi;
  return a.band[1] > lo && a.band[0] <= hi;
}

/** What the status line reports about the draw. */
export interface ChartStats {
  /** Points handed to the layers, summed over every layer on screen — the count
   *  BEFORE decimation, because decimation is a display mechanism: at a given
   *  view we are showing this much data whether or not the renderer chose to
   *  stroke every one of them. Charts reports it per layer as `sourceCount`.
   *
   *  A layer is the unit, which settles the counting question both ways: a candle
   *  reads four columns and draws one mark per bar, so it counts once; two series
   *  drawn separately are two layers, so they count twice — including a split
   *  bar's rise/fall halves, which really are two draws. */
  points: number;
  /** Wall-clock ms in the layers' `draw` for the most recent repaint, summed
   *  across every row that painted. This is the CHART's cost — distinct from the
   *  socket readiness figure the status line used to label "render". */
  drawMs: number;
}

/** Zoom-in floor when the drawn grain isn't known yet (no data): five days, the
 *  value this was hardcoded to for every grain. See {@link MIN_VIEW_BARS}. */
const MIN_VIEW_MS = 5 * 86_400_000;

/** Zoom-in floor, counted in **marks of the grain being drawn** rather than in
 *  calendar time.
 *
 *  This was a flat five calendar days, with a comment reasoning about daily bars
 *  — and on daily bars five days *is* five bars, which is why it read as a
 *  sensible constant for as long as every series was daily. On 1-minute data the
 *  same number is 1,950 bars: at maximum zoom the plot holds about **half a pixel
 *  per bar**, so a minute candle can never be a pixel wide, let alone be read.
 *  The rule was always bars; only the units were wrong.
 *
 *  Five marks of the **finest** drawn grain — finest because that is the series
 *  being zoomed in to read. A coarser companion series draws one wide body across
 *  the view at that zoom, which is what it should do. */
const MIN_VIEW_BARS = 5;

/** How often draw stats may reach React. A diagnostics line does not need 60 Hz,
 *  and a pan fires a frame per row per repaint. */
const STATS_MS = 250;

/** A bar of a count-like column (volume) sums over its window; a level (a vol or
 *  price) averages. */
const reducerFor = (c: SeriesConfig): BarReducer => (c.column === 'volume' ? 'sum' : 'avg');

/** A viewport row as the chart renders it: its **resolved px** `height` and the
 *  series configured in it. Structurally matches the app's machine `RowState`
 *  (which holds the *committed* height, `0` ⇒ remainder) — the host resolves the
 *  remainder math + drag into pixels and hands those over. */
export interface TimeSeriesChartRow {
  id: string;
  height: number;
  configs: SeriesConfig[];
}

export interface TimeSeriesChartProps {
  /** The stacked rows (top → bottom), each with a resolved px `height` + configs.
   *  Every config reads `sources[config.source]`, column `config.column`. */
  rows: readonly TimeSeriesChartRow[];
  /** Keyed time-series data — `{ vol, price }` today. A config's `source` selects
   *  its series here; a config whose source is absent is skipped (the render-side
   *  half of "show only what the data carries"). */
  sources: Record<string, ChartSeries>;
  /** Source keys whose series carry OHLC (candle-capable). A `candle` config on a
   *  non-OHLC source falls back to a line. Default: none. */
  ohlcSources?: readonly string[];
  /**
   * The market's trading days (UTC-midnight instants) — the axis's session model at
   * **daily** grain when supplied.
   *
   * Preferred over inferring from the bars because a session is a fact about the
   * market, not about which symbols happen to be loaded: two compared symbols get
   * one grid, and a session the data is MISSING stays visible instead of being
   * collapsed as though the market had been shut. Clipped to the data's own span, so
   * the days before an instrument listed are not drawn as gaps.
   *
   * Omitted or empty ⇒ infer from the bars, which is correct for dense data.
   */
  calendarDays?: readonly number[];
  /**
   * Time **markers** — earnings, expirations. Not series: they claim no axis, they
   * carry no value, and nothing scales them.
   *
   * Drawn on every rendered row (a date is a date, whichever panel you read it
   * against) but **labelled only on the first**, so the chip appears once above a
   * line that runs the full height. Inert by construction — `selectable: false` —
   * because these are context, not something the user placed and can drag.
   *
   * Colour comes from the theme's annotation `role`, never from a prop: two marker
   * kinds on one canvas have to be distinguishable, and that is a palette decision
   * (`theme.annotation.roles`), not a per-call one.
   */
  annotations?: readonly ChartAnnotation[];
  /**
   * Source keys whose data is **coarser than the axis** — a daily vol curve held
   * across an intraday grid (`holdVolAcrossGrid`).
   *
   * These opt out of session breaks. A break marks live time a series could not
   * fill *within its own cadence*; a daily observation has no intraday cadence to
   * fail at, so breaking it at every overnight gap chops one flat daily level into
   * a separate 3px dash per session — 250 of them across a year, which reads as
   * scattered noise rather than as a step function.
   *
   * Cannot be inferred here: the held series is re-keyed onto the fine grid, so its
   * KEYS are minutes and only its values are daily. The service knows, because it
   * did the fallback (the daily history's vol grain).
   */
  coarseSources?: readonly string[];
  /** Series ids to de-emphasize (drawn with reduced alpha) — the chart's "dim the
   *  others" for the selected series. */
  dimmed?: readonly string[];
  /** Draggable dividers, one per gap between *rendered* rows (`splitters[i]` sits
   *  below the i-th rendered row). The caller owns them + drives the heights from
   *  them. When any is present the row gap collapses to 0 so the splitter itself
   *  is the gutter. */
  splitters?: readonly ReactNode[];
  /** Hover readout: fires with the cursor time + every series' value there
   *  (`TrackerSample.label` = the series id / `<id>__cmp`), and `null` on leave —
   *  the caller renders the readout (chip values) outside the chart. */
  onTracker?: (info: TrackerInfo | null) => void;
  /** Draw diagnostics for the status line: how many points are on screen and what
   *  the last repaint cost. Coalesced — see `onDrawStats` in the render. */
  onStats?: (stats: ChartStats) => void;
  /** The live value pill (ChartIQ-style): pinned to the axis edge of the source
   *  it names (`sourceKey`), on the side of that source's first visible config.
   *  `source` is a stable `LiveValue` (see `createLiveValue`) — ticks repaint ONLY
   *  the pill, never the chart. `color` is a palette key or raw CSS color. */
  pricePill?: { source: LiveValue; color: string; sourceKey: string } | null;
  /** When true, the shared time axis collapses closed-market gaps (weekends) so
   *  bars sit contiguous and ticks stay calendar-aware. Off for the mock fixture,
   *  whose bars walk every calendar day and would otherwise clamp onto the removed
   *  weekends. Named for the behavior, not the data: the caller maps its
   *  data-nature flag to this. */
  collapseWeekends?: boolean;
  /** App-wide presentation defaults (category line weights/dash, bar/candle
   *  split colors). Defaults to the shipped {@link DEFAULT_CHART_SETTINGS}. */
  settings?: ChartSettings;
  /**
   * The DISPLAY zone the axis reads in — an IANA id, or `'local'`.
   *
   * Visual only: it never re-buckets anything, which is the split
   * `DATA_TIME_ZONE` documents. It applies at EVERY grain, daily included —
   * measured, because the opposite looked true on paper. A daily stamp is UTC
   * midnight for its trading date, and that instant formatted in New York is
   * the PREVIOUS day, so the axis "should" shift. It does not: the chart runs
   * on a trading-time scale (`discontinuities`) which places a bar by its
   * SESSION, so the date survives the zone. Confirmed by a side-by-side render
   * — identical tick labels in UTC and `America/New_York`.
   */
  timeZone?: string;
  /**
   * The **base** canvas theme — axes, grid, font, cursor, the annotation
   * register, the default marks. The chart overlays one entry per series on top
   * of it (colour, weight, dash, dimming) and never reads a CSS token itself, so
   * the host owns the token vocabulary and the dark/light switch: pass a new
   * object and the canvas repaints. Tidal's host reads it off the `--td-*`
   * tokens with `useTidalChartTheme`; another host builds it however it likes
   * (`@pond-ts/charts`' `cssVarTheme`, or a literal).
   */
  theme: ChartTheme;
  /**
   * Maps a config's `color` (and a split's `riseColor` / `fallColor`, an
   * annotation's `color`, the price pill's) to a **concrete canvas colour**.
   * Tidal's configs carry curated palette KEYS (`'blue'`) that resolve off CSS
   * tokens, so its host passes `resolveSeriesStroke`; a host whose configs
   * already carry CSS colours needs nothing — the default is the identity.
   * Keep the identity stable (module-level or memoised): it keys the theme memo.
   */
  resolveColor?: (color: string) => string;
  /**
   * Which way a hovered axis's ink lifts: toward white on a dark surface, toward
   * black on a light one. The one presentation fact the theme object does not
   * carry. Default `'dark'`.
   */
  colorScheme?: 'dark' | 'light';
  /** The controlled visible time window `[from, to]` (epoch ms) — pass to show a
   *  panned/zoomed/custom viewport; null/omitted fits the data. Wire together
   *  with {@link onViewRangeChange} (pan + wheel-zoom round-trip through the
   *  host, so pill state / persistence can react). */
  viewRange?: readonly [number, number] | null;
  /** Fires on every pan/zoom step with the new window. Wiring it makes the
   *  view CONTROLLED (the library keys controlled-ness on this callback);
   *  omitting it falls back to the library's uncontrolled internal view, which
   *  external `range` changes can then no longer reset. */
  onViewRangeChange?: (view: [number, number]) => void;
  /** Per-axis presentation, keyed by axis id (`configAxisId`/`sharedAxisId`) —
   *  what the host has resolved out of the machine's lock / mode / memory /
   *  unit model, plus the axis's own format and scale.
   *
   *  Each BOUND is independent: present ⇒ that edge is fixed, absent ⇒ it
   *  auto-fits, so `{ min: 0 }` is a hard floor under a free top. Axes with
   *  nothing to say are omitted. */
  axisOptions?: Record<
    string,
    {
      min?: number;
      max?: number;
      /** Decimal places for the tick labels; absent keeps the unit's default. */
      precision?: number;
      /** `log` never arrives with a `0` bound — the host refuses that pairing. */
      scaleType?: 'linear' | 'log';
      /**
       * A title over the gutter — the curve's name atop its own column. Drawn
       * at the top of the gutter with headroom padded into the domain so the
       * top tick does not collide with it. One titled axis pads every axis on
       * its side, so their tick rows stay aligned. Absent everywhere ⇒ no title
       * and no pad: the legend carries identity, which is right for a terminal
       * and wrong for a pane whose gutter IS the legend.
       */
      label?: string;
      /**
       * Pin this many ticks at equal FRACTIONS of `[min, max]`. Several
       * own-axes stacked on one side each nice their ticks independently, so
       * their rows land at different heights and the one grid the row draws
       * lines up with exactly one of them; the same fractions on every axis
       * make the rows agree by construction (`fractionTicks`). Honoured only
       * when BOTH bounds are pinned (a free bound has no fraction to pin to)
       * and the scale is linear (equal fractions of a log domain bunch).
       */
      ticks?: number;
      /** The gutter's width in px; absent keeps pond's default. A pane that
       *  stacks one column per curve budgets this exactly. */
      width?: number;
    }
  >;
  /**
   * A y GUTTER GESTURE that moved an axis (`<YAxis onBoundsChange>`): the bounds
   * the gesture reached, or `null` when it releases the axis back to auto-fit.
   *
   * Which gesture does what is pond's, and it CHANGED in charts 0.64.0: a drag
   * used to scale the axis; it now **pans** it, and the **wheel** zooms it —
   * matching the x strip (drag pans, wheel zooms). Both still report through
   * here, so nothing in this seam or the host's model changed; only what the
   * hand does. Don't re-document the gesture in terms of scaling.
   *
   * Providing it makes those axes **controlled** — the gesture only reports, and
   * what draws is whatever comes back through `axisOptions`. That is exactly the
   * shape the host already keeps, so a drag and the axis panel's padlock write
   * the same manual pin and can never disagree about which axis is manual.
   */
  onAxisBounds?: (axisId: string, bounds: readonly [number, number] | null) => void;
  /** A CLICK on a y-axis gutter (pond 0.61 `onMouseEvent`), with the row/side
   *  it landed on and the viewport point — the axis panel's anchor. Row + side
   *  are passed apart because axis ids embed config ids (engine specIds with
   *  `:`/parens) and cannot be parsed back. */
  onAxisClick?: (hit: {
    rowId: string;
    side: SeriesAxis;
    axisId: string;
    clientX: number;
    clientY: number;
    /** The native click COUNT — 1 for a single click, 2 for the second click of
     *  a double click. Passed on because a double click on the gutter is pond's
     *  reset-to-auto gesture, and the host must not treat it as two opens. */
    detail: number;
  }) => void;
}

/** #rgb / #rrggbb → `[r, g, b]`, or null for any other colour form. */
function parseHex(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const m = /^([\da-f]{6})$/i.exec(h);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Headroom a TITLED axis adds above its domain, as a fraction of the span, so
 *  the top tick clears the title drawn in the same gutter. */
const AXIS_LABEL_HEADROOM = 0.14;

/** How far a hovered axis's ink shifts toward the theme's extreme. */
const HOVER_LIFT = 0.42;

/** The default {@link TimeSeriesChartProps.resolveColor}: the config's colour is
 *  already a CSS colour. Module-level so its identity never churns the theme. */
const sameColor = (color: string): string => color;

/**
 * A hovered y-axis gutter's ink: the axis's own colour lifted toward **white
 * in dark mode / black in light** — the affordance that says the gutter is
 * clickable (it opens the axis panel). `<YAxis>` takes no cursor or hover
 * props, so its `color` is the one presentation channel available; the shift
 * is deliberately small (the axis must not read as selected). Non-hex colours
 * pass through unchanged — hover simply no-ops rather than guessing.
 */
function hoverInk(color: string | undefined, scheme: 'dark' | 'light'): string | undefined {
  if (!color) return undefined;
  const rgb = parseHex(color);
  if (!rgb) return color;
  const target = scheme === 'dark' ? 255 : 0;
  const [r, g, b] = rgb.map((v) => Math.round(v + (target - v) * HOVER_LIFT)) as [
    number,
    number,
    number,
  ];
  return `rgb(${r}, ${g}, ${b})`;
}

/** #rgb / #rrggbb → rgba() with the given alpha (for dimming a series). Falls
 *  back to the input unchanged for any other color form (dim just no-ops). */
function withAlpha(hex: string, alpha: number): string {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const m = /^([\da-f]{6})$/i.exec(h);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** A row's per-side SHARED axis id — unique across the container so each row
 *  scales independently. Now the exported `sharedAxisId` (series.ts): the
 *  machine keys range state and the host builds the panel model with the same
 *  vocabulary. An unlinked config's OWN axis appends its id (`seriesAxisId`). */
/** The series' native bar interval, cached per series object so a re-render does
 *  not re-scan the key column. Weakly keyed: a new fetch drops the old entry. */
/** Sorted times with duplicates removed — a union of symbols repeats every shared
 *  bar, and exact adjacency must see each instant once. */
function dedupe(sorted: readonly number[]): number[] {
  const out: number[] = [];
  for (const t of sorted) if (out[out.length - 1] !== t) out.push(t);
  return out;
}

/**
 * Whether the series sits on a **regular grid** — every gap a whole number of
 * intervals.
 *
 * Precisely what it checks, and no more. It does NOT verify that no bar is missing:
 * a skipped minute leaves a 2-interval gap, which is a whole multiple and passes.
 * That is fine, because a skipped bar splits the run under the OLD threshold rule
 * too (a 2-minute gap clears a 1.5-minute threshold), so exact adjacency is no
 * worse there — it is simply not better.
 *
 * What it does catch is a series whose keys are *off* the grid — an irregular or
 * unaligned cadence, where exact adjacency would find no two bars adjacent and cut
 * the axis into one segment per bar. That series wants the threshold's tolerance
 * instead, so it falls back.
 *
 * Cheap: one pass of integer arithmetic, run once per fetch rather than per frame.
 */
function isOnGrid(sorted: readonly number[], intervalMs: number): boolean {
  if (!(intervalMs > 0)) return false;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i]! - sorted[i - 1]!;
    if (gap === 0) continue; // a duplicate from the union, not a hole
    if (gap % intervalMs !== 0) return false;
  }
  return true;
}

/**
 * Source bars inside the visible window — the input the bar-density chooser needs,
 * and the reason it can be exact rather than estimated.
 *
 * Binary search on the key column, which is sorted; an O(n) scan here would run on
 * every resize of a 250k-row intraday series. `null`/absent view ⇒ everything,
 * which is what an unfitted chart shows.
 */
function barsInView(series: ChartSeries, view?: readonly [number, number] | null): number {
  const n = series.length;
  if (!view || n === 0) return n;
  const key = series.keyColumn() as unknown as { at(i: number): number | undefined };
  // First index at or after `t`.
  const lowerBound = (t: number) => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((key.at(mid) ?? Infinity) < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return Math.max(0, lowerBound(view[1] + 1) - lowerBound(view[0]));
}

const nativeMsCache = new WeakMap<object, number | undefined>();
function nativeMs(series: ChartSeries): number | undefined {
  if (nativeMsCache.has(series)) return nativeMsCache.get(series);
  const key = series.keyColumn() as unknown as { at(i: number): number | undefined };
  // A prefix is enough to find the median interval, and bounds the cost on a
  // 250k-row intraday series.
  const take = Math.min(series.length, 512);
  const times: number[] = [];
  for (let i = 0; i < take; i += 1) {
    const t = key.at(i);
    if (t !== undefined) times.push(t);
  }
  const ms = inferBarMs(times);
  nativeMsCache.set(series, ms);
  return ms;
}

/**
 * Per-bar colours for a study histogram, by the SIGN of each bar.
 *
 * A MACD's histogram is the line minus its signal, so what a reader takes off it
 * is which side of zero it sits on — not whether it rose since the last bar,
 * which is what {@link splitBarColumns} answers for a volume row. Different
 * question, different split.
 *
 * Uses `<BarChart binColors>` rather than splitting the column into two layers:
 * the split-column trick exists because the library's bar layer had one fill per
 * series (F-charts-12), and `binColors` is the fix that shipped for it. One
 * layer, one pass, and the hover readout keeps the bar's own colour.
 * `undefined` falls back to the theme fill, which is what a zero or a gap wants.
 */
function signColors(
  series: ChartSeries,
  column: string,
  rise: string,
  fall: string,
): (string | undefined)[] {
  const col = readNumericColumn(series, column);
  const n = col?.length ?? 0;
  const out = new Array<string | undefined>(n);
  for (let i = 0; i < n; i += 1) {
    const v = col!.read(i);
    if (v == null || !Number.isFinite(v) || v === 0) continue; // theme fill
    out[i] = v > 0 ? rise : fall;
  }
  return out;
}

const rowAxis = sharedAxisId;

/**
 * Split an aggregated bar column into `<col>__up` / `<col>__dn` halves by each
 * window's **direction**, so a rise/fall bar draws as two single-series layers
 * (the library's bar layer has one fill per series — F-charts-12; the stacked
 * path would cost the crosshair readout). Exactly one half carries each bar, so
 * the pixels match a per-bar-colored single layer.
 *
 * Direction: an OHLC source uses the window's own `close >= open` (matching the
 * candle convention) from an {@link ohlcWindow} roll-up over the SAME bucket
 * grid as the aggregate — **every** window, `'1d'` included. `sessions` must be
 * the same grid the aggregate used, or the two fall out of alignment silently.
 * Never index the raw source rows: the aggregate emits a bucket per window (empty
 * weekends included), so on trading-day data raw-row indexes drift by two per
 * weekend and the colors go wrong (caught in the PR #117 review). Two aggregates
 * over one grid are index-aligned by construction. A non-OHLC source rises when the value
 * is ≥ the previous window's (first bar reads as a rise).
 *
 * Exported for tests (the weekend-gap regression); not part of the public API.
 */
export function splitBarColumns(
  agg: ChartSeries,
  col: string,
  src: ChartSeries,
  hasOhlc: boolean,
  window: Parameters<typeof aggregateColumn>[2],
  sessions?: readonly Segment[],
): ChartSeries {
  // Columnar reads throughout (`series.column(name)`) rather than `toObjects()` —
  // no object per bar just to look at one or two fields (pond 0.52's "columns, not
  // events" guidance, applied to our own fold).
  const source = readNumericColumn(agg, col);
  const n = source?.length ?? 0;
  const vals = new Array<number | undefined>(n);
  for (let i = 0; i < n; i += 1) {
    const v = source!.read(i);
    if (v != null && Number.isFinite(v)) vals[i] = v;
  }
  let rising: (i: number) => boolean;
  if (hasOhlc) {
    const oc = ohlcWindow(src, window, sessions);
    const open = readNumericColumn(oc, 'open');
    const close = readNumericColumn(oc, 'close');
    rising = (i) => {
      const o = open?.read(i);
      const c = close?.read(i);
      // An empty bucket (weekend/holiday window) has no open/close — its bar
      // value is 0/absent anyway, so the defaulted direction never draws.
      return o != null && c != null ? c >= o : true;
    };
  } else {
    // Last defined value wins as "previous", so a gap doesn't flip direction.
    const prev: (number | undefined)[] = [];
    let last: number | undefined;
    for (const v of vals) {
      prev.push(last);
      if (v != null) last = v;
    }
    rising = (i) => prev[i] == null || (vals[i] ?? 0) >= prev[i]!;
  }
  const up = vals.map((v, i) => (v != null && rising(i) ? v : undefined));
  const dn = vals.map((v, i) => (v != null && !rising(i) ? v : undefined));
  return agg.withColumn(`${col}__up`, up).withColumn(`${col}__dn`, dn) as unknown as ChartSeries;
}

/**
 * The time-series chart: N stacked viewport **rows** sharing one time axis, each
 * row a set of series on its own dual L/R axes. A config names its data `source`
 * (`vol` / `price`, from {@link TimeSeriesChartProps.sources}) and its `column`; rows are
 * viewports, sources a separate axis — so a row can hold any source and a source
 * can appear in any row. Per-series color (and dimming for non-selected series) is
 * baked into a generated `ChartTheme` overlaid on the host-supplied base
 * {@link TimeSeriesChartProps.theme}; the chart itself reads no CSS token.
 *
 * (Historic: every visible series used to draw TWICE when a compare series was
 * supplied — solid primary, dashed counterpart. That blanket render retired
 * 2026-08-18: a comparison is now a PAIR you ask for per metric, so the only
 * dashed lines are compare-bound legs, styled by `settings.comparisons`.)
 * the primary as-is and a **dashed counterpart** (`<id>__cmp`, same color + axis) —
 * texture encodes primary-vs-compare, color encodes the series.
 *
 * Cursor is the crosshair (synced line + per-series dots + on-axis value pills +
 * x-axis time pill); hover values ALSO surface via {@link onTracker} so the legend
 * chips can track the hovered point. Memoized — the caller's hover state re-renders
 * chips, not the canvas (keep prop identities stable).
 */
function TimeSeriesChartInner({
  rows,
  sources,
  ohlcSources = [],
  calendarDays = EMPTY_DAYS,
  annotations = EMPTY_ANNOTATIONS,
  coarseSources = EMPTY_SOURCES,
  dimmed = [],
  splitters,
  onTracker,
  onStats,
  pricePill,
  collapseWeekends,
  settings = DEFAULT_CHART_SETTINGS,
  timeZone,
  theme: base,
  resolveColor = sameColor,
  colorScheme = 'dark',
  viewRange,
  onViewRangeChange,
  axisOptions,
  onAxisClick,
  onAxisBounds,
}: TimeSeriesChartProps) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  // Which y-axis gutter the pointer is over (the hover affordance). Axis
  // chrome is DOM, so this repaints the gutter only — never the canvas.
  const [hoverAxis, setHoverAxis] = useState<string | null>(null);

  const allConfigs = useMemo(() => rows.flatMap((r) => r.configs), [rows]);
  const ohlc = useMemo(() => new Set(ohlcSources), [ohlcSources]);

  const dimKey = dimmed.join(',');
  // The category styles + split defaults shape the theme too — one compact key
  // for all of it, so a settings change repaints and a hover doesn't.
  const settingsSig = JSON.stringify(settings);
  // Keyed by a signature of the theme-shaping fields (id / color / split mode +
  // pair / style / stroke width) + the dim set + the settings — NOT the rows
  // identity — so a height-only splitter drag doesn't rebuild the theme (or,
  // below, the aggregated series). Effective values (`seriesLineWidth`,
  // `effectiveSplit`), not raw fields, so a change lands even when it moves a
  // series off its default.
  const themeSig =
    allConfigs
      .map((c) => {
        const sp = effectiveSplit(c, settings);
        return `${c.id}:${c.color}:${sp.mode}:${sp.rise}:${sp.fall}:${c.style}:${seriesLineWidth(c, settings)}`;
      })
      .join('|') +
    '#' +
    dimKey +
    '#' +
    settingsSig;

  // Only the (role, colour) pairs shape the theme, so the signature collapses the
  // many marks of a kind to one entry. Without this the memo would rebuild on
  // every fetch — `annotations` is a fresh array each time and 298 marks long.
  const annotationSig = [...new Set(annotations.map((a) => `${a.role}:${a.color}`))]
    .sort()
    .join('|');
  const theme = useMemo<ChartTheme>(() => {
    const dim = new Set(dimmed);
    // One entry per series per draw kind — the canvas can't read the host's
    // colour tokens, so each style's color is baked in from the resolved stroke.
    // A series only draws in one style at a time, but seeding every map keeps
    // `as={id}` valid whatever style the config picks.
    const line: Record<string, ChartTheme['line'][string]> = { ...base.line };
    const area: Record<string, ChartTheme['area'][string]> = { ...base.area };
    const bar: Record<string, ChartTheme['bar'][string]> = { ...base.bar };
    const candle: Record<string, CandleStyle> = { ...base.candle };
    const band: Record<string, ChartTheme['band'][string]> = { ...base.band };
    for (const c of allConfigs) {
      const stroke = resolveColor(c.color);
      const isDim = dim.has(c.id);
      const color = isDim ? withAlpha(stroke, 0.22) : stroke;
      const width = seriesLineWidth(c, settings);
      const dash = seriesLineDashArray(c, settings);
      line[c.id] = { color, width, ...(dash ? { dash: [...dash] } : {}) };
      // The comparison counterpart shares the color + axis but takes the
      // `comparisons` category's own weight + texture (dashed by default —
      // texture encodes primary-vs-compare). Dims with its primary.
      line[`${c.id}__cmp`] = {
        color,
        width: settings.comparisons.weight,
        ...(settings.comparisons.dash === 'dashed' ? { dash: [...DASH_PATTERN] } : {}),
      };
      // Area fill wants a solid hex for its gradient, so dim via fillOpacity (not
      // an rgba fill); the outline still carries the dim.
      area[c.id] = {
        ...base.area.default,
        color,
        width,
        fill: stroke,
        fillOpacity: isDim ? 0.04 : 0.14,
      };
      // A band is a WASH, not a fill under a line: it carries no outline of its
      // own (the middle band draws that, as an ordinary line under the same
      // id), so it wants to read as a tinted region and nothing else. 0.16 sits
      // where the earnings band landed — unmistakably a region, still quiet
      // enough that a line crossing it stays the brighter thing.
      band[c.id] = { fill: stroke, opacity: isDim ? 0.04 : 0.16 };
      // A multi-output study's N lines: ONE colour, N textures. A study's
      // outputs are one series (a MACD is one study), so spending N palette
      // colours on them would fight "colour = series" and make three studies
      // look like nine. The first output is the study's own line; each later one
      // takes a longer dash and a hair less weight, so the stack reads as
      // primary-and-derived rather than as peers. Same shape as `__cmp`.
      if (c.style === 'lines' && c.derive) {
        const op = c.derive.op;
        opOutputs(op).forEach((suffix, i) => {
          const key = outputKey(c.id, i);
          if (outputMark(op, suffix) === 'bar') {
            // A histogram in the STUDY's colour, not a rise/fall pair: green and
            // red are reserved for market data (P&L, bid/ask), never for an
            // indicator. The sign is legible from which side of zero the bar
            // sits on, which is the reading anyway.
            bar[key] = { ...base.bar.default, fill: color, highlight: color };
            return;
          }
          line[key] = {
            color,
            width: i === 0 ? width : Math.max(1, width - 0.5),
            ...(i === 0 ? {} : { dash: [...OUTPUT_DASHES[(i - 1) % OUTPUT_DASHES.length]!] }),
          };
        });
      }
      // Direction-capable marks: a split bar draws its rise fill under `c.id` and
      // its fall fill under `` `${c.id}__down` `` (the render splits the column in
      // two — the library's bar layer has one fill per series; F-charts-12). A
      // split candle gets a per-id rise/fall pair + `colorBy='direction'`.
      const sp = effectiveSplit(c, settings);
      if (sp.mode === 'split') {
        const rise = resolveColor(sp.rise);
        const fall = resolveColor(sp.fall);
        const riseC = isDim ? withAlpha(rise, 0.22) : rise;
        const fallC = isDim ? withAlpha(fall, 0.22) : fall;
        bar[c.id] = { ...base.bar.default, fill: riseC, highlight: riseC };
        bar[`${c.id}__down`] = { ...base.bar.default, fill: fallC, highlight: fallC };
        if (c.style === 'candle') candle[c.id] = candleStyleForPair(riseC, fallC);
      } else {
        bar[c.id] = { ...base.bar.default, fill: color, highlight: color };
        // A single-color candle takes the series' one colour (a per-id style) so
        // it doesn't fight the "colour = series" encoding.
        if (c.style === 'candle') candle[c.id] = candleStyleForColor(color);
      }
    }
    // The theme is the ONLY styling channel for a mark — `<Marker>` takes no
    // colour prop, deliberately ("colour is a theme concern") — so a user-picked
    // annotation colour reaches the canvas by redefining its ROLE here. Keyed by
    // role, so N marks of one kind cost one entry, and the theme's own per-role
    // `dash` survives: hue is the user's, texture stays ours (it is what tells
    // the two kinds apart).
    const annotation = base.annotation
      ? {
          ...base.annotation,
          roles: annotations.reduce<NonNullable<ChartTheme['annotation']>['roles']>(
            (acc, a) => ({
              ...acc,
              [a.role]: { ...acc?.[a.role], color: resolveColor(a.color) },
            }),
            base.annotation.roles ?? {},
          ),
        }
      : base.annotation;
    return {
      ...base,
      line: line as ChartTheme['line'],
      area: area as ChartTheme['area'],
      bar: bar as ChartTheme['bar'],
      candle: candle as ChartTheme['candle'],
      band: band as ChartTheme['band'],
      annotation,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, resolveColor, themeSig, annotationSig]);

  // The trading sessions on this axis, derived from the data rather than from a
  // calendar. ONE session model with TWO consumers — the axis (which collapses
  // everything between sessions) and the roll-up grid below (whose buckets must
  // be those same sessions). When they disagree, a candle's slot covers time the
  // axis has excised: the body stretches across the collapsed seam, and its
  // midpoint — where the crosshair anchors its readout — falls in dead time and
  // clamps onto the session open, so the reticle lands on the candle's edge.
  //
  // The UNION of every series on the axis. Deriving from one source is wrong the
  // moment two symbols are on screen: they do not print in the same minutes
  // (AAPL and SPY differ in ~2,600 minutes over a year), so a minute the primary
  // missed would be excised while the other symbol has a point in it. The axis
  // is shared, so its live spans must be too.
  //
  // `sources` IS that union now: a comparison is no longer a parallel map, it is
  // `cmp_`-prefixed columns joined onto the primary (`@tidal-ts/core`'s
  // `joinUnderPrefix`). One caveat rides along — that join is a left EXACT-KEY
  // join, so a minute only the comparison printed is dropped there, before this
  // ever sees it. Aligned daily grids (a fixture + a daily feed) match exactly;
  // an intraday feed does not, and the fix (gap-cap, then `align` both series to
  // the grain, then join) is stated at the join itself. It lands here too when it
  // does: `align` creates rows, so this union — which is what a SESSION means —
  // must keep coming from real timestamps, not a cadence grid (`TDL-CMPGAP`).
  //
  // Keyed on the sources' identity, so it is rebuilt on a fetch and not on a
  // hover or a splitter drag; the container rebuilds its scale when the
  // discontinuity reference changes, so a stable identity matters.
  // Clipped to the data's own span, exactly like `calendarDays`: a marker outside
  // it says "before this instrument listed", which is not an annotation of
  // anything on screen. Cheap (tens of entries), so it recomputes with the data.
  const shownAnnotations = useMemo(() => {
    if (annotations.length === 0) return EMPTY_ANNOTATIONS;
    let lo = Infinity;
    let hi = -Infinity;
    for (const ser of Object.values(sources ?? {})) {
      const key = ser.keyColumn() as unknown as { at(i: number): number | undefined };
      const first = key.at(0);
      const last = key.at(ser.length - 1);
      if (first !== undefined && first < lo) lo = first;
      if (last !== undefined && last > hi) hi = last;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return EMPTY_ANNOTATIONS;
    return annotations.filter((a) => annotationInView(a, lo, hi));
  }, [annotations, sources]);

  const sessions = useMemo(() => {
    const times: number[] = [];
    const collect = (map: Record<string, ChartSeries> | undefined) => {
      for (const s of Object.values(map ?? {})) {
        // Columnar key read — the raw number, no event materialised
        // (ARCHITECTURE.md).
        const key = s.keyColumn() as unknown as { at(i: number): number | undefined };
        for (let i = 0; i < s.length; i += 1) {
          const t = key.at(i);
          if (t !== undefined) times.push(t);
        }
      }
    };
    collect(sources);
    if (times.length < 2) return [];
    times.sort((a, b) => a - b);

    // A CALENDAR beats both inference paths at daily grain: it can say a session
    // existed that the data has no bar for, which no amount of looking at bars can.
    // Clipped to the data's span — outside it the answer would be "this instrument
    // did not exist yet", which is not a gap.
    const bar0 = inferBarMs(times);
    if (calendarDays.length > 0 && bar0 !== undefined && bar0 >= WINDOW_MS['1d']) {
      const lo = times[0]!;
      const hi = times[times.length - 1]!;
      const span = calendarDays.filter((d) => d >= lo && d <= hi);
      if (span.length > 0) return exactSessionSegments(span, WINDOW_MS['1d']);
    }

    // Dense data gets EXACT adjacency; only a sparse series needs the threshold.
    //
    // `sessionSegments` compares each gap against the median gap in view, which is
    // right only while the median is representative. Measured on daily bars
    // spanning Thanksgiving 2025: at `1M` and wider the median is 1 day and the
    // holiday collapses correctly, but at `5D` half the gaps are weekends, the
    // median is 2 days, and a 1-day holiday gap stops clearing the 3-day threshold
    // — so 27 November ended up INSIDE a live span and the axis reserved width for
    // a day with no bar. The same closure rendered differently depending on how far
    // you were zoomed out, which is wrong: a market holiday is a property of the
    // market, not of the viewport.
    //
    // Exact adjacency has no median to distort. It needs keys on a regular grid,
    // which both of our shapes satisfy — a trading day either printed or was not a
    // session, and the 1-minute archive is gap-free in session. An off-grid series
    // would find no two bars adjacent, so it keeps the threshold.
    const bar = bar0;
    const onGrid = bar !== undefined && isOnGrid(times, bar);
    return onGrid ? exactSessionSegments(dedupe(times), bar) : sessionSegments(times);
  }, [sources, calendarDays]);

  // Aggregated series behind the binning styles (pond does the windowing). Bars
  // reduce one column into windows; candles roll a source's OHLCV into a coarser
  /**
   * The window a bar series is actually drawn at.
   *
   * `c.window` unset means **Auto**, and Auto is chosen from the pixels: a bar
   * narrower than {@link MIN_BAR_PX} cannot be drawn, and because a rise/fall bar
   * is two layers with fall on top, sub-pixel bars do not merely blur — the upper
   * layer wins every shared pixel column and the chart reports bar density as
   * market direction. AAPL's full history rendered 82% red against 47.5% down days
   * until this existed (`autoBarWindow` carries the measurements).
   *
   * An EXPLICIT window is returned untouched, overdraw and all. The Window control
   * names it, and a control that reads `1D` over a canvas of monthly bars is a
   * worse failure than the one being fixed — so the coarsening only happens in the
   * mode that is honestly labelled "Auto".
   */
  const windowFor = useCallback(
    (c: SeriesConfig, src: ChartSeries): SeriesWindow =>
      c.window ??
      autoBarWindow({
        bars: barsInView(src, viewRange),
        nativeMs: nativeMs(src) ?? WINDOW_MS['1d'],
        widthPx: width,
      }),
    [viewRange, width],
  );

  // window. Keyed by a signature of the fields that change the data (source /
  // style / window / column / visibility / split mode) — colors/dim only touch
  // the theme, but flipping split on/off changes the derived columns.
  //
  // The window in the signature is the RESOLVED one, not `c.window` — an Auto
  // series' window is a function of the plot width and the view, so keying on the
  // raw field would leave the aggregate stale across a resize. Keying on the
  // resolved value also means a resize that does NOT change the choice (most of
  // them) re-uses the memo instead of re-aggregating every frame of the drag.
  const aggSig = allConfigs
    .map((c) => {
      const src = c.source ? sources[c.source] : undefined;
      const w = src && c.style === 'bar' ? windowFor(c, src) : (c.window ?? '1d');
      return `${c.id}:${c.source ?? ''}:${c.style}:${w}:${c.column}:${seriesDrawn(c)}:${effectiveSplit(c, settings).mode}`;
    })
    .join('|');
  // Buckets follow the SESSIONS for intraday data and the CALENDAR for daily. Not a
  // preference — on daily bars the session segments are whole *weeks* (a weekend gap
  // is the only gap wide enough to split them), so bucketing a `'1d'` window on them
  // would roll five days into one mark.
  const sessionsFor = useCallback(
    (src: ChartSeries): readonly Segment[] | undefined => {
      const native = nativeMs(src);
      return native !== undefined && native < WINDOW_MS['1d'] ? sessions : undefined;
    },
    [sessions],
  );

  const derived = useMemo(() => {
    const bar = new Map<string, ChartSeries>();
    const candle = new Map<string, ChartSeries>();
    for (const c of allConfigs) {
      if (!seriesDrawn(c) || !c.source) continue;
      const src = sources[c.source];
      if (!src) continue;
      if (c.style === 'bar') {
        const col = c.column;
        const window = windowFor(c, src);
        const grid = sessionsFor(src);
        let agg = aggregateColumn(src, col, window, reducerFor(c), grid);
        // A split bar needs per-bar direction the library's bar layer can't paint
        // (one fill per series; F-charts-12) — split the column into `__up`/`__dn`
        // halves and draw them as two layers. Same grid, or the halves misalign.
        if (effectiveSplit(c, settings).mode === 'split')
          agg = splitBarColumns(agg, col, src, ohlc.has(c.source), window, grid);
        bar.set(c.id, agg);
      }
      // A candle at the data's NATIVE interval feeds the raw point-keyed series
      // straight to <Candlestick> (neighbour-derived slot); anything coarser needs
      // an OHLC roll-up, and only a source that actually carries OHLC can candle.
      //
      // The comparison is against the data, not against the token `'1d'`. That
      // shortcut held while every source was daily and silently broke on intraday:
      // a "1 day" candle over 1-minute bars drew one candle per MINUTE, because
      // `'1d'` was read as "native" rather than as a day.
      if (c.style === 'candle' && ohlc.has(c.source)) {
        const window = c.window ?? '1d';
        const native = nativeMs(src);
        // 1.5× so a jittery interval does not roll a series up against itself.
        if (native === undefined || WINDOW_MS[window] > native * 1.5)
          candle.set(c.id, ohlcWindow(src, window, sessionsFor(src)));
      }
    }
    return { bar, candle };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, ohlc, sessionsFor, aggSig]);

  // A line through `close` belongs at the bar's END, not its start.
  //
  // The archive stamps a bar by its OPEN — the row stamped 13:30 covers 13:30–13:31
  // — so its close is the price at ~13:31. Plotting that close at 13:30 draws every
  // intraday close one bar early: uniform, invisible mid-series, and exactly
  // visible at a session seam, where the day's last close lands at 21:59 instead of
  // 22:00 and the first close of the next session sits on the open rather than a
  // minute after it.
  //
  // Only the line-ish styles want this. A candle spans `[open, close]` and draws
  // from the open, so the same row wants a different x per style — which is why the
  // shift lives here, per layer, rather than in the fetch.
  //
  // DAILY IS NOT EXEMPT, though I first thought it should be. The objection was
  // that shifting would put Friday's close on Saturday — but a daily stamp is a
  // UTC-midnight **boundary**, not the session it describes, so the shift is what
  // gets the date RIGHT rather than wrong: the bar stamped 27 Apr is Monday's
  // session, and its close plotted at 28 Apr 00:00Z is 27 Apr 20:00 in New York —
  // the correct NY day. Unshifted it sits at 27 Apr 00:00Z, which is *Sunday*
  // evening in New York, a day before the session it reports.
  //
  // Leaving daily out also cost a fifth of every week: the segment runs one bar
  // past its last key, so Fri 00:00Z → Sat 00:00Z was live axis with no line on it.
  const shifted = useMemo(() => {
    const out = new Map<string, ChartSeries>();
    for (const [key, src] of Object.entries(sources ?? {})) {
      const native = nativeMs(src);
      if (native === undefined) continue;
      out.set(key, shiftKeys(src, native) as ChartSeries);
    }
    return out;
  }, [sources]);

  // …and where the source carries an OPEN, the line can start at the session open
  // instead of a minute inside it. `sessionOpenLine` emits one column named `close`
  // and `bars + 1` points per session — the opening print, then every close — so
  // the line spans the whole live segment rather than beginning after it.
  //
  // Price only. A vol series has no open to start from, so its line keeps the
  // shifted closes and legitimately begins one bar in.
  const openLine = useMemo(() => {
    const out = new Map<string, ChartSeries>();
    for (const key of ohlc) {
      const src = sources?.[key];
      if (!src) continue;
      const native = nativeMs(src);
      if (native === undefined) continue;
      out.set(key, sessionOpenLine(src, native, { open: 'open', close: 'close' }) as ChartSeries);
    }
    return out;
  }, [sources, ohlc]);

  // The zoom-in floor in the grain actually on screen (see MIN_VIEW_BARS). Mirrors
  // how `derived` decides what a mark is: a bar always bins to its window, a candle
  // only when the window is coarser than native, everything else draws raw.
  const minDuration = useMemo(() => {
    let finest: number | undefined;
    for (const c of allConfigs) {
      if (!c.visible || !c.source) continue;
      const src = sources[c.source];
      if (!src) continue;
      const native = nativeMs(src);
      if (native === undefined) continue;
      const window = c.window ?? '1d';
      // A binned mark spans its window in LIVE time (`liveWindowMs`); an unbinned
      // one spans its native interval, which is already live — a minute inside a
      // session is a live minute.
      const binned =
        c.style === 'bar' || (c.style === 'candle' && WINDOW_MS[window] > native * 1.5);
      const mark = binned ? (liveWindowMs(window, sessionsFor(src)) ?? WINDOW_MS[window]) : native;
      if (finest === undefined || mark < finest) finest = mark;
    }
    return finest === undefined ? MIN_VIEW_MS : MIN_VIEW_BARS * finest;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, sessionsFor, aggSig]);

  // The trading-time axis, from the sessions above. `weekendSkip()` collapses
  // weekends ONLY, which is adequate for daily bars and badly wrong intraday: a
  // year of 1-minute data carries ~190 overnight gaps of ~8h, so each session
  // occupies about a quarter of its day's width and the chart draws a comb of
  // hairlines. Sessions derived from the data collapse overnight, weekends,
  // holidays and half-days with one rule.
  //
  // Too short to infer a bar interval from ⇒ fall back rather than excise
  // everything.
  /**
   * Whether the bars are **intraday**, which is the only grain a session break
   * means anything at.
   *
   * A break exists to show live time a series could not fill *inside* a session's
   * continuum — an intraday line starts one bar after the open, so the space
   * before its first point is real. At daily grain each point IS a session, so
   * consecutive sessions are contiguous and Friday→Monday is a join, not a jump:
   * the axis has already collapsed the weekend, and breaking the line as well
   * states the same fact twice and reads as missing data.
   *
   * That is what it looked like, too. With the calendar axis feeding
   * `exactSessionSegments`, every weekend is a segment boundary, so a daily vol
   * line came out chopped into five-point weekly fragments — reported as "why does
   * ATM vol have gaps?", and the data has none: every gap in the archive is a real
   * closure (2026-06-19 Juneteenth, 2026-07-03 for July 4th), and `iv21` is
   * non-null throughout.
   */
  const coarse = useMemo(() => new Set(coarseSources), [coarseSources]);

  const intraday = useMemo(() => {
    // A short prefix of ONE source is enough to tell intraday from daily, and
    // avoids a second full walk of what can be 99k points (the sessions memo
    // already does one). `inferBarMs` takes the modal gap, so a handful of bars
    // settles it even if the first pair straddles a seam.
    const first = Object.values(sources ?? {})[0];
    if (!first) return false;
    const key = first.keyColumn() as unknown as { at(i: number): number | undefined };
    const probe: number[] = [];
    for (let i = 0; i < Math.min(first.length, 64); i += 1) {
      const t = key.at(i);
      if (t !== undefined) probe.push(t);
    }
    const bar = probe.length >= 2 ? inferBarMs(probe) : undefined;
    return bar !== undefined && bar < WINDOW_MS['1d'];
  }, [sources]);

  /** Whether this config's layers break at the session seams. */
  const breaksFor = (c: SeriesConfig): boolean =>
    intraday && settings.sessions.breaks && !coarse.has(c.source ?? '');
  /** …and whether a FILL has to be split to do so: only when there are seams. */
  const splitsFor = (c: SeriesConfig): boolean => breaksFor(c) && sessions.length > 1;

  // One sub-series per live segment, for the layers pond gives no `sessionBreaks`
  // (`<BandChart>`, `<AreaChart>`). Lazy and cached on the series object: slicing
  // a 250k-row series into ~250 sessions is real work, and most renders draw no
  // fill at all. The cache resets with the segments.
  const { segmentsFor, endSegmentsFor } = useMemo(() => {
    const raw = new Map<ChartSeries, ChartSeries[]>();
    const end = new Map<ChartSeries, ChartSeries[]>();
    const segmentsFor = (series: ChartSeries): ChartSeries[] => {
      let slices = raw.get(series);
      if (!slices) {
        slices = sliceBySegments(series, sessions) as ChartSeries[];
        raw.set(series, slices);
      }
      return slices;
    };
    // The same slices moved to the bar's END — cut first, shifted after, and
    // cached like the raw ones: a fill that is re-shifted on every frame of a
    // pan hands pond a fresh series identity per slice per frame. Only the area
    // still needs these — `<AreaChart>` has no `sessionBreaks` (F-charts-20);
    // `<BandChart>` gained it in charts 0.70.0.
    const endSegmentsFor = (series: ChartSeries): ChartSeries[] => {
      let slices = end.get(series);
      if (!slices) {
        const native = nativeMs(series);
        slices =
          native === undefined
            ? segmentsFor(series)
            : segmentsFor(series).map((slice) => shiftKeys(slice, native) as ChartSeries);
        end.set(series, slices);
      }
      return slices;
    };
    return { segmentsFor, endSegmentsFor };
  }, [sessions]);

  const discontinuities = useMemo(
    () =>
      !collapseWeekends
        ? undefined
        : sessions.length
          ? segmentDiscontinuity(sessions)
          : WEEKEND_SKIP,
    [collapseWeekends, sessions],
  );

  // One series → one or more draw layers, picked by `style`. The compare ticker is
  // always a dashed line whatever the primary style (texture = compare).
  // `candleable` is true only for a source that carries the OHLC a candle needs.
  //
  // Returns a FLAT ARRAY, never a Fragment: `<Layers>` injects each **direct**
  // child's JSX position as its z-index (`cloneElement(child, { index })`), and a
  // Fragment would swallow that prop — leaving every layer at the default index
  // (draw order then followed mount order, so reordering did nothing). Arrays are
  // flattened by `Children.map`, so each layer stays a direct child and keeps its
  // own z slot. Keys are explicit for the same reason.
  const layer = (
    c: SeriesConfig,
    panelSeries: ChartSeries,
    axis: string,
    candleable: boolean,
  ): ReactNode[] => {
    const col = c.column;
    // A line/area draws CLOSES, which belong at their bar's end — see `shifted`,
    // and daily is not exempt. For the price column of an OHLC source it can do
    // better still and start at the session's open (`openLine`). Both fall back
    // to the raw series only when no bar interval can be inferred.
    const closeSeries =
      (c.source && col === 'close' ? openLine.get(c.source) : undefined) ??
      (c.source ? shifted.get(c.source) : undefined) ??
      panelSeries;
    // Every OTHER line-like mark belongs at its bar's end too — a band's edges
    // and middle, a study's outputs — or a banded curve leads the plain line
    // beside it by one bar, visibly at every seam. Same shift as `closeSeries`,
    // minus the open-line case: only a price column has an open to start from.
    // Per-segment slices come from `endSegmentsFor`: cut from the RAW series
    // and shifted after (shifted first, a session's last close sits on the
    // segment end), and cached.
    const src = c.source ? sources[c.source] : undefined;
    const native = src ? nativeMs(src) : undefined;
    const endSeries = (c.source ? shifted.get(c.source) : undefined) ?? panelSeries;
    switch (c.style) {
      case 'area': {
        // No `sessionBreaks` on `<AreaChart>` — the prop is LineChart-only
        // (F-charts-20), so the break is made here: one layer per live segment,
        // and the fill ends at the close and restarts at the open like the line
        // would. One layer when nothing collapses.
        //
        // Cut the RAW series, then shift each slice — never the reverse. The
        // segments come from unshifted keys, so a shifted session's last close
        // sits exactly on its segment end and the half-open cut would drop it:
        // the fill would stop one bar before the line it is meant to agree with,
        // at every seam.
        if (!splitsFor(c)) {
          return [<AreaChart key={c.id} series={closeSeries} column={col} as={c.id} axis={axis} />];
        }
        // The price close gets the open-line treatment per slice (one source,
        // so uncached is cheap); everything else takes the cached end-shifted
        // slices.
        const slices =
          native !== undefined && c.source && col === 'close' && ohlc.has(c.source)
            ? segmentsFor(panelSeries).map(
                (slice) =>
                  sessionOpenLine(slice, native, { open: 'open', close: 'close' }) as ChartSeries,
              )
            : endSegmentsFor(panelSeries);
        return slices.map((slice, i) => (
          <AreaChart key={`${c.id}__s${i}`} series={slice} column={col} as={c.id} axis={axis} />
        ));
      }
      case 'bar': {
        const s = derived.bar.get(c.id);
        if (!s) return [];
        // A split bar draws its two direction halves as two single-series layers
        // (see splitBarColumns) — the rise under the series' own id, the fall
        // under `<id>__down` (its theme fill; the host normalizes tracker labels).
        return effectiveSplit(c, settings).mode === 'split'
          ? [
              <BarChart key={c.id} series={s} column={`${col}__up`} as={c.id} axis={axis} />,
              <BarChart
                key={`${c.id}__down`}
                series={s}
                column={`${col}__dn`}
                as={`${c.id}__down`}
                axis={axis}
              />,
            ]
          : [<BarChart key={c.id} series={s} column={col} as={c.id} axis={axis} />];
      }
      case 'candle':
        // Only an OHLC source can candle; elsewhere fall back to a line. A daily
        // candle draws the raw series; a windowed one draws its OHLC roll-up.
        // Split mode paints by direction (the per-id rise/fall pair baked into
        // the theme); single mode takes the series' one colour. Tracker keys on
        // `as`.
        return candleable
          ? [
              <Candlestick
                key={c.id}
                series={derived.candle.get(c.id) ?? panelSeries}
                as={c.id}
                axis={axis}
                variant={c.candleVariant ?? 'candle'}
                colorBy={effectiveSplit(c, settings).mode === 'split' ? 'direction' : 'series'}
                // The full O/H/L/C quote, so the reticle can snap to a wick
                // extreme instead of riding the close: hover the top of a bar and
                // the axis pill reads that bar's HIGH. Charts leaves this off by
                // default for a compact legend, which is the wrong default for a
                // terminal — the four values ARE the mark. The host folds the
                // four labels back to one chip (`hoverValues`).
                showOHLC
              />,
            ]
          : [
              <LineChart
                key={c.id}
                series={closeSeries}
                column={col}
                as={c.id}
                axis={axis}
                sessionBreaks={intraday && settings.sessions.breaks && !coarse.has(c.source ?? '')}
              />,
            ];
      case 'band': {
        // A band is TWO layers for ONE config — the wash between the edges, and
        // the middle band drawn as an ordinary line. Both take `as={c.id}`: the
        // registers are separate maps (`theme.band` vs `theme.line`), so one id
        // styles both halves and they cannot drift apart.
        //
        // The wash goes FIRST so the centre line draws over it — `<Layers>`
        // z-orders by JSX position, and this array is flattened into it.
        //
        // `col` is the SPEC ID here, not a column: a multi-output op names its
        // three columns off it (`bandColumns`). Reading `col` itself would find
        // nothing.
        //
        // Both break at the session seams together — `<BandChart sessionBreaks>`
        // arrived in charts 0.70.0 with the same semantics as the line's, which
        // retired this chart's one-wash-per-segment workaround (0.2.0).
        const b = bandColumns(col);
        return [
          <BandChart
            key={`${c.id}__band`}
            series={endSeries}
            lower={b.lower}
            upper={b.upper}
            as={c.id}
            axis={axis}
            sessionBreaks={breaksFor(c)}
          />,
          <LineChart
            key={c.id}
            series={endSeries}
            column={b.middle}
            as={c.id}
            axis={axis}
            sessionBreaks={breaksFor(c)}
          />,
        ];
      }
      case 'lines': {
        // N layers for ONE config — one per declared output, each on its own
        // theme key so the textures above apply. `col` is the SPEC ID, so every
        // column is named off it by suffix; reading `col` itself finds nothing,
        // exactly as for a band.
        if (!c.derive) return [];
        const op = c.derive.op;
        const histSplit = effectiveSplit(c, settings);
        const layers = opOutputs(op).map((suffix, i) => ({
          mark: outputMark(op, suffix),
          node:
            outputMark(op, suffix) === 'bar' ? (
              // On the SAME series as the study's lines: a point-keyed bar is
              // centred on its key, so a histogram left on the raw keys would
              // put its zero-cross one bar left of the line-cross it exists to
              // mark.
              <BarChart
                key={`${c.id}__o${i}`}
                series={endSeries}
                column={`${col}${suffix}`}
                as={outputKey(c.id, i)}
                axis={axis}
                // Opt-in, per config: off, the histogram is the study's own
                // colour (green/red is market data's). On, each bar takes its
                // sign's colour.
                {...(histSplit.mode === 'split'
                  ? {
                      binColors: signColors(
                        endSeries,
                        `${col}${suffix}`,
                        resolveColor(histSplit.rise),
                        resolveColor(histSplit.fall),
                      ),
                    }
                  : {})}
              />
            ) : (
              <LineChart
                key={`${c.id}__o${i}`}
                series={endSeries}
                column={`${col}${suffix}`}
                as={outputKey(c.id, i)}
                axis={axis}
                sessionBreaks={intraday && settings.sessions.breaks && !coarse.has(c.source ?? '')}
              />
            ),
        }));
        // Bars UNDER lines. `<Layers>` z-orders by position, and a MACD's
        // histogram is context for its two lines — drawn over them it would
        // hide the crossing that the histogram exists to mark.
        return [
          ...layers.filter((l) => l.mark === 'bar').map((l) => l.node),
          ...layers.filter((l) => l.mark !== 'bar').map((l) => l.node),
        ];
      }
      default:
        return [
          <LineChart
            key={c.id}
            series={closeSeries}
            column={col}
            as={c.id}
            axis={axis}
            sessionBreaks={intraday && settings.sessions.breaks && !coarse.has(c.source ?? '')}
          />,
        ];
    }
  };

  // Render a row if it has a visible series — but always keep the first row, so
  // hiding every series in it leaves the chart frame (not an empty container).
  // Splitters index by the *rendered*-row gap (`splitters[i]` below rendered row
  // i). For today's two rows this is exactly the old vol|price behavior.
  // Any change to which gutters exist drops the hover. A gutter removed from
  // under a stationary pointer fires NO mouseout (verified in Chrome), so a
  // swap / preset / row change would otherwise strand an axis in hover ink
  // with the pointer nowhere near it (PR #135 review, LOW). Re-hovering costs
  // one pointer move; a stuck highlight costs trust in the affordance.
  const gutterSig = rows
    .map(
      (r) =>
        `${r.id}:${r.configs.map((c) => `${c.id}${c.axis}${c.axisGroup ?? ''}${seriesDrawn(c) ? '' : 'h'}`).join(',')}`,
    )
    .join('|');
  useEffect(() => setHoverAxis(null), [gutterSig]);

  const renderedRows = rows.filter((r, i) => i === 0 || r.configs.some(seriesDrawn));
  const gapSplitter = renderedRows.length > 1 && !!splitters?.length;

  // The live pill rides the first visible config on its named source (that config
  // decides the row + side). Null when no such series is on the terminal. The
  // config must also CARRY its column — a `—` chip config would anchor the
  // pill to an axis that doesn't render (PR #133 review, LOW).
  const pillCfg = pricePill
    ? allConfigs.find((c) => {
        if (!seriesDrawn(c) || c.source !== pricePill.sourceKey) return false;
        const s = sources[c.source];
        const col = c.column;
        return !!s && s.schema.some((sc) => sc.name === col);
      })
    : undefined;

  // Draw stats arrive once per ROW repaint, inside the draw frame — so they land
  // in a ref and are published on a time gate. Doing React state work per frame
  // would make the diagnostics line the most expensive thing on the canvas, and
  // during a pan it fires every frame.
  const drawRef = useRef(new Map<symbol, { points: number; drawMs: number }>());
  const flushedAt = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const publish = useCallback(() => {
    pending.current = null;
    flushedAt.current = performance.now();
    let points = 0;
    let drawMs = 0;
    for (const row of drawRef.current.values()) {
      points += row.points;
      drawMs += row.drawMs;
    }
    onStats?.({ points, drawMs });
  }, [onStats]);

  const handleDrawStats = useCallback(
    (frame: DrawStatsFrame) => {
      let points = 0;
      let drawMs = 0;
      for (const l of frame.layers) {
        // `sourceCount` is undefined for a layer that reports no counts; its
        // `drawMs` still counts, so the cost stays honest even when the point
        // total can't see that layer.
        points += l.sourceCount ?? 0;
        drawMs += l.drawMs;
      }
      drawRef.current.set(frame.rowKey, { points, drawMs });
      // Leading AND trailing edge. Rows repaint independently, so the first frame
      // of a batch is usually the EMPTY row: a leading-only throttle published
      // that zero and then sat on every real number until the next repaint, which
      // on a static chart never comes. Reading `points 0` under a drawn chart was
      // this, not a measurement.
      const wait = STATS_MS - (performance.now() - flushedAt.current);
      if (wait <= 0) publish();
      else if (pending.current === null) pending.current = setTimeout(publish, wait);
    },
    [publish],
  );

  useEffect(() => {
    // The timer holds a closure over `onStats`; firing it after unmount would
    // call setState on a dead component.
    return () => {
      if (pending.current !== null) clearTimeout(pending.current);
      pending.current = null;
    };
  }, []);

  // A removed row never reports again, so its last frame would keep contributing
  // its points and its draw cost to the totals forever. Rows are identified by an
  // opaque key we can't enumerate, so drop the lot whenever the row set changes
  // and let the next repaint refill it — one stale tick is cheaper than a total
  // that counts a row that isn't there.
  useEffect(() => {
    drawRef.current.clear();
  }, [gutterSig]);

  return (
    <div ref={ref} style={S.wrap} data-testid="time-series-chart">
      {width > 0 && (
        <ChartContainer
          width={width}
          theme={theme}
          // THE ZONE. Omitting it means the VIEWER's, which made the axis the one
          // place in Tidal that did not read in UTC — every stamp behind it does
          // (the daily bar's UTC-midnight date, the calendar's open days, the
          // earnings sessions, the aggregate's day/week/month buckets, the range
          // picker). Read from Madrid the axis placed its day boundary two hours
          // from where the bar started. pond's rule for 0.69 is that this and
          // `Sequence.calendar` take the SAME zone or a bucket edge and the tick
          // labelling it are different instants — so they read one constant.
          timeZone={resolveTimeZone(timeZone)}
          // Controlled pan/zoom: the view round-trips through the host (range ⇄
          // onTimeRangeChange), so pill state and persistence stay in sync and a
          // pill click can reset the viewport (uncontrolled mode ignores later
          // `range` changes once the user pans). No view ⇒ auto-fit the data.
          panZoom
          // …and the y GUTTERS take their own gesture: drag one to PAN that axis
          // alone, wheel to zoom it (0.64 aligned the drag with the x strip —
          // before that a drag scaled). Deliberately `'y'` — the x strip would
          // duplicate the plot's own pan/zoom, and the range pills are the x reset.
          axisPanZoom={onAxisBounds ? 'y' : 'none'}
          range={viewRange ?? undefined}
          onTimeRangeChange={onViewRangeChange}
          minDuration={minDuration}
          cursor="crosshair"
          onTrackerChanged={onTracker}
          // Omitting it makes charts skip per-layer timing entirely, so an app that
          // doesn't show the diagnostics line pays nothing for them.
          onDrawStats={onStats ? handleDrawStats : undefined}
          discontinuities={discontinuities}
          sessionDividers={settings.sessions.dividers}
          rowGap={gapSplitter ? 0 : 8}
          showAxis={false}
        >
          {renderedRows.map((row, i) => {
            const visible = row.configs.filter(seriesDrawn);
            // Visible AND its column actually folded — the drawable set. A `—`
            // chip config (a skipped derived spec) is visible but carries no
            // column: it draws nothing, and it must not mount an EMPTY own
            // axis (charts' [0,1] fallback gutter) either (PR #133 review).
            //
            // `configColumns`, exactly as the layer guard below does: a BAND's
            // `column` is a spec id naming three columns and is in no schema, so
            // testing it directly kept every band OUT of `drawable` — and
            // `drawable` is what the axes are built from. The band's layers then
            // named a `<YAxis>` that was never mounted (visible the moment the
            // band is unlinked onto its own axis, or its parent metric hidden),
            // and the band was silently absent from the axis-colour vote.
            const drawable = visible.filter((c) => {
              const s = c.source ? sources[c.source] : undefined;
              if (!s) return false;
              return configColumns(c).every((col) => s.schema.some((sc) => sc.name === col));
            });
            // The axes a side carries: its SHARED axis (when any drawable linked
            // config sits there) plus one OWN axis per unlinked config — pond
            // stacks same-side axes natively. No axis label — the legend
            // carries series identity + units; a side with nothing on it
            // renders no gutter at all. The colour rule: a single-member axis
            // takes its series' colour (shared-with-one included), a truly
            // shared axis stays neutral. A click anywhere on a gutter reports
            // row + side (+ the exact axis) for the anchored axis panel.
            const axesFor = (side: SeriesAxis): ReactNode[] => {
              const sideCfgs = drawable.filter((c) =>
                side === 'R' ? c.axis === 'R' : c.axis !== 'R',
              );
              const shared = sideCfgs.filter((c) => !c.axisGroup);
              // Non-shared axes GROUPED by key, in first-appearance order —
              // members naming the same group share one scale.
              const grouped = new Map<string, SeriesConfig[]>();
              for (const c of sideCfgs)
                if (c.axisGroup) grouped.set(c.axisGroup, [...(grouped.get(c.axisGroup) ?? []), c]);
              // One handler per axis: a click opens the panel; enter/leave
              // drive the hover affordance (the gutter is clickable, and
              // nothing else says so). `cursor` can't be set on the axis, so
              // hover speaks through the one presentation channel `<YAxis>`
              // has — its `color`, lifted toward the text colour (brighter in
              // dark, darker in light — the tokens already invert).
              const mouse = onAxisClick
                ? (axisId: string) => (e: AxisMouseEvent) => {
                    if (e.event.type === 'click')
                      onAxisClick({
                        rowId: row.id,
                        side,
                        axisId,
                        clientX: e.event.clientX,
                        clientY: e.event.clientY,
                        detail: e.event.detail,
                      });
                    else if (e.event.type === 'mouseenter') setHoverAxis(axisId);
                    else if (e.event.type === 'mouseleave')
                      setHoverAxis((cur) => (cur === axisId ? null : cur));
                  }
                : () => undefined;
              // A title pads its axis's domain (headroom for the title), and pond
              // pads BOTH ends. Pad one axis and its tick rows slide against its
              // neighbours', which undoes what `ticks` is for — so one titled
              // axis pads every axis on its side. Recorded as a pond ask: a
              // top-only pad, so a title does not also lift a `min: 0` floor.
              const sideAxisIds = [
                ...(shared.length > 0 ? [rowAxis(row.id, side)] : []),
                ...[...grouped.keys()].map((g) => seriesAxisId(row.id, side, g)),
              ];
              const sideTitled = sideAxisIds.some((a) => !!axisOptions?.[a]?.label);
              const axis = (id: string, cfgs: readonly SeriesConfig[]) => {
                // An axis takes its members' colour when they AGREE on one —
                // not just when there is exactly one of them. Two legs of a
                // pair, or a metric and its study, are one reading in one ink,
                // and the scale they share should say so; a genuinely MIXED
                // axis stays neutral, because no single colour is true of it
                // (Peter, 2026-08-18).
                const only = new Set(cfgs.map((c) => c.color));
                const own = only.size === 1 ? resolveColor(cfgs[0]!.color) : null;
                const opts = axisOptions?.[id];
                // The unit decides the shape, the axis's precision decides the
                // decimals (`axisFormat`); absent, every unit formats exactly as
                // it always did.
                const format = axisFormat(cfgs[0]!.unit, opts?.precision);
                // Pinned ticks need pinned bounds (a fraction of a free edge is
                // not a position) and a linear scale (equal fractions of a log
                // domain bunch toward the top).
                const scale = opts?.scaleType ?? 'linear';
                const ticks =
                  scale === 'linear' &&
                  opts?.ticks !== undefined &&
                  opts.min !== undefined &&
                  opts.max !== undefined
                    ? fractionTicks(opts.min, opts.max, opts.ticks, format)
                    : undefined;
                return (
                  <YAxis
                    key={id}
                    id={id}
                    side={side === 'R' ? 'right' : 'left'}
                    label={opts?.label ?? ''}
                    // A title sits at the top of its own gutter, exactly where
                    // the top tick label wants to be. Padding the domain pushes
                    // that tick down off the edge and leaves the title a clear
                    // line; the same pad on every titled axis keeps their rows
                    // aligned.
                    labelPlacement={opts?.label ? 'top' : undefined}
                    pad={sideTitled ? AXIS_LABEL_HEADROOM : undefined}
                    width={opts?.width}
                    ticks={ticks}
                    format={format}
                    scale={scale}
                    color={
                      hoverAxis === id
                        ? hoverInk(own ?? base.axis.label, colorScheme)
                        : (own ?? undefined)
                    }
                    // Each bound resolves on its own (a hard lock, else a manual
                    // pin, else the library's fit — `effectiveAxisBounds`), so a
                    // bar axis can run a nailed-down `0` floor under a free,
                    // auto-fitting top. An omitted bound is the auto one.
                    min={axisOptions?.[id]?.min}
                    max={axisOptions?.[id]?.max}
                    onMouseEvent={mouse(id)}
                    onBoundsChange={onAxisBounds ? (bounds) => onAxisBounds(id, bounds) : undefined}
                  />
                );
              };
              return [
                ...(shared.length > 0 ? [axis(rowAxis(row.id, side), shared)] : []),
                ...[...grouped].map(([g, cfgs]) => axis(seriesAxisId(row.id, side, g), cfgs)),
              ];
            };
            const showPill = !!pillCfg && row.configs.some((c) => c.id === pillCfg.id);
            return (
              <Fragment key={row.id}>
                <ChartRow height={row.height}>
                  {axesFor('L')}
                  <Layers>
                    {/* Markers first: `<Layers>` puts the last child on top, so
                        declaring them here keeps them behind every series. (The
                        library also pins `selectable={false}` marks to the back,
                        which makes this belt-and-braces rather than load-bearing —
                        but the declaration order is what a reader checks.)
                        Labelled on the first rendered row only; the rest draw the
                        line with no chip, so one date reads as one annotation
                        spanning the chart rather than as one per panel. */}
                    {shownAnnotations.map((a) =>
                      a.band ? (
                        <Region
                          key={`${a.id}:band`}
                          id={`${a.id}:band`}
                          from={a.band[0]}
                          to={a.band[1]}
                          // No chip from the band — the marker inside it carries
                          // the label, and the region's auto-label would print a
                          // raw date range beside it.
                          label={false}
                          // Fill only: side rules at both edges would put three
                          // verticals where the point is one.
                          edges={false}
                          role={a.role}
                          selectable={false}
                        />
                      ) : null,
                    )}
                    {shownAnnotations.map((a) => (
                      <Marker
                        key={a.id}
                        id={a.id}
                        at={a.at}
                        // No chips, for either kind (Peter, 2026-08-24): a shaded
                        // day-band and a dashed rule are each distinct enough to
                        // read unaided, and the captions were the whole of the
                        // density problem — 16 across the top at 1Y, two of them
                        // behind our own legend. `false` (not omitted) is required:
                        // omitting it auto-labels with the axis formatter.
                        label={false}
                        role={a.role}
                        selectable={false}
                      />
                    ))}
                    {/* `<Layers>` z-orders by declaration (last child on top), so
                        the configs render REVERSED: the row's FIRST config paints
                        last = on top. That makes the controls list read
                        front→back like a layers panel, so "move higher" in the
                        list means "closer to the front" on the canvas. */}
                    {[...visible].reverse().flatMap((c) => {
                      const src = c.source ? sources[c.source] : undefined;
                      // Column-level "show only what the data carries": a config
                      // whose column is absent from its (folded) series draws
                      // nothing rather than crashing pond's layer — the render
                      // half of `applyDerived`'s skip contract. First earned by
                      // cross-entity pairs: `ratio(iv21,cmp_iv21)` can't fold on
                      // the COMPARE series (no cmp_ columns there), so only its
                      // dashed counterpart must drop; and with compare off the
                      // primary fold skips too, so the spread gaps gracefully.
                      //
                      // Asked of `configColumns`, not of `c.column`: a BAND's
                      // `column` is a spec id naming three columns and is not
                      // itself in any schema, so testing it directly dropped
                      // every band before it could draw — the layer built fine
                      // and was never reached.
                      const cols = configColumns(c);
                      const carries = (s: ChartSeries | undefined): s is ChartSeries =>
                        !!s && cols.every((col) => s.schema.some((sc) => sc.name === col));
                      if (!carries(src)) return [];
                      // A PAIR states its own symbols, one per leg, so the
                      // blanket counterpart is not "the same thing on the other
                      // ticker" — it is a DIFFERENT pair, which the grammar says
                      // to ask for as one. Same for a study built on a spread
                      // (Peter, 2026-08-18). This is the first bite out of the
                      // blanket `__cmp` render; the rest goes with the leg group.
                      // No blanket counterpart for a PAIR — joined (the spec
                      // is a pair op) or split (a leg group member). A pair
                      // names a symbol per leg either way, so a dashed twin is
                      // a different pair, not the same thing on another ticker.
                      // Gating both keeps fn() honest: `None` draws TWO lines,
                      // not four (Peter, 2026-08-18).
                      return layer(
                        c,
                        src,
                        configAxisId(row.id, c),
                        !!c.source && ohlc.has(c.source),
                      );
                    })}
                    {showPill && pricePill && (
                      <YAxisIndicator
                        source={pricePill.source}
                        axis={configAxisId(row.id, pillCfg)}
                        color={resolveColor(pricePill.color)}
                        format={(v: number) => `$${v.toFixed(2)}`}
                        line
                      />
                    )}
                  </Layers>
                  {/* Right axes AFTER <Layers> — the row lays children out in
                      order, so left gutters precede the plot and right gutters
                      follow it (the documented multi-axis authoring order). */}
                  {axesFor('R')}
                </ChartRow>
                {i < renderedRows.length - 1 && splitters?.[i]}
              </Fragment>
            );
          })}
          {/* Explicit time axis (showAxis off) for the charts-0.47 date layout:
              the flat single-row style (inline month/year turns — the
              TradingView look; pinned explicitly, not left to the default) with
              labels beside right-extended ticks. Replaces the old dailyTime
              container timeFormat, which as a custom format would opt the axis
              out of the flat style entirely. */}
          <TimeAxis dateStyle="flat" align="right" />
        </ChartContainer>
      )}
    </div>
  );
}

/** Memoized export — hover state in the terminal re-renders the chips, not the
 *  canvas. */
export const TimeSeriesChart = memo(TimeSeriesChartInner);

const S: Record<string, CSSProperties> = {
  wrap: { width: '100%', minHeight: 1 },
};
