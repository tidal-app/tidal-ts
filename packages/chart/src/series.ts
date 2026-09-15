/** The config for one plotted series — shared by the legend chips, the controls
 *  popover, and the chart. The chart reads `color`/`axis`/`style`/`visible`; the
 *  chips + controls read `label`/`value`/`unit`. **`id` is identity, `column` is
 *  data** — see {@link SeriesConfig}; they are deliberately two fields. */
export type SeriesAxis = 'L' | 'R';

/** Draw style for the PRIMARY ticker's series. `line`/`area`/`bar` apply to any
 *  series; `candle` (a first-class OHLC candlestick — `@pond-ts/charts`
 *  `<Candlestick>`) needs OHLC columns, so it's offered only on the price series.
 *  `bar`/`candle` bin the series into {@link SeriesConfig.window} windows (pond
 *  aggregates). Note: `dashed` is NOT a style — dashing is
 *  reserved to encode the comparison ticker (texture = primary/compare, color =
 *  series), applied automatically by the chart, never chosen per series. */
export type SeriesStyle = 'line' | 'area' | 'bar' | 'candle' | 'band' | 'lines';

/**
 * The three columns a `band` config reads. Its `column` is the SPEC ID, which
 * for a multi-output op is a PREFIX rather than a column of its own — the
 * engine names `${id}Middle` / `Upper` / `Lower` off it. So a band is the one
 * style whose `column` is not directly readable, and everything that scans a
 * config's data (extent, hover, render) goes through here instead.
 */
export function bandColumns(column: string): { middle: string; upper: string; lower: string } {
  const [middle, upper, lower] = BAND_OUTPUTS.map((suffix) => `${column}${suffix}`);
  return { middle: middle!, upper: upper!, lower: lower! };
}

/**
 * Whether a config draws a bar-marked output — i.e. whether the rise/fall
 * toggle means anything for it.
 *
 * A `lines` config is a multi-output study, and only some of those carry a
 * histogram among their outputs (a MACD does; a stochastic does not). Offering
 * the toggle on a study with nothing to colour would be a control that does
 * nothing.
 */
export function hasBarOutput(c: Pick<SeriesConfig, 'style' | 'derive'>): boolean {
  if (c.style !== 'lines' || !c.derive) return false;
  const op = c.derive.op;
  return opOutputs(op).some((suffix) => outputMark(op, suffix) === 'bar');
}

/**
 * The per-output theme key for a `lines` config.
 *
 * One colour, N textures — a study's outputs are ONE series (a MACD is one
 * study), so varying colour across them would fight the "colour = series"
 * encoding. Mirrors the `__cmp` key, which does the same thing for a
 * comparison counterpart.
 */
export const outputKey = (id: string, i: number): string => `${id}__o${i}`;

/**
 * The columns a config actually reads — one for most styles, three for a
 * `band`, and one per declared output for `lines`.
 *
 * The single place that answers "what data does this config touch?", so a new
 * multi-output study doesn't have to be found in five scanners. A `lines`
 * config needs its `derive` to answer, because the suffixes come from the op's
 * declaration; without one it degrades to its bare column rather than throwing
 * (a persisted config can outlive the op that named it).
 */
export function configColumns(c: {
  column: string;
  style: SeriesStyle;
  derive?: DeriveSpec;
}): string[] {
  if (c.style === 'band') {
    const b = bandColumns(c.column);
    return [b.middle, b.upper, b.lower];
  }
  if (c.style === 'lines') {
    if (!c.derive) return [c.column];
    return opOutputs(c.derive.op).map((suffix) => `${c.column}${suffix}`);
  }
  return [c.column];
}

// The aggregation window for `bar`/`candle` + the study `DeriveSpec` are owned by
// `@tidal-ts/core` (where the windowing + derive seam live) — imported for
// `SeriesConfig` below and re-exported so UI code has one import site for the
// series vocabulary.
import {
  BAND_OUTPUTS,
  COMPARE_PREFIX,
  opOutputs,
  opParams,
  outputMark,
  usesCompare,
} from '@tidal-ts/core';
import type { DeriveSpec, SeriesWindow } from '@tidal-ts/core';
export type { DeriveSpec, SeriesWindow };

// Candle-only sub-options, straight off `<Candlestick>`: the mark shape and what
// drives its colour. Re-exported so the controls + app share one vocabulary.
import type { CandleVariant, ColorBy } from '@pond-ts/charts';
export type { CandleVariant, ColorBy };

// The app-wide presentation defaults the category resolvers below read.
import {
  DEFAULT_CHART_SETTINGS,
  type CategoryLineStyle,
  type ChartSettings,
} from './chartSettings.js';

/**
 * One seated series.
 *
 * **`id` and `column` are two different things, and keeping them apart is the
 * point.** `id` is the config's *identity*: an opaque key its host mints once
 * (`s-3`) and never rewrites — it keys selection, expansion, the chart theme
 * (`as={c.id}`), the tracker, axis membership (`configAxisId`) and every user
 * override. `column` is the *data*: the column this config reads out of its
 * `source`, which for a derived config is `deriveId(derive)` and is therefore
 * **recomputed on every spec edit**.
 *
 * They used to be one string, which meant editing a study's period (or a pair
 * leg, or a tenor) minted a new identity and silently threw away the user's
 * colour, axis and pins. An id is never a column name and must never be used as
 * one — the two are unrelated strings by construction, so a mix-up reads no data
 * at all rather than quietly reading the wrong thing.
 */
export interface SeriesConfig {
  /** Stable identity — opaque, minted by the host, **never** parsed or used as a
   *  data column. Survives every edit to the config's spec. */
  id: string;
  /** The data column to read from the config's `source`. A raw metric names a
   *  feed column (`iv21`, `close`); a derived one names its folded output
   *  (`deriveId(derive)`), which changes whenever the spec does. */
  column: string;
  label: string;
  /** A curated palette **key** (`'blue'`, resolved by the host's palette) or a raw custom
   *  CSS color from the controls' escape hatch. DOM resolves it via
   *  `seriesStrokeVar`, the canvas via `chartTheme.resolveSeriesColor`. */
  color: string;
  axis: SeriesAxis;
  /**
   * Which y-axis on its side this series scales on — the axis panel's
   * membership.
   *
   * Absent ⇒ the side's SHARED axis. A string names a separate axis on that
   * side, and series naming the same one **share a scale** — which a boolean
   * `ownAxis` could not express: two unlinked series each got a private axis
   * with no way to put them together (Peter, 2026-08-18, wanting to drag one
   * member onto another's axis).
   *
   * Unlinking mints the config's own id as the key, so an own axis keeps the
   * id it always had (`rowId:side:configId`) and its range pin with it. A
   * non-shared axis never binds the side's unit (the unit gate applies to
   * shared members only), which is what lets a unitless spread arrive on a
   * bound side.
   */
  axisGroup?: string;
  style: SeriesStyle;
  /** Aggregation window for `bar`/`candle`. Defaults to `'1d'` (the native bar) —
   *  ignored by `line`/`area`, which draw the raw series. */
  window?: SeriesWindow;
  /** Candle-only: the mark shape (`<Candlestick variant>`). Default `'candle'`. */
  candleVariant?: CandleVariant;
  /** Candle-only: `'series'` (one colour — the series' `color`) or `'direction'`
   *  (market green/red off open-vs-close). Default `'series'`. */
  candleColorBy?: ColorBy;
  visible: boolean;
  /** Which keyed data source this series reads (`'vol'` / `'price'`) in the
   *  rows model — rows are viewports, sources are a separate axis. Defaults to
   *  the row's source at the render boundary. */
  source?: string;
  /** Latest value for the chip/controls readout (null until data). */
  value: number | null;
  /** Value suffix, e.g. `%`. */
  unit?: string;
  /** For a tenor-bearing metric: the family name (`ATM Vol`) + its tenor. The
   *  controls show the family on the main row and the tenor on a params sub-line
   *  (`21D`), so the identity reads as name + params rather than one long label. */
  family?: string;
  tenor?: number;
  /** Which censor variant this series reads, when its metric takes that
   *  parameter (`'i'` / `'h'` / `'on'` / `'off'` — the host's censor vocabulary).
   *  Shown on the params sub-line beside the tenor, and editable there.
   *
   *  The `column` is the truth and this follows it; it is carried on the config
   *  so the controls can render the current choice without a catalog lookup, the
   *  same way `family`/`tenor` are. */
  censor?: string;
  /** A **leg group** member — one leg of an unjoined pair. Absent for every
   *  ordinary series and for a JOINED pair (which is a single config).
   *  See {@link SeriesGroup}. */
  group?: SeriesGroup;
  /** A **study**: this series induces its column (`sma(20)` of another) rather
   *  than reading raw data — so `column === deriveId(derive)` and moves with the
   *  spec, while `id` stands still. The render folds the op onto the source
   *  series via `applyDerived`. Absent ⇒ raw. */
  derive?: DeriveSpec;
  /** Stroke width (px) for `line`/`area`. Omitted ⇒ the category default from
   *  the chart settings (see {@link seriesLineWidth}). */
  lineWidth?: number;
  /** Direction coloring for a `bar`/`candle` series: `'split'` (rise/fall pair)
   *  vs `'single'` (the series' own `color`). Omitted ⇒ the chart settings'
   *  default for that mark (legacy `candleColorBy` respected as a fallback). */
  colorMode?: 'single' | 'split';
  /** Split-mode rise/fall color keys (palette / `positive`·`negative` market
   *  keys / raw CSS). Omitted ⇒ the chart settings' defaults. */
  riseColor?: string;
  fallColor?: string;
}

// --- Axis identity ------------------------------------------------------------
// One vocabulary for the chart (renders the axes), the machine (keys the range
// state), and the host (builds the panel model). A row-side's SHARED axis is
// `rowId:side`; an unlinked series' OWN axis appends its config id. Config ids
// (engine specIds) contain `:`/parens, so these ids are built here and never
// parsed — carry `rowId`/`side` alongside wherever they're needed.

/** A row-side's shared axis id (once the chart's private `rowAxis`). */
export const sharedAxisId = (rowId: string, side: SeriesAxis): string =>
  `${rowId}:${side === 'R' ? 'R' : 'L'}`;

/** A non-shared axis's id on a row side, keyed by its group. */
export const seriesAxisId = (rowId: string, side: SeriesAxis, group: string): string =>
  `${sharedAxisId(rowId, side)}:${group}`;

/** The axis a config actually scales on: its own when unlinked, else the shared. */
export const configAxisId = (rowId: string, c: Pick<SeriesConfig, 'axis' | 'axisGroup'>): string =>
  c.axisGroup ? seriesAxisId(rowId, c.axis, c.axisGroup) : sharedAxisId(rowId, c.axis);

/** Per-axis range state (the terminal machine's `axisRanges` values): `manual`
 *  pins the axis to `[min, max]`; `auto` with values present is the **preserved
 *  manual memory** (the legacy triple — "Auto fit was …" / re-manual restores).
 *  An axis with no entry at all has simply never been touched. `unit` is the
 *  unit the pin was set FOR: a shared axis id (`rowId:side`) can be re-bound
 *  to a different unit later (remove the old series, move a new one over), and
 *  a pin only applies while the axis still reads in its unit — a mismatched
 *  entry is treated as absent everywhere (PR #132 review, MEDIUM). */
export interface AxisRange {
  mode: 'auto' | 'manual';
  /** The manual pin, and its preserved memory once `mode` is back to `auto`.
   *  **Optional**, because an axis can carry a {@link AxisRange.lockMin} without
   *  ever having been pinned — a bar's zero floor is not a manual range, and
   *  fabricating one would put a bogus "Auto fit was …" memory behind it. */
  min?: number;
  max?: number;
  unit: string;
  /**
   * HARD LIMITS on each bound, independent of {@link mode}. A number fixes that
   * bound against **both** auto-fit and gestures; absent leaves it free.
   *
   * Deliberately separate fields from `min`/`max`: those are the manual pin (and
   * its preserved memory when `mode` is back to `auto`), which is a different
   * thing — an axis can be auto-fitting its top while its floor is nailed to
   * zero, and one pair of numbers cannot say that.
   *
   * The reason they exist: a bar rests on a baseline, and a baseline that slides
   * under a pan reads as the data moving. Locking `min` to `0` states that as a
   * constraint on the axis rather than as a special mode for the gesture — so
   * there is no "is this axis in bar mode?" question to get wrong at gesture
   * time, and the user can see the lock and switch it off (`TDL-AXISLOCK`).
   */
  lockMin?: number;
  lockMax?: number;
  /**
   * What an AUTO axis fits to: `'viewport'` (the default, and what the library
   * has always done — the extent of what is on screen) or `'metric'` (the whole
   * series, so the scale holds still while you pan across it).
   *
   * Only consulted while `mode` is `auto`; a manual pin has already answered the
   * question. Ignored per-bound wherever a lock has.
   */
  autoBasis?: 'metric' | 'viewport';
  /**
   * Fit symmetrically about zero — `[-m, +m]` for `m` the larger absolute
   * bound. The honest scale for a signed series (a spread, a change), where an
   * asymmetric fit makes a small move look like a large one on whichever side
   * happens to be tighter.
   */
  centerZero?: boolean;
  /**
   * Decimal places for this axis's tick labels, 0–4. Absent keeps each unit's
   * own default (`%` one place, `$` whole dollars, a count compacted to
   * `1.2M`). It overrides the DECIMALS only — the unit keeps its symbol and
   * placement, so `$` at 0 reads `$162` and at 3 reads `$161.760`.
   */
  precision?: number;
  /**
   * The scale this axis draws on. `log` is base-10, for data spanning orders of
   * magnitude.
   *
   * **`log` and a `0` bound lock are mutually exclusive** — log(0) is undefined,
   * so an axis cannot both be logarithmic and contain zero. The panel refuses
   * `log` while either bound is locked at 0 rather than silently dropping the
   * lock (which would move a bar's baseline, the exact failure the lock exists
   * to prevent). Unlock the bound first.
   *
   * `symlog` — linear through zero, logarithmic beyond — is the scale that CAN
   * hold both, and charts supports it; it is deliberately not offered yet
   * (Peter asked for linear|log).
   */
  scaleType?: 'linear' | 'log';
}

/**
 * Whether an axis's entry says nothing — no lock, no pin, no memory, no format
 * or fit choice — and can therefore be dropped rather than accumulate an empty
 * per axis ever touched.
 *
 * **One definition on purpose.** Each writer used to carry its own copy of this
 * test, and two of the three had fallen behind the fields the type had grown:
 * clearing a lock deleted the axis's `precision` and `scaleType` with it, and
 * toggling centre-zero off did the same. A predicate that lives beside the type
 * cannot drift from it that way.
 */
export function axisRangeIsEmpty(r: AxisRange): boolean {
  return (
    r.mode === 'auto' &&
    r.min === undefined &&
    r.max === undefined &&
    r.lockMin === undefined &&
    r.lockMax === undefined &&
    r.autoBasis === undefined &&
    r.centerZero === undefined &&
    r.precision === undefined &&
    r.scaleType === undefined
  );
}

/** The 0–4 precision choices an axis offers. */
export const AXIS_PRECISIONS = [0, 1, 2, 3, 4] as const;

/**
 * Whether `log` may be chosen for an axis. A log scale cannot contain zero or
 * anything below it, so any bound the STATE nails at or under `0` — a hard lock
 * or a manual pin — refuses it. The reason is the second element, for the
 * disabled control's tooltip.
 *
 * Only what the range can state is checked. An AUTO fit that happens to span
 * zero is a property of the data, not of this record, so it is the chart's to
 * handle (PR #173 review, LOW: the old test was `=== 0` on the two locks, which
 * let a hand-locked `-5` floor through while the doc claimed the stronger
 * property).
 */
export function logAllowed(range: AxisRange | undefined): [boolean, string?] {
  if (!range) return [true];
  const nonPositive = (v: number | undefined) => v !== undefined && v <= 0;
  if (nonPositive(range.lockMin) || nonPositive(range.lockMax))
    return [false, 'A log axis cannot reach 0 — unlock the bound pinned there first'];
  if (range.mode === 'manual' && (nonPositive(range.min) || nonPositive(range.max)))
    return [false, 'A log axis cannot reach 0 — raise the manual bounds above it first'];
  return [true];
}

/**
 * An axis tick formatter: the unit's own format, with `precision` overriding
 * how many decimals it carries.
 *
 * Precision changes the DECIMALS, never the unit's identity — `$` keeps its
 * symbol in front, `%` its sign behind, a count its compact `M`/`K` suffix, and
 * a variance its exponential form (where the precision is the mantissa's).
 * Omitted, every unit formats exactly as it did before this existed.
 *
 * The returned function is MEMOISED on `(unit, precision)`. `<YAxis format>` is
 * the one axis prop the library cannot value-compare (`YAxis.d.ts`: a fresh
 * function reference re-registers the axis every render), and the call site is
 * an inline prop inside a render, so a stable identity has to come from here.
 * The cache is bounded by the unit vocabulary × six precisions.
 */
const AXIS_FORMATS = new Map<string, (v: number) => string>();

export function axisFormat(unit: string | undefined, precision?: number): (v: number) => string {
  const key = `${unit ?? ''}|${precision ?? ''}`;
  const memo = AXIS_FORMATS.get(key);
  if (memo) return memo;
  const built = buildAxisFormat(unit, precision);
  AXIS_FORMATS.set(key, built);
  return built;
}

function buildAxisFormat(unit: string | undefined, precision?: number): (v: number) => string {
  const p = precision;
  // Same accounting convention as the chips: a MACD axis ran `$5 / $0 / $-5`
  // before this, where the tick beside it now reads `($5)`.
  if (unit === '$') return (v) => formatCurrency(v, p === undefined ? 0 : p);
  if (unit === '%') return (v) => `${v.toFixed(p ?? 1)}%`;
  if (unit === 'variance') return (v) => v.toExponential(p ?? 1);
  if (unit === 'count') {
    const fmt = new Intl.NumberFormat('en', {
      notation: 'compact',
      maximumFractionDigits: p ?? 1,
    });
    return (v) => fmt.format(v);
  }
  // The unitless default keeps its "compact above 10k" rule, which is about
  // legibility rather than decimals, so precision tunes only the plain branch.
  const compact = new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: p ?? 1,
  });
  return (v) => (Math.abs(v) >= 10_000 ? compact.format(v) : v.toFixed(p ?? 1));
}

/** Make a fitted extent symmetric about zero — `[-m, +m]`. `null` when there is
 *  nothing to centre (no data), so the caller falls back to the library's fit. */
export function centerOnZero(
  fit: { min: number; max: number } | null | undefined,
): { min: number; max: number } | null {
  if (!fit) return null;
  const m = Math.max(Math.abs(fit.min), Math.abs(fit.max));
  // An all-zero series has no magnitude to mirror; leave it to the library
  // rather than emitting the degenerate [0, 0] no axis can draw.
  return m > 0 ? { min: -m, max: m } : null;
}

/**
 * What to hand `<YAxis min|max>` for an axis — a lock first, then the manual
 * pin, else `undefined` for the library's auto fit.
 *
 * The two bounds resolve independently, which is the point: a bar axis normally
 * runs with a hard `0` floor and a free, auto-fitting top.
 */
export function effectiveAxisBounds(
  range: AxisRange | undefined,
  /** The host's computed AUTO fit for this axis, when its `autoBasis` /
   *  `centerZero` ask for one the library would not produce by itself. Consulted
   *  only under `mode: 'auto'`, and only where no lock has already spoken. */
  fitted?: { min: number; max: number } | null,
): {
  min?: number;
  max?: number;
} {
  if (!range) return {};
  const manual = range.mode === 'manual';
  const auto = manual ? undefined : (fitted ?? undefined);
  return {
    min: range.lockMin ?? (manual ? range.min : auto?.min),
    max: range.lockMax ?? (manual ? range.max : auto?.max),
  };
}

/**
 * Apply an axis's locks to bounds a GESTURE reported — the enforcement half of
 * "a lock is a hard limit".
 *
 * The axes are controlled: charts reports where a drag or wheel would take the
 * axis and the host decides what to write back. So a locked bound is simply not
 * taken from the gesture, which is what makes the zero floor unpannable rather
 * than merely re-drawn.
 */
export function clampBoundsToLocks(
  range: AxisRange | undefined,
  bounds: readonly [number, number],
): [number, number] {
  return [range?.lockMin ?? bounds[0], range?.lockMax ?? bounds[1]];
}

/**
 * The DEFAULT locks for an axis, from what it carries — the rule that gives a
 * bar its baseline for free.
 *
 * All-positive bars lock `min` to `0`; all-negative lock `max` to `0`. Any
 * non-bar member removes the lock: a line has no baseline to protect, and it
 * should not inherit a floor it never asked for.
 *
 * **Bars that straddle zero get no lock** (Peter, 2026-08-29). Their baseline
 * sits inside the plot, where neither bound can hold it — locking `min` would
 * pin the wrong thing. Better to leave it free than invent a rule.
 *
 * A derived default, re-seeded when an axis's membership changes, so an axis
 * that returns to all-bars gets its floor back.
 *
 * @param autoMin the axis's auto fit — the sign test. `null` (no data) yields no
 *   lock, so an empty axis is never nailed to a floor it cannot justify.
 */
export function barZeroLock(
  cfgs: readonly SeriesConfig[],
  autoMin: number | null,
  autoMax: number | null,
): { lockMin?: number; lockMax?: number } {
  if (cfgs.length === 0 || !cfgs.every((c) => c.style === 'bar')) return {};
  if (autoMin == null || autoMax == null) return {};
  if (autoMin >= 0) return { lockMin: 0 };
  if (autoMax <= 0) return { lockMax: 0 };
  return {};
}

/**
 * Which symbol a seated series reads — the control panel's binding chip.
 *
 * - `primary` — the ticker bar's main symbol; the chip is **outlined**.
 * - `compare` — the comparison ROLE, so it re-resolves when the compare ticker
 *   changes; the chip is **dashed-outlined**, matching the dashed ink that
 *   encodes compare on the canvas.
 * - `pinned` — fixed to one named symbol whatever the bar says; the chip is
 *   **grey-filled**, the heaviest of the three because it is the one binding
 *   that does NOT follow the workspace (the binding-legibility rule in
 *   Tidal's pairs plan: a ticker that doesn't track the bar must be visible).
 */
export interface SeriesBinding {
  kind: 'primary' | 'compare' | 'pinned';
  /** The resolved symbol to print (`AAPL`). */
  symbol: string;
}

// --- Pairs: the fn() vocabulary and the node's projected tree -----------------

/** The pair transforms (TDL-PAIR). Local literal union — this presentational
 *  package doesn't depend on the core seam's types. */
export type PairJoinOp = 'diff' | 'ratio' | 'logRatio';

/** What fn() can be set to — a join, or **`'none'`**: no transform, so the pair
 *  draws its two legs as separate inks instead of one spread (the LEG GROUP).
 *  George's taxonomy maps onto exactly this: `none` pairs are the "2–4 overlaid
 *  spaghetti", joined pairs are the spread reads. */
export type PairLensOp = PairJoinOp | 'none';

/** The JOINS — what the pair PICKER offers at add time (a pair is built by
 *  choosing a transform), and the subset of fn() that yields one line. One
 *  list, so the picker and the fn() node can't drift on naming or order. */
export const PAIR_JOINS: readonly { op: PairJoinOp; glyph: string; hint: string }[] = [
  { op: 'diff', glyph: 'A − B', hint: 'difference' },
  { op: 'ratio', glyph: 'A / B', hint: 'ratio' },
  { op: 'logRatio', glyph: 'log(A/B)', hint: 'log ratio' },
];

/** Every fn() option, in display order — the joins plus `None`, which leads
 *  because it is the least of them: no transform at all. */
export const PAIR_LENSES: readonly { op: PairLensOp; glyph: string; hint: string }[] = [
  { op: 'none', glyph: 'None', hint: 'draw both legs, no transform' },
  ...PAIR_JOINS,
];

/**
 * A **leg group** member: one leg of an UNJOINED pair.
 *
 * With no transform there is no single line and therefore no single ink, so an
 * unjoined pair is not one config but two — each an ordinary series with its
 * own colour, axis, eye and study pipeline — tied together by this group.
 *
 * A pair's fn() is fixed when it is created (Peter, 2026-08-18), so there is no
 * join to remember and no way back to a spread: a group is simply what an
 * unjoined pair IS. That is what keeps every downstream reader honest — one
 * config still means one column, so the render, the axis policy, the extents
 * and the dependency walks work on a leg with no special case.
 */
export interface SeriesGroup {
  /** Shared by both legs — the pair's identity. */
  id: string;
  /** Which leg this is: the pair row names them in A-then-B order. */
  side: 'A' | 'B';
  /** The pair's own eye: set on BOTH members together. A leg keeps its own
   *  `visible` while an ancestor hides it, so unhiding the pair restores what
   *  each leg was, rather than turning everything on. */
  hidden?: boolean;
}

/**
 * One leg of a seated pair, as the control panel shows it — the **Metric/Part**
 * node of the control tree.
 *
 * A part is not a seated config: it exists only as structure inside the pair's
 * spec, so the host projects it (it owns the catalog that turns a column into a
 * name). Same node type as a top-level metric, which is the unification the
 * tree design rests on: "a part is just a metric which is part of a pair".
 */
export interface PairPartView {
  /** The leg's side, as the fn() glyphs name it. */
  side: 'A' | 'B';
  /** The metric's display name — no studies, no role suffix (both are their
   *  own affordances on the row). */
  label: string;
  /** Which symbol this leg reads. A ticker prints only for a PINNED leg. */
  binding?: SeriesBinding;
  /** The studies wrapping the metric, in application order (`SMA(20)`). */
  studies: readonly string[];
}

/** A seated pair, projected for the panel: its current lens and its two parts. */
export interface PairView {
  op: PairLensOp;
  parts: readonly PairPartView[];
}

/**
 * Whether a series actually DRAWS — its own eye, and every ancestor's.
 *
 * A leg keeps its own `visible` while the pair above it is hidden, so unhiding
 * the pair restores what each leg was rather than switching everything on. The
 * panel therefore shows the leg's OWN eye (dimmed, because something above it
 * is doing the hiding); the chart asks this.
 */
export const seriesDrawn = (c: Pick<SeriesConfig, 'visible' | 'group'>): boolean =>
  c.visible && !c.group?.hidden;

/** The stroke widths offered in the controls + settings (px). */
export const LINE_WIDTHS = [0.5, 1, 1.5, 2] as const;

/** The dash pattern a `'dashed'` category draws with (also the compare texture). */
export const DASH_PATTERN: readonly [number, number] = [6, 4];

/** Whether a series is a windowed **study** (an SMA/EMA overlay — the "Derived"
 *  style category). A pointwise derived metric (the realized-vol line) and every
 *  raw column read as **metrics**. */
export function isStudySeries(s: SeriesConfig): boolean {
  // Asked of the REGISTRY, not of `params.period`: a period-shaped test answers
  // "is this windowed?", which was the same question only while every tunable
  // op had exactly one param with that name (PR #181 review, MEDIUM).
  return s.derive ? opParams(s.derive.op).length > 0 : false;
}

/** True if a series reads the COMPARISON symbol — a spec whose leaves are
 *  `cmp_`-prefixed, or (an unjoined pair's leg) a raw `cmp_` column. */
export function readsCompare(s: Pick<SeriesConfig, 'derive' | 'column'>): boolean {
  return s.derive ? usesCompare(s.derive) : s.column.startsWith(COMPARE_PREFIX);
}

/** The style category a series' line defaults come from. A comparison-reading
 *  series takes the `comparisons` category (dashed) whatever else it is — the
 *  texture encodes the SYMBOL, so a study of a compare leg is dashed too. */
export function seriesCategoryStyle(s: SeriesConfig, settings: ChartSettings): CategoryLineStyle {
  if (readsCompare(s)) return settings.comparisons;
  return isStudySeries(s) ? settings.derived : settings.metrics;
}

/** A series' stroke width: its explicit `lineWidth` override, else its category
 *  default from the settings (metrics vs studies). */
export function seriesLineWidth(
  s: SeriesConfig,
  settings: ChartSettings = DEFAULT_CHART_SETTINGS,
): number {
  return s.lineWidth ?? seriesCategoryStyle(s, settings).weight;
}

/** A series' dash pattern (`undefined` = solid) from its category's style. */
export function seriesLineDashArray(
  s: SeriesConfig,
  settings: ChartSettings = DEFAULT_CHART_SETTINGS,
): readonly [number, number] | undefined {
  return seriesCategoryStyle(s, settings).dash === 'dashed' ? DASH_PATTERN : undefined;
}

/** The effective direction-coloring of a `bar`/`candle` series: the per-series
 *  override, else the legacy candle `candleColorBy` (old presets), else the
 *  settings default for that mark kind. Rise/fall fall back to the settings'
 *  colors. Meaningless (single) for a `line`/`area` series. */
export function effectiveSplit(
  s: SeriesConfig,
  settings: ChartSettings = DEFAULT_CHART_SETTINGS,
): { mode: 'single' | 'split'; rise: string; fall: string } {
  const def = s.style === 'candle' ? settings.candles : settings.bars;
  const legacy =
    s.style === 'candle' && s.candleColorBy != null
      ? s.candleColorBy === 'direction'
        ? 'split'
        : 'single'
      : undefined;
  const mode =
    s.style === 'lines'
      ? // A study's histogram is OPT-IN, and never inherits the app's bar
        // default: a MACD keeps the study's own colour until asked otherwise,
        // because green/red is reserved for market data and an indicator is not
        // that. The toggle is the asking.
        (s.colorMode ?? 'single')
      : s.style === 'bar' || s.style === 'candle'
        ? (s.colorMode ?? legacy ?? (def.split ? 'split' : 'single'))
        : 'single';
  return { mode, rise: s.riseColor ?? def.rise, fall: s.fallColor ?? def.fall };
}

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });

/**
 * A negative currency amount in the accounting convention: `($2.75)`, not
 * `$-2.75`.
 *
 * The sign belongs to the AMOUNT, so it wraps the whole thing rather than
 * wedging a minus between the symbol and the digits — which is how every
 * finance surface writes it, and which stopped being a hypothetical the moment
 * a `delta`-unit study (a MACD of a price) put negative dollars on screen.
 * Applies to the axis ticks too, so a chip and the axis beside it agree.
 */
export const formatCurrency = (v: number, digits: number): string =>
  v < 0 ? `($${Math.abs(v).toFixed(digits)})` : `$${v.toFixed(digits)}`;

/** Format a series value for a chip/row. Currency (`$`) leads the value
 *  (`$161.76`), and a negative reads `($2.75)` — see {@link formatCurrency};
 *  `count` (volume/shares) compacts to `1.18M` with no suffix;
 *  `log` is a SCALE rather than a suffix, so a log-ratio reads `-0.23`, not
 *  `-0.23log` (the unit still keeps it off a unitless axis); a percent /
 *  unitless suffix trails the value (`22.65%`). */
export function formatSeriesValue(value: number | null, unit = ''): string {
  if (value == null) return '—';
  if (unit === 'count') return COMPACT.format(value);
  if (unit === 'variance') return value.toExponential(1); // tiny raw decimal
  if (unit === 'log') return value.toFixed(2);
  if (unit === '$') return formatCurrency(value, 2);
  return `${value.toFixed(2)}${unit}`;
}
