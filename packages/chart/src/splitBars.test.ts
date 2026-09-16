import { describe, expect, it } from 'vitest';
import { aggregateColumn, buildPriceSeries, type PriceRow } from '@tidal-ts/core';
import { splitBarColumns } from './TimeSeriesChart.js';
import type { ChartSeries } from './types.js';

/**
 * The weekend-gap regression (PR #117 review, must-fix): `aggregateColumn('1d')`
 * emits a bucket for EVERY calendar day — empty weekends included — while a real
 * price series carries only trading days. Joining the OHLC direction by raw-row
 * index therefore drifts two rows per weekend and colors the wrong bars. The fix
 * derives direction from an `ohlcWindow` roll-up over the same bucket grid, so
 * this locks: every drawn bar's half matches ITS OWN day's close-vs-open.
 */

const DAY = 86_400_000;
// 2024-01-01 is a Monday (UTC) — three Mon–Fri weeks, no weekend rows.
const MONDAY = Date.UTC(2024, 0, 1);

function tradingDayFixture() {
  const rows: PriceRow[] = [];
  let t = MONDAY;
  for (let d = 0; rows.length < 15; d += 1) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const i = rows.length;
      const open = 100 + i;
      // Alternate rising/falling days so a one-index drift is guaranteed to flip
      // at least one bar's direction.
      const close = i % 2 === 0 ? open + 1 : open - 1;
      rows.push([t, open, Math.max(open, close) + 1, Math.min(open, close) - 1, close, 1000 + i]);
    }
    t = MONDAY + (d + 1) * DAY;
  }
  return buildPriceSeries('TEST', rows) as unknown as ChartSeries;
}

describe('splitBarColumns', () => {
  it('colors each trading day by its OWN close-vs-open across weekend gaps', () => {
    const src = tradingDayFixture();
    const agg = aggregateColumn(src, 'volume', '1d', 'sum');
    const split = splitBarColumns(agg, 'volume', src, true, '1d');

    // The truth walk: trading days in time order. The drawn (non-empty) buckets
    // must pair 1:1 with them IN ORDER — never by calendar-bucket index, which
    // is exactly the regression (weekend buckets shift it).
    const days = (src.toObjects() as Record<string, number>[]).map((r) => r.close! >= r.open!);
    const drawn = (split.toObjects() as Record<string, number | undefined>[]).filter(
      (r) => r.volume != null && r.volume > 0,
    );
    expect(drawn.length).toBe(15); // one drawn bar per trading day
    drawn.forEach((r, k) => {
      const rising = days[k]!;
      expect(r.volume__up != null).toBe(rising);
      expect(r.volume__dn != null).toBe(!rising);
      // Exactly one half carries the bar, at full value.
      expect(r.volume__up ?? r.volume__dn).toBe(r.volume);
    });
  });

  it('splits a non-OHLC source by value-vs-previous (first bar rises)', () => {
    const src = tradingDayFixture();
    const agg = aggregateColumn(src, 'volume', '1d', 'avg');
    // hasOhlc=false → direction from the value walk (1000, 1001, … rises).
    const split = splitBarColumns(agg, 'volume', src, false, '1d');
    const rows = (split.toObjects() as Record<string, number | undefined>[]).filter(
      (r) => r.volume != null,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.volume__up != null || r.volume__dn != null).toBe(true);
  });
});
