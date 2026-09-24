import { describe, expect, it } from 'vitest';
import { buildPriceSeries, type PriceRow } from '@tidal-ts/core';
import { areaBaseline } from './TimeSeriesChart.js';
import type { ChartSeries } from './types.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);

/** A price series whose CLOSE walks the values given — the column an area draws. */
const withCloses = (closes: readonly number[]): ChartSeries =>
  buildPriceSeries(
    'TEST',
    closes.map((c, i): PriceRow => [T0 + i * DAY, c, c, c, c, 1]),
  ) as unknown as ChartSeries;

/**
 * charts 0.71 made `baseline={0}` the default. Which of the two is right is a
 * property of the DATA, not a house style, and getting it wrong is silent both
 * ways: a floor under a signed series makes every negative reading look
 * positive, and a zero under a series far from it flattens the shape into the
 * top of its own plot.
 */
describe('areaBaseline', () => {
  it('rests on the FLOOR for a series that never goes below zero', () => {
    // Vol in percent, prices in dollars — the ordinary case here.
    expect(areaBaseline(withCloses([15, 22, 55, 31]), 'close')).toBe('floor');
    expect(areaBaseline(withCloses([0, 1, 2]), 'close')).toBe('floor');
  });

  it('rests on ZERO wherever a reading is negative — the sign IS the reading', () => {
    expect(areaBaseline(withCloses([2, -1, 3]), 'close')).toBe(0);
    // ALL-negative counts. The fixture's skew never crosses zero, and resting
    // it on the floor would grow its fill as the number rises TOWARDS zero —
    // the deepest skew drawn as the smallest mark.
    expect(areaBaseline(withCloses([-3, -8, -2]), 'close')).toBe(0);
  });

  it('falls back to the floor for a column it cannot read', () => {
    expect(areaBaseline(withCloses([1, 2]), 'not_a_column')).toBe('floor');
  });
});
