import { describe, expect, it } from 'vitest';
import { buildPriceSeries, type PriceRow } from '@tidal-ts/core';
import { viewBaseline } from './TimeSeriesChart.js';
import { effectiveSplit } from './series.js';
import { DEFAULT_CHART_SETTINGS } from './chartSettings.js';
import type { ChartSeries, SeriesConfig } from './index.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);
const at = (i: number) => T0 + i * DAY;

const series = (closes: readonly (number | null)[]): ChartSeries =>
  buildPriceSeries(
    'TEST',
    closes.map((c, i): PriceRow => [at(i), c ?? 0, c ?? 0, c ?? 0, c as number, 1]),
  ) as unknown as ChartSeries;

/**
 * The anchor an area measures from: the first point IN VIEW, so the fill reads
 * as the move since the left edge and re-bases as you pan.
 */
describe('viewBaseline', () => {
  const s = series([10, 12, 9, 15, 11]);

  it('is the first drawn point when the whole series is in view', () => {
    expect(viewBaseline(s, 'close')).toBe(10);
  });

  it('MOVES with the left edge — that is the whole point', () => {
    expect(viewBaseline(s, 'close', at(2))).toBe(9);
    expect(viewBaseline(s, 'close', at(3))).toBe(15);
  });

  it('takes the first point at OR AFTER the edge, not the one before it', () => {
    // A view starting mid-gap anchors on the next real bar, never on one off
    // screen to the left.
    expect(viewBaseline(s, 'close', at(2) + DAY / 2)).toBe(15);
  });

  it('is null when nothing in view has a value — draw an ordinary area', () => {
    expect(viewBaseline(s, 'close', at(99))).toBeNull();
    expect(viewBaseline(s, 'not_a_column')).toBeNull();
  });
});

const cfg = (over: Partial<SeriesConfig>): SeriesConfig =>
  ({ id: 's', column: 'close', style: 'area', ...over }) as SeriesConfig;

describe('effectiveSplit, for an area', () => {
  it('does not split without a baseline — there is nothing to split AT', () => {
    expect(effectiveSplit(cfg({})).mode).toBe('single');
    // …not even when the series asks for it: the mark is not making that
    // reading.
    expect(effectiveSplit(cfg({ colorMode: 'split' })).mode).toBe('single');
  });

  it('splits with one, and takes the settings’ area defaults', () => {
    expect(effectiveSplit(cfg({ baseline: 'view' }))).toEqual({
      mode: 'split',
      rise: 'positive',
      fall: 'negative',
    });
    // A FIXED baseline splits the same way — it is a level either way.
    expect(effectiveSplit(cfg({ baseline: 300 })).mode).toBe('split');
    // …including one AT zero, which `!= null` keeps and a truthiness test
    // would have thrown away.
    expect(effectiveSplit(cfg({ baseline: 0 })).mode).toBe('split');
  });

  it('is overridable per series, like a bar’s', () => {
    expect(effectiveSplit(cfg({ baseline: 'view', colorMode: 'single' })).mode).toBe('single');
    expect(
      effectiveSplit(cfg({ baseline: 'view', riseColor: 'teal', fallColor: 'rose' })),
    ).toMatchObject({ rise: 'teal', fall: 'rose' });
  });

  it('follows the AREAS setting, not the bars one', () => {
    const settings = {
      ...DEFAULT_CHART_SETTINGS,
      areas: { split: false, rise: 'teal', fall: 'rose' },
    };
    expect(effectiveSplit(cfg({ baseline: 'view' }), settings)).toEqual({
      mode: 'single',
      rise: 'teal',
      fall: 'rose',
    });
    // The bar beside it is untouched.
    expect(effectiveSplit(cfg({ style: 'bar' }), settings).mode).toBe('split');
  });
});
