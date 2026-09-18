import { describe, expect, it } from 'vitest';
import {
  configColumns,
  outputKey,
  type SeriesStyle,
  effectiveSplit,
  formatSeriesValue,
  seriesLineDashArray,
  seriesLineWidth,
  effectiveAxisBounds,
  clampBoundsToLocks,
  barZeroLock,
  centerOnZero,
  axisFormat,
  fractionTicks,
  logAllowed,
  type AxisRange,
  type SeriesConfig,
} from './series.js';
import { DEFAULT_CHART_SETTINGS, mergeChartSettings, type ChartSettings } from './chartSettings.js';
import { deriveId, type DeriveSpec } from '@tidal-ts/core';

const cfg = (over: Partial<SeriesConfig>): SeriesConfig => ({
  id: 'x',
  column: 'x',
  label: 'x',
  color: 'blue',
  axis: 'L',
  style: 'line',
  visible: true,
  value: null,
  ...over,
});

describe('formatSeriesValue', () => {
  it('formats with two decimals + unit', () => {
    expect(formatSeriesValue(22.654, '%')).toBe('22.65%');
    expect(formatSeriesValue(-3.9, '%')).toBe('-3.90%');
  });

  it('renders a dash for null', () => {
    expect(formatSeriesValue(null, '%')).toBe('—');
  });

  it('omits the unit when absent', () => {
    expect(formatSeriesValue(1.5)).toBe('1.50');
  });

  it('compacts a count (volume/shares) with no unit suffix', () => {
    expect(formatSeriesValue(1176424, 'count')).toBe('1.18M');
    expect(formatSeriesValue(950, 'count')).toBe('950');
  });

  it('prints a log-ratio bare — `log` is a scale, not a suffix', () => {
    // The unit still does its real job (keeping a log-ratio off a unitless
    // axis); it just isn't something to append to the number. `-0.23log` was
    // what the registry's declared unit produced before this case existed.
    expect(formatSeriesValue(-0.234, 'log')).toBe('-0.23');
  });
});

describe('seriesLineWidth / seriesLineDashArray', () => {
  const STUDY = { op: 'sma', inputs: ['iv21'], params: { period: 20 } } as const;

  it('defaults by category from the settings — metrics 1.5 solid, studies 0.5 solid', () => {
    expect(seriesLineWidth(cfg({ unit: '%' }))).toBe(1.5); // a raw metric
    expect(seriesLineWidth(cfg({ unit: '$' }))).toBe(1.5); // price is a metric too
    expect(seriesLineWidth(cfg({ unit: '%', derive: STUDY }))).toBe(0.5); // a windowed study
    expect(seriesLineDashArray(cfg({ unit: '%' }))).toBeUndefined(); // solid
    expect(seriesLineDashArray(cfg({ unit: '%', derive: STUDY }))).toBeUndefined();
  });

  it('treats a pointwise derived metric (no period) as a metric, not a study', () => {
    expect(
      seriesLineWidth(cfg({ unit: '%', derive: { op: 'realizedVol', inputs: ['ccVar'] } })),
    ).toBe(1.5);
  });

  it('reads custom settings — category weight + dashed style', () => {
    const settings: ChartSettings = {
      ...DEFAULT_CHART_SETTINGS,
      metrics: { dash: 'dashed', weight: 2 },
      derived: { dash: 'solid', weight: 1 },
    };
    expect(seriesLineWidth(cfg({}), settings)).toBe(2);
    expect(seriesLineDashArray(cfg({}), settings)).toEqual([6, 4]);
    expect(seriesLineWidth(cfg({ derive: STUDY }), settings)).toBe(1);
    expect(seriesLineDashArray(cfg({ derive: STUDY }), settings)).toBeUndefined();
  });

  it('honors an explicit per-series override over every default', () => {
    expect(seriesLineWidth(cfg({ unit: '$', lineWidth: 0.5 }))).toBe(0.5);
  });
});

describe('effectiveSplit', () => {
  it('defaults a bar/candle to the settings (split, market green/red); line stays single', () => {
    expect(effectiveSplit(cfg({ style: 'bar' }))).toEqual({
      mode: 'split',
      rise: 'positive',
      fall: 'negative',
    });
    expect(effectiveSplit(cfg({ style: 'candle' })).mode).toBe('split');
    expect(effectiveSplit(cfg({ style: 'line' })).mode).toBe('single');
  });

  it('follows the settings default when single-color is chosen there', () => {
    const settings: ChartSettings = {
      ...DEFAULT_CHART_SETTINGS,
      bars: { split: false, rise: 'positive', fall: 'negative' },
    };
    expect(effectiveSplit(cfg({ style: 'bar' }), settings).mode).toBe('single');
    expect(effectiveSplit(cfg({ style: 'candle' }), settings).mode).toBe('split'); // candles unchanged
  });

  it('per-series overrides beat the settings — mode and colors', () => {
    const s = cfg({ style: 'bar', colorMode: 'single' });
    expect(effectiveSplit(s).mode).toBe('single');
    const t = cfg({ style: 'candle', colorMode: 'split', riseColor: 'teal', fallColor: 'pink' });
    expect(effectiveSplit(t)).toEqual({ mode: 'split', rise: 'teal', fall: 'pink' });
  });

  it('maps a legacy candleColorBy (old presets) when no colorMode is set', () => {
    expect(effectiveSplit(cfg({ style: 'candle', candleColorBy: 'direction' })).mode).toBe('split');
    expect(effectiveSplit(cfg({ style: 'candle', candleColorBy: 'series' })).mode).toBe('single');
    // An explicit colorMode wins over the legacy field.
    expect(
      effectiveSplit(cfg({ style: 'candle', candleColorBy: 'series', colorMode: 'split' })).mode,
    ).toBe('split');
  });
});

describe('mergeChartSettings', () => {
  it('returns the defaults for garbage and fills partial blobs section by section', () => {
    expect(mergeChartSettings(null)).toEqual(DEFAULT_CHART_SETTINGS);
    expect(mergeChartSettings('nope')).toEqual(DEFAULT_CHART_SETTINGS);
    const merged = mergeChartSettings({
      metrics: { weight: 2 },
      bars: { split: false },
      junk: { anything: true },
    });
    expect(merged.metrics).toEqual({ dash: 'solid', weight: 2 });
    expect(merged.bars).toEqual({ split: false, rise: 'positive', fall: 'negative' });
    expect(merged.derived).toEqual(DEFAULT_CHART_SETTINGS.derived);
    expect('junk' in merged).toBe(false);
  });

  it('rejects out-of-vocabulary values field by field', () => {
    const merged = mergeChartSettings({
      metrics: { dash: 'dotted', weight: 'fat' },
      candles: { split: 'yes', rise: 7 },
    });
    expect(merged.metrics).toEqual(DEFAULT_CHART_SETTINGS.metrics);
    expect(merged.candles).toEqual(DEFAULT_CHART_SETTINGS.candles);
  });

  it('rejects a zero/negative/absurd stored weight (would draw nothing)', () => {
    expect(mergeChartSettings({ metrics: { weight: 0 } }).metrics.weight).toBe(1.5);
    expect(mergeChartSettings({ metrics: { weight: -1 } }).metrics.weight).toBe(1.5);
    expect(mergeChartSettings({ metrics: { weight: 99 } }).metrics.weight).toBe(1.5);
    expect(mergeChartSettings({ metrics: { weight: 2 } }).metrics.weight).toBe(2);
  });

  // The annotations section is an OPEN map — its keys are the app's catalog ids,
  // which this package cannot enumerate. So it is validated by value, not by key,
  // and the absence of a field is meaningful rather than a hole to fill.
  describe('the annotations section', () => {
    it('defaults to empty, which means "every annotation as shipped"', () => {
      // NOT "everything off". The catalog owns each default and this map records
      // only overrides — so a settings blob written before an annotation existed
      // must not read as that annotation being disabled.
      expect(mergeChartSettings(null).annotations).toEqual({});
      expect(mergeChartSettings({ metrics: { weight: 2 } }).annotations).toEqual({});
    });

    it("keeps unknown keys, because the catalog is the app's to grow", () => {
      // The opposite policy to every other section: an id this package has never
      // heard of is a *newer app*, not corruption. Dropping it would silently undo
      // a user's choice on any annotation added after the stored blob was written.
      const merged = mergeChartSettings({
        annotations: { earnings: { on: false }, whatever: { color: 'teal' } },
      });
      expect(merged.annotations).toEqual({ earnings: { on: false }, whatever: { color: 'teal' } });
    });

    it('migrates a legacy bare boolean to `{ on }`', () => {
      // The shape this section shipped with before colours existed. Reading it
      // rather than dropping it means an existing toggle does not silently reset.
      expect(mergeChartSettings({ annotations: { earnings: false } }).annotations).toEqual({
        earnings: { on: false },
      });
      expect(mergeChartSettings({ annotations: { expirations: true } }).annotations).toEqual({
        expirations: { on: true },
      });
    });

    it('drops a non-boolean `on`, which would otherwise read as ON', () => {
      // The specific hazard: consumers resolve with `over?.on ?? entry.default`,
      // so a stored `"false"` would bypass the default and then be evaluated for
      // truthiness — and `"false"` is truthy.
      const merged = mergeChartSettings({
        annotations: { a: { on: 'false' }, b: { on: 0 }, ok: { on: false } },
      });
      expect(merged.annotations).toEqual({ ok: { on: false } });
    });

    it('drops a colour that is not a non-empty string', () => {
      // `''` would resolve to no stroke and draw an invisible marker, which reads
      // as the annotation being broken rather than uncoloured.
      const merged = mergeChartSettings({
        annotations: { a: { color: '' }, b: { color: 7 }, ok: { color: 'amber' } },
      });
      expect(merged.annotations).toEqual({ ok: { color: 'amber' } });
    });

    it('drops an entry that overrides nothing, rather than accumulating `{}`', () => {
      const merged = mergeChartSettings({
        annotations: { empty: {}, junk: { nope: 1 }, real: { on: true } },
      });
      expect(merged.annotations).toEqual({ real: { on: true } });
    });

    it('keeps on and colour independent — setting one must not imply the other', () => {
      const merged = mergeChartSettings({ annotations: { earnings: { color: 'rose' } } });
      expect(merged.annotations.earnings).toEqual({ color: 'rose' });
      expect(merged.annotations.earnings!.on).toBeUndefined(); // still "as shipped"
    });

    it('ignores a non-object annotations blob', () => {
      expect(mergeChartSettings({ annotations: 'earnings' }).annotations).toEqual({});
      expect(mergeChartSettings({ annotations: null }).annotations).toEqual({});
    });
  });
});

// --- TDL-AXISLOCK: per-bound hard limits -------------------------------------

const range = (over: Partial<AxisRange>): AxisRange => ({
  mode: 'auto',
  min: 10,
  max: 90,
  unit: '$',
  ...over,
});

describe('effectiveAxisBounds', () => {
  it('an untouched axis hands the library nothing — it auto-fits', () => {
    expect(effectiveAxisBounds(undefined)).toEqual({ min: undefined, max: undefined });
    expect(effectiveAxisBounds(range({}))).toEqual({ min: undefined, max: undefined });
  });

  it('a manual pin supplies both bounds', () => {
    expect(effectiveAxisBounds(range({ mode: 'manual' }))).toEqual({ min: 10, max: 90 });
  });

  it('auto keeps the pin as MEMORY only — it must not reach the axis', () => {
    // `mode:'auto'` with values is the preserved manual memory ("Auto fit
    // was…"), so handing them to <YAxis> would make Back-to-auto a no-op.
    expect(effectiveAxisBounds(range({ mode: 'auto' })).min).toBeUndefined();
  });

  it('resolves the two bounds INDEPENDENTLY — a hard floor under a free top', () => {
    // The shape a bar axis normally runs in.
    expect(effectiveAxisBounds(range({ lockMin: 0 }))).toEqual({ min: 0, max: undefined });
    expect(effectiveAxisBounds(range({ lockMax: 0 }))).toEqual({ min: undefined, max: 0 });
  });

  it('a lock beats the manual pin on that bound, and only that bound', () => {
    const r = range({ mode: 'manual', lockMin: 0 });
    expect(effectiveAxisBounds(r)).toEqual({ min: 0, max: 90 });
  });
});

describe('clampBoundsToLocks', () => {
  it('passes a gesture through untouched when nothing is locked', () => {
    expect(clampBoundsToLocks(range({}), [12, 88])).toEqual([12, 88]);
  });

  it('refuses to let a gesture move a locked floor — the unpannable baseline', () => {
    expect(clampBoundsToLocks(range({ lockMin: 0 }), [63.8, 191.3])).toEqual([0, 191.3]);
  });

  it('holds a locked ceiling for an all-negative axis', () => {
    expect(clampBoundsToLocks(range({ lockMax: 0 }), [-120, -5])).toEqual([-120, 0]);
  });

  it('a doubly-locked axis ignores the gesture entirely', () => {
    expect(clampBoundsToLocks(range({ lockMin: 0, lockMax: 100 }), [40, 60])).toEqual([0, 100]);
  });
});

describe('barZeroLock', () => {
  const bar = (over: Partial<SeriesConfig> = {}) => cfg({ style: 'bar', ...over });

  it('locks the FLOOR to zero for all-positive bars', () => {
    expect(barZeroLock([bar()], 0, 184.65)).toEqual({ lockMin: 0 });
    expect(barZeroLock([bar()], 12, 184.65)).toEqual({ lockMin: 0 });
  });

  it('locks the CEILING to zero for all-negative bars', () => {
    expect(barZeroLock([bar()], -180, -4)).toEqual({ lockMax: 0 });
    expect(barZeroLock([bar()], -180, 0)).toEqual({ lockMax: 0 });
  });

  it('leaves bars that STRADDLE zero unlocked', () => {
    // The baseline is mid-plot; no bound lock can hold it, so locking `min`
    // would pin the wrong thing (Peter, 2026-08-29).
    expect(barZeroLock([bar()], -50, 100)).toEqual({});
  });

  it('a non-bar member removes the lock — a line inherits no floor', () => {
    expect(barZeroLock([bar({ id: 'a' }), cfg({ id: 'b', style: 'line' })], 0, 100)).toEqual({});
    for (const style of ['line', 'area', 'candle'] as const)
      expect(barZeroLock([cfg({ style })], 0, 100)).toEqual({});
  });

  it('a split bar stays unanimous — both halves are bars', () => {
    expect(barZeroLock([bar({ id: 'a' }), bar({ id: 'b' })], 0, 100)).toEqual({ lockMin: 0 });
  });

  it('locks nothing without data to judge the sign by, or with no members', () => {
    expect(barZeroLock([bar()], null, null)).toEqual({});
    expect(barZeroLock([], 0, 100)).toEqual({});
  });
});

describe('centerOnZero', () => {
  it('mirrors the larger side, so a signed series reads honestly', () => {
    expect(centerOnZero({ min: -3, max: 12 })).toEqual({ min: -12, max: 12 });
    expect(centerOnZero({ min: -40, max: 5 })).toEqual({ min: -40, max: 40 });
  });

  it('centres an all-positive fit too — zero becomes the floor', () => {
    expect(centerOnZero({ min: 4, max: 20 })).toEqual({ min: -20, max: 20 });
  });

  it('declines a degenerate fit rather than emitting [0, 0]', () => {
    // No magnitude to mirror; an axis cannot draw a zero-width domain, so the
    // library's own fit is the better answer.
    expect(centerOnZero({ min: 0, max: 0 })).toBeNull();
    expect(centerOnZero(null)).toBeNull();
    expect(centerOnZero(undefined)).toBeNull();
  });
});

describe('effectiveAxisBounds with a host-computed AUTO fit', () => {
  it('uses the fit while auto', () => {
    expect(effectiveAxisBounds(range({}), { min: -20, max: 20 })).toEqual({ min: -20, max: 20 });
  });

  it('a MANUAL pin outranks the fit — the user has already answered', () => {
    expect(effectiveAxisBounds(range({ mode: 'manual' }), { min: -20, max: 20 })).toEqual({
      min: 10,
      max: 90,
    });
  });

  it('a LOCK outranks the fit, per bound', () => {
    // The bar case with centre-zero also on: the floor stays nailed, the top
    // still comes from the fit.
    expect(effectiveAxisBounds(range({ lockMin: 0 }), { min: -20, max: 20 })).toEqual({
      min: 0,
      max: 20,
    });
  });

  it('no fit ⇒ nothing declared, and the library fits as before', () => {
    expect(effectiveAxisBounds(range({}), null)).toEqual({ min: undefined, max: undefined });
  });
});

describe('axisFormat', () => {
  it('keeps each unit as it was when no precision is set', () => {
    expect(axisFormat('$')(161.76)).toBe('$162');
    expect(axisFormat('%')(20.36)).toBe('20.4%');
    expect(axisFormat('variance')(0.000123)).toBe('1.2e-4');
    expect(axisFormat('count')(1176424)).toBe('1.2M');
    expect(axisFormat(undefined)(20.36)).toBe('20.4');
  });

  it('overrides the DECIMALS while the unit keeps its identity', () => {
    expect(axisFormat('$', 0)(161.76)).toBe('$162');
    expect(axisFormat('$', 2)(161.76)).toBe('$161.76');
    expect(axisFormat('$', 4)(161.76)).toBe('$161.7600');
    expect(axisFormat('%', 0)(20.36)).toBe('20%');
    expect(axisFormat('%', 3)(20.36)).toBe('20.360%');
  });

  it('reaches the compact and exponential units too', () => {
    expect(axisFormat('count', 2)(1176424)).toBe('1.18M');
    expect(axisFormat('count', 0)(1176424)).toBe('1M');
    expect(axisFormat('variance', 3)(0.000123)).toBe('1.230e-4');
  });

  it('tunes the unitless axis without losing its compact-above-10k rule', () => {
    expect(axisFormat(undefined, 2)(20.361)).toBe('20.36');
    expect(axisFormat(undefined, 2)(1176424)).toBe('1.18M');
  });
});

describe('logAllowed', () => {
  it('permits log on an ordinary axis', () => {
    expect(logAllowed(undefined)[0]).toBe(true);
    expect(logAllowed(range({}))[0]).toBe(true);
    expect(logAllowed(range({ lockMin: 12 }))[0]).toBe(true);
  });

  it('refuses log while a bound is locked at ZERO, and says why', () => {
    // log(0) is undefined, so the two cannot both hold. Refusing is the honest
    // move: silently dropping the lock would move a bar's baseline, which is
    // the one thing the lock exists to prevent.
    const [ok, why] = logAllowed(range({ lockMin: 0 }));
    expect(ok).toBe(false);
    expect(why).toContain('cannot reach 0');
    expect(logAllowed(range({ lockMax: 0 }))[0]).toBe(false);
  });

  it('refuses a bound locked BELOW zero too, not just at it', () => {
    // An all-negative bar axis locks its MAX at 0; the user can then hand-lock
    // the min at -5, and a domain reaching -5 contains zero just as surely.
    // The old test was `=== 0` and let this through (PR #173 review, LOW).
    expect(logAllowed(range({ lockMin: -5 }))[0]).toBe(false);
    expect(logAllowed(range({ lockMax: -5 }))[0]).toBe(false);
  });

  it('refuses a MANUAL pin that reaches zero, and ignores the same numbers in AUTO', () => {
    // A pin is a stated domain, so a non-positive one is stated too. An AUTO
    // fit that happens to span zero is a property of the DATA, not of this
    // record — the chart's to handle, not this function's.
    const [ok, why] = logAllowed(range({ mode: 'manual', min: -20, max: 90 }));
    expect(ok).toBe(false);
    expect(why).toContain('manual bounds');
    expect(logAllowed(range({ mode: 'auto', min: -20, max: 90 }))[0]).toBe(true);
  });
});

describe('axisFormat memoisation', () => {
  it('returns the SAME function for the same unit + precision', () => {
    // `<YAxis format>` is the one axis prop the library cannot value-compare, and
    // the call site is an inline prop, so a fresh reference each render
    // re-registers the axis every frame (PR #173 review, MEDIUM).
    expect(axisFormat('%', 2)).toBe(axisFormat('%', 2));
    expect(axisFormat(undefined)).toBe(axisFormat(undefined));
    expect(axisFormat('count')).toBe(axisFormat('count'));
  });

  it('still distinguishes the pairs it caches', () => {
    expect(axisFormat('%', 2)).not.toBe(axisFormat('%', 3));
    expect(axisFormat('%', 2)).not.toBe(axisFormat('$', 2));
    expect(axisFormat('%')).not.toBe(axisFormat('%', 1));
    // …and the cached functions still format as their own tests assert.
    expect(axisFormat('%', 3)(20.36)).toBe('20.360%');
  });
});

/**
 * A multi-output study reads N columns off ONE spec id — the thing every data
 * scanner (extent, hover, render, the dependency walk) has to go through
 * `configColumns` for. A band was the only such style; `lines` generalises it.
 */
describe('configColumns — multi-output studies', () => {
  const cfg = (style: SeriesStyle, derive?: DeriveSpec) => ({
    column: derive ? deriveId(derive) : 'iv21',
    style,
    ...(derive ? { derive } : {}),
  });

  it('reads one column for an ordinary series', () => {
    expect(configColumns(cfg('line'))).toEqual(['iv21']);
  });

  it('reads the three band columns off a band spec', () => {
    const derive: DeriveSpec = {
      op: 'bollinger',
      inputs: ['iv21'],
      params: { period: 20, stdDev: 2 },
    };
    const id = deriveId(derive);
    expect(configColumns(cfg('band', derive))).toEqual([`${id}Middle`, `${id}Upper`, `${id}Lower`]);
  });

  it("reads one column per declared output for a MACD's lines", () => {
    const derive: DeriveSpec = { op: 'macd', inputs: ['close'] };
    const id = deriveId(derive);
    // MACD names all three of its outputs, so the columns are its own suffixes.
    expect(configColumns(cfg('lines', derive))).toEqual([`${id}Line`, `${id}Signal`, `${id}Hist`]);
  });

  it('names an UNNAMED primary output, because the registry refuses an empty one', () => {
    // `trix` is `['', 'Signal']` in the catalog, and `@pond-ts/process` rejects
    // an empty suffix on a multi-output op ("'' would collide with the spec
    // id") — correctly, since with two outputs one of them cannot also BE the
    // id. So it is declared `Value`/`Signal`, and the DECLARED name is what the
    // engine writes and therefore what must be read back. Twelve studies have
    // this shape; F-charts-27.
    const derive2: DeriveSpec = { op: 'trix', inputs: ['close'] };
    const id2 = deriveId(derive2);
    expect(configColumns(cfg('lines', derive2))).toEqual([`${id2}Value`, `${id2}Signal`]);
  });

  it('degrades a `lines` config with no spec to its bare column', () => {
    // A persisted config can outlive the op that named it; reading nothing is
    // better than throwing inside a render.
    expect(configColumns({ column: 'orphan', style: 'lines' })).toEqual(['orphan']);
  });

  it('gives each output its own theme key, so one colour can carry N textures', () => {
    expect(outputKey('s-3', 0)).toBe('s-3__o0');
    expect(outputKey('s-3', 2)).toBe('s-3__o2');
    // Distinct per index — the whole point, since they share a colour.
    expect(new Set([0, 1, 2].map((i) => outputKey('s-3', i))).size).toBe(3);
  });
});

describe('currency reads in the accounting convention', () => {
  it('wraps a negative amount rather than wedging a minus after the symbol', () => {
    // `$-2.75` is not how money is written anywhere in finance. This stopped
    // being hypothetical when a `delta`-unit study — a MACD of a price — put
    // negative dollars on screen for the first time.
    expect(formatSeriesValue(-2.75, '$')).toBe('($2.75)');
    expect(formatSeriesValue(161.76, '$')).toBe('$161.76');
    expect(formatSeriesValue(0, '$')).toBe('$0.00');
  });

  it('formats axis ticks the same way, so a chip and its axis agree', () => {
    // A MACD axis ran `$5 / $0 / $-5` before this.
    const fmt = axisFormat('$');
    expect(fmt(-5)).toBe('($5)');
    expect(fmt(5)).toBe('$5');
    expect(fmt(0)).toBe('$0');
    // …and with explicit precision.
    expect(axisFormat('$', 2)(-2.5)).toBe('($2.50)');
  });

  it('leaves every other unit alone — only currency takes parentheses', () => {
    expect(formatSeriesValue(-2.75, '%')).toBe('-2.75%');
    expect(formatSeriesValue(-2.75, '')).toBe('-2.75');
    expect(formatSeriesValue(-0.23, 'log')).toBe('-0.23');
    expect(axisFormat('%')(-5)).toBe('-5.0%');
  });
});

describe('fractionTicks — stacked axes agree on their rows by construction', () => {
  const pct = axisFormat('%', 0);

  it('lands one tick at each fraction of the domain, both ends included', () => {
    expect(fractionTicks(10, 20, 3, pct)).toEqual([
      { at: 10, label: '10%' },
      { at: 15, label: '15%' },
      { at: 20, label: '20%' },
    ]);
  });

  it('puts the same FRACTIONS on two axes with different domains', () => {
    const a = fractionTicks(0, 100, 5, pct).map((t) => t.at / 100);
    const b = fractionTicks(-3, 3, 5, pct).map((t) => (t.at + 3) / 6);
    expect(a).toEqual(b);
  });

  it('draws nothing for fewer than two ticks or an inverted domain', () => {
    expect(fractionTicks(0, 1, 1, pct)).toEqual([]);
    expect(fractionTicks(5, 5, 3, pct)).toEqual([]);
    expect(fractionTicks(9, 1, 3, pct)).toEqual([]);
  });
});
