import { describe, expect, it } from 'vitest';
import { TimeSeries } from 'pond-ts';
import { columnExtent } from './extent.js';

const DAY = 86_400_000;
const SCHEMA = [
  { name: 'time', kind: 'time' },
  { name: 'iv21', kind: 'number' },
] as const;

const mk = (vals: (number | null)[]) =>
  TimeSeries.fromColumns({
    name: 's',
    schema: SCHEMA,
    columns: { time: vals.map((_, i) => i * DAY), iv21: vals },
    sort: true,
  }) as unknown as TimeSeries<typeof SCHEMA>;

describe('columnExtent', () => {
  it('reads the full-series min/max', () => {
    expect(columnExtent(mk([22, 20, 25, 24]), 'iv21')).toEqual({ min: 20, max: 25 });
  });

  it('limits to the given time window (inclusive bounds)', () => {
    // Days 0..4 hold 10,20,30,40,50 — the window [day1, day3] sees 20..40.
    const s = mk([10, 20, 30, 40, 50]);
    expect(columnExtent(s, 'iv21', [1 * DAY, 3 * DAY])).toEqual({ min: 20, max: 40 });
  });

  it('an UNALIGNED window never includes the sample past its end', () => {
    // Pan/zoom windows land between samples. [0.5d, 2.5d] sees days 1–2 only —
    // a lower-bound bisect with a naive +1 included day 3's off-window spike
    // (PR #132 review, MEDIUM).
    const s = mk([10, 20, 30, 999]);
    expect(columnExtent(s, 'iv21', [0.5 * DAY, 2.5 * DAY])).toEqual({ min: 20, max: 30 });
    // …and an unaligned START never pulls in the sample before it.
    expect(columnExtent(s, 'iv21', [1.5 * DAY, 2.5 * DAY])).toEqual({ min: 30, max: 30 });
  });

  it('skips gaps, and an all-gap window yields null', () => {
    const s = mk([10, null, 30, null, null]);
    expect(columnExtent(s, 'iv21')).toEqual({ min: 10, max: 30 });
    expect(columnExtent(s, 'iv21', [3 * DAY, 4 * DAY])).toBeNull();
  });

  it('yields null for an absent column and an out-of-data window', () => {
    const s = mk([10, 20]);
    expect(columnExtent(s, 'nope')).toBeNull();
    expect(columnExtent(s, 'iv21', [10 * DAY, 12 * DAY])).toBeNull();
  });
});
