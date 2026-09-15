import { describe, expect, it } from 'vitest';
import type { SeriesSchema, TimeSeries } from 'pond-ts';
import { buildPriceSeries, type PriceRow } from './fixture.js';
import {
  aggregateColumn,
  floorToWindow,
  liveWindowMs,
  ohlcWindow,
  sessionGrid,
  WINDOW_MS,
} from './aggregate.js';
import { sessionSegments } from './sessions.js';

const DAY = 86_400_000;
// Anchor on a Monday (2024-01-01 UTC) so a Monday-anchored calendar week lines
// up cleanly with the seven-bar span.
const BASE = Date.UTC(2024, 0, 1);
// Seven consecutive daily OHLCV bars with hand-picked values so the roll-up is
// checkable by eye: [time, open, high, low, close, volume].
const ROWS: PriceRow[] = [
  [BASE + 0 * DAY, 10, 12, 9, 11, 100],
  [BASE + 1 * DAY, 11, 15, 10, 14, 200],
  [BASE + 2 * DAY, 14, 14, 8, 9, 150],
  [BASE + 3 * DAY, 9, 13, 7, 12, 300],
  [BASE + 4 * DAY, 12, 18, 11, 17, 250],
  [BASE + 5 * DAY, 17, 17, 13, 15, 120],
  [BASE + 6 * DAY, 15, 16, 6, 8, 400],
];
const series = () => buildPriceSeries('TEST', ROWS);

// 40 daily bars from the same Monday — spans a calendar-month boundary (31 Jan
// days + 9 Feb days) and several Monday-anchored weeks. Values don't matter for
// the bucket-count assertions.
const manySeries = () =>
  buildPriceSeries(
    'MANY',
    Array.from({ length: 40 }, (_, i): PriceRow => {
      const v = 100 + i;
      return [BASE + i * DAY, v, v, v, v, 1000];
    }),
  );

describe('aggregateColumn', () => {
  it('at the native day window keeps one bar per source point', () => {
    expect(aggregateColumn(series(), 'close', '1d', 'last').length).toBe(ROWS.length);
  });

  it('sums a column into a calendar-month window', () => {
    const agg = aggregateColumn(series(), 'volume', '1mo', 'sum');
    expect(agg.length).toBe(1); // all seven bars are in Jan 2024
    const total = ROWS.reduce((s, r) => s + r[5], 0); // 1520
    expect(agg.toObjects()[0]!.volume).toBe(total);
  });

  it('averages a column into a calendar-month window', () => {
    const agg = aggregateColumn(series(), 'close', '1mo', 'avg');
    const closes = ROWS.map((r) => r[4]);
    const mean = closes.reduce((s, v) => s + v, 0) / closes.length;
    expect(agg.toObjects()[0]!.close as number).toBeCloseTo(mean, 6);
  });

  it('bins by real calendar boundaries (day vs week vs month)', () => {
    expect(aggregateColumn(manySeries(), 'close', '1d', 'last').length).toBe(40);
    // Jan 1 is a Monday → weeks Jan1–7, 8–14, 15–21, 22–28, 29–Feb4, Feb5–9 = 6.
    expect(aggregateColumn(manySeries(), 'close', '1w', 'last').length).toBe(6);
    // Jan (31 days) + Feb (9 days) = 2 calendar months.
    expect(aggregateColumn(manySeries(), 'close', '1mo', 'last').length).toBe(2);
  });
});

describe('ohlcWindow', () => {
  it('rolls a month of bars into one OHLC candle (first/max/min/last, summed volume)', () => {
    const w = ohlcWindow(series(), '1mo');
    expect(w.length).toBe(1);
    const c = w.toObjects()[0]!;
    expect(c.open).toBe(10); // first open
    expect(c.high).toBe(18); // max high
    expect(c.low).toBe(6); // min low
    expect(c.close).toBe(8); // last close
    expect(c.volume).toBe(ROWS.reduce((s, r) => s + r[5], 0)); // 1520
  });

  it('at the native day window emits one candle per day', () => {
    const w = ohlcWindow(series(), '1d');
    expect(w.length).toBe(ROWS.length);
    const first = w.toObjects()[0]!;
    expect(first.open).toBe(10);
    expect(first.high).toBe(12);
    expect(first.low).toBe(9);
    expect(first.close).toBe(11);
  });

  it('bins candles by calendar week vs month', () => {
    expect(ohlcWindow(manySeries(), '1w').length).toBe(6);
    expect(ohlcWindow(manySeries(), '1mo').length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The bucket GRID: which bucket the first bar lands in, and what a "day" means
// once the bars are intraday.
// ---------------------------------------------------------------------------

/** `n` daily bars from `startUtc`, values irrelevant — these assert bucketing. */
const dailyFrom = (startUtc: number, n: number) =>
  buildPriceSeries(
    'D',
    Array.from({ length: n }, (_, i): PriceRow => [startUtc + i * DAY, 100, 101, 99, 100.5, 1]),
  );

/** 390 one-minute bars per day, 13:30–19:59 UTC — a US equity regular session. */
const intradayDays = (days: number[]) => {
  const rows: PriceRow[] = [];
  for (const d of days) {
    const open = Date.UTC(2026, 7, d, 13, 30);
    for (let m = 0; m < 390; m += 1) {
      const v = 100 + m * 0.01;
      rows.push([open + m * 60_000, v, v + 0.5, v - 0.5, v + 0.2, 1]);
    }
  }
  return buildPriceSeries('I', rows);
};

const keysOf = (s: ReturnType<typeof dailyFrom>) => {
  const kc = s as unknown as { keyColumn(): { at(i: number): number }; length: number };
  return Array.from({ length: kc.length }, (_, i) => kc.keyColumn().at(i));
};

const slots = (s: TimeSeries<SeriesSchema>) =>
  (s as unknown as { toObjects(): { interval: { start: number; endMs: number } }[] })
    .toObjects()
    .map((o) => [o.interval.start, o.interval.endMs] as const);

const totalVolume = (s: TimeSeries<SeriesSchema>) =>
  (s as unknown as { toObjects(): { volume?: number }[] })
    .toObjects()
    .reduce((t, o) => t + (o.volume ?? 0), 0);

describe('floorToWindow', () => {
  it('floors to the UTC day', () => {
    expect(floorToWindow(Date.UTC(2024, 0, 3, 17, 45), '1d')).toBe(Date.UTC(2024, 0, 3));
  });

  it('floors to the MONDAY of the week, not the Sunday', () => {
    // Wed 3 Jan 2024 → Mon 1 Jan; Sun 7 Jan belongs to that same week.
    expect(floorToWindow(Date.UTC(2024, 0, 3), '1w')).toBe(Date.UTC(2024, 0, 1));
    expect(floorToWindow(Date.UTC(2024, 0, 7), '1w')).toBe(Date.UTC(2024, 0, 1));
    expect(floorToWindow(Date.UTC(2024, 0, 8), '1w')).toBe(Date.UTC(2024, 0, 8));
  });

  it('floors to the first of the month', () => {
    expect(floorToWindow(Date.UTC(2024, 0, 31, 23, 59), '1mo')).toBe(Date.UTC(2024, 0, 1));
  });

  it('names the bad value on a non-timestamp instead of dying building the message', () => {
    // Pond throws its own TypeError on a non-finite start, before the miss
    // guard — and that guard's message would itself throw on
    // `new Date(NaN).toISOString()`, so the diagnostic never printed (PR #173
    // review). Failing loud is right; failing legibly is the fix.
    expect(() => floorToWindow(Number.NaN, '1d')).toThrow(/not a timestamp/);
    expect(() => floorToWindow(Number.POSITIVE_INFINITY, '1w')).toThrow(/not a timestamp/);
  });
});

describe('the leading partial bucket', () => {
  // Pond used to bound the grid so the first emitted bucket was the first
  // boundary AT OR AFTER the first event — everything before it aggregated into
  // nothing (F-charts-16). We compensated by flooring the range by hand;
  // `pond-ts` 0.64.0 made the default do it, and the workaround is gone.
  //
  // These assertions did not change across that swap, which is the point of
  // keeping them: they pin the invariant, not the mechanism. They stay because
  // the loss was silent — a well-formed series with a third of the input
  // missing — and invisible in fixtures anchored on a boundary (this file's
  // BASE is a Monday). `totalVolume` is the guard: one bar of volume each, so
  // the sum is the bar count and any dropped bucket shows up as a shortfall.
  it('keeps the partial first week when the data starts mid-week', () => {
    const s = dailyFrom(Date.UTC(2024, 0, 3), 14); // a Wednesday
    const w = ohlcWindow(s, '1w');
    expect(w.length).toBe(3); // Jan 1 (partial), Jan 8, Jan 15 (partial)
    expect(slots(w)[0]![0]).toBe(Date.UTC(2024, 0, 1));
    expect(totalVolume(w)).toBe(14); // every bar accounted for
  });

  it('keeps the partial first month when the data starts mid-month', () => {
    const s = dailyFrom(Date.UTC(2024, 0, 10), 60);
    expect(totalVolume(ohlcWindow(s, '1mo'))).toBe(60);
  });

  it('applies to bars too — they share the grid', () => {
    const s = dailyFrom(Date.UTC(2024, 0, 3), 14);
    const agg = aggregateColumn(s, 'volume', '1w', 'sum');
    expect(agg.length).toBe(3);
    expect(totalVolume(agg)).toBe(14);
  });
});

describe('session buckets for intraday data', () => {
  const raw = () => intradayDays([17, 18, 19]); // Mon–Wed
  const sessionsOf = (s: ReturnType<typeof intradayDays>) => sessionSegments(keysOf(s));

  it('emits one bucket per session, spanning the session and nothing else', () => {
    const s = raw();
    const w = ohlcWindow(s, '1d', sessionsOf(s));
    expect(w.length).toBe(3);
    expect(slots(w)).toEqual([
      [Date.UTC(2026, 7, 17, 13, 30), Date.UTC(2026, 7, 17, 20, 0)],
      [Date.UTC(2026, 7, 18, 13, 30), Date.UTC(2026, 7, 18, 20, 0)],
      [Date.UTC(2026, 7, 19, 13, 30), Date.UTC(2026, 7, 19, 20, 0)],
    ]);
    expect(totalVolume(w)).toBe(3 * 390);
  });

  it("a bucket's MIDPOINT is a live instant — the crosshair invariant", () => {
    // The candle layer anchors its readout at the slot centre, and the axis
    // clamps a value inside a collapsed gap onto the next live instant. So a
    // bucket whose midpoint is closed-market time puts the reticle on the
    // session open — the candle's left edge — rather than through its body.
    const s = raw();
    const segments = sessionsOf(s);
    const live = (t: number) => segments.some(([a, b]) => t >= a && t < b);
    const mid = ([a, b]: readonly [number, number]) => (a + b) / 2;

    for (const slot of slots(ohlcWindow(s, '1d', segments))) expect(live(mid(slot))).toBe(true);
    // The calendar grid is what this replaces: noon UTC is overnight.
    for (const slot of slots(ohlcWindow(s, '1d'))) expect(live(mid(slot))).toBe(false);
  });

  it('groups a week of sessions without swallowing the weekend', () => {
    const s = intradayDays([17, 18, 19, 20, 21, 24, 25]); // Mon–Fri, then Mon–Tue
    const w = ohlcWindow(s, '1w', sessionsOf(s));
    expect(slots(w)).toEqual([
      [Date.UTC(2026, 7, 17, 13, 30), Date.UTC(2026, 7, 21, 20, 0)], // Mon open → Fri close
      [Date.UTC(2026, 7, 24, 13, 30), Date.UTC(2026, 7, 25, 20, 0)],
    ]);
    expect(totalVolume(w)).toBe(7 * 390);
  });

  it('sessionGrid is undefined for no segments, so the caller keeps the calendar', () => {
    expect(sessionGrid([], '1d')).toBeUndefined();
  });
});

describe('sub-day windows subdivide a session', () => {
  const raw = () => intradayDays([17, 18]); // two 390-bar sessions, 13:30–19:59
  const sessionsOf = (s: ReturnType<typeof intradayDays>) => sessionSegments(keysOf(s));

  it('anchors the hourly grid on the OPEN, not the epoch', () => {
    const s = raw();
    const w = ohlcWindow(s, '1h', sessionsOf(s));
    const first = slots(w)[0]!;
    // 13:30–14:30. An epoch-anchored grid would cut a stub at 14:00 instead.
    expect(first[0]).toBe(Date.UTC(2026, 7, 17, 13, 30));
    expect(first[1]).toBe(Date.UTC(2026, 7, 17, 14, 30));
  });

  it("clips a session's last step to the close rather than past it", () => {
    const s = raw();
    const daily = slots(ohlcWindow(s, '1h', sessionsOf(s))).filter(
      ([start]) => start < Date.UTC(2026, 7, 18),
    );
    expect(daily.length).toBe(7); // 6.5h of session ⇒ six full hours + a stub
    const last = daily[daily.length - 1]!;
    expect(last[0]).toBe(Date.UTC(2026, 7, 17, 19, 30));
    expect(last[1]).toBe(Date.UTC(2026, 7, 17, 20, 0)); // the close, not 20:30
  });

  it('accounts for every bar at each grain', () => {
    const s = raw();
    const segments = sessionsOf(s);
    for (const w of ['1m', '5m', '1h'] as const) {
      expect(totalVolume(ohlcWindow(s, w, segments))).toBe(2 * 390);
    }
  });

  it('emits one bucket per bar at the native grain, and 78 per session at 5m', () => {
    const s = raw();
    const segments = sessionsOf(s);
    expect(ohlcWindow(s, '1m', segments).length).toBe(2 * 390);
    expect(ohlcWindow(s, '5m', segments).length).toBe(2 * (390 / 5));
  });

  it('keeps every sub-day bucket inside a session', () => {
    // The whole point of subdividing rather than using a fixed epoch grid: no
    // bucket may span the close, or it blends 19:59 with the next open.
    const s = raw();
    const segments = sessionsOf(s);
    const inOneSession = ([a, b]: readonly [number, number]) =>
      segments.some(([lo, hi]) => a >= lo && b <= hi);
    for (const w of ['1m', '5m', '1h'] as const)
      for (const slot of slots(ohlcWindow(s, w, segments))) expect(inOneSession(slot)).toBe(true);
  });

  it('floors a sub-day window to a step multiple', () => {
    expect(floorToWindow(Date.UTC(2024, 0, 3, 17, 47, 30), '5m')).toBe(
      Date.UTC(2024, 0, 3, 17, 45),
    );
    expect(floorToWindow(Date.UTC(2024, 0, 3, 17, 47), '1h')).toBe(Date.UTC(2024, 0, 3, 17, 0));
  });
});

describe('liveWindowMs — the unit a trading-time axis measures in', () => {
  const raw = () => intradayDays([17, 18, 19, 20, 21]); // Mon–Fri, 6.5h sessions
  const sessionsOf = (s: ReturnType<typeof intradayDays>) => sessionSegments(keysOf(s));
  const HOUR = 3_600_000;

  it('a daily bucket is one SESSION, not one calendar day', () => {
    const live = liveWindowMs('1d', sessionsOf(raw()));
    expect(live).toBe(6.5 * HOUR); // 390 one-minute bars
    // The distinction is the whole point: a calendar day is 3.7x longer, so a
    // zoom floor of "five days" would read as nineteen sessions on screen.
    expect(WINDOW_MS['1d'] / live!).toBeCloseTo(3.69, 1);
  });

  it('a weekly bucket is the five sessions in it', () => {
    expect(liveWindowMs('1w', sessionsOf(raw()))).toBe(5 * 6.5 * HOUR);
  });

  it('a fixed-duration window needs no correction — a step is already live', () => {
    const sessions = sessionsOf(raw());
    expect(liveWindowMs('1m', sessions)).toBe(60_000);
    expect(liveWindowMs('5m', sessions)).toBe(300_000);
    expect(liveWindowMs('1h', sessions)).toBe(HOUR);
  });

  it('measures a short session rather than assuming a full one', () => {
    // A half-day before a holiday: the median bucket is still measured, not 6.5h.
    const rows: PriceRow[] = [];
    for (const [d, bars] of [
      [17, 390],
      [18, 210],
      [19, 210],
    ] as const) {
      const open = Date.UTC(2026, 7, d, 13, 30);
      for (let m = 0; m < bars; m += 1) rows.push([open + m * 60_000, 100, 100, 100, 100, 1]);
    }
    const s = buildPriceSeries('H', rows);
    expect(liveWindowMs('1d', sessionSegments(keysOf(s)))).toBe(210 * 60_000);
  });

  it('is undefined with no sessions, so the caller keeps the calendar span', () => {
    expect(liveWindowMs('1d', [])).toBeUndefined();
    expect(liveWindowMs('1d', undefined)).toBeUndefined();
  });
});
