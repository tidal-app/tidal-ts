import { describe, expect, it } from 'vitest';
import {
  exactSessionSegments,
  inferBarMs,
  sessionOpenLine,
  sessionSegments,
  shiftKeys,
  type Segment,
} from './sessions.js';
import { buildPriceSeries, type PriceRow } from './fixture.js';

const MIN = 60_000;
const DAY = 86_400_000;

/** A US regular session as minute bars: 09:30–15:59 ET on the given UTC day. */
function sessionMinutes(dayStartUtc: number, bars = 390): number[] {
  const open = dayStartUtc + 13.5 * 3_600_000; // 09:30 ET ≈ 13:30 UTC
  return Array.from({ length: bars }, (_, i) => open + i * MIN);
}

describe('sessionSegments', () => {
  it('collapses the overnight gap between two intraday sessions', () => {
    const d0 = Date.UTC(2026, 0, 5); // Monday
    const times = [...sessionMinutes(d0), ...sessionMinutes(d0 + DAY)];
    const segs = sessionSegments(times);

    expect(segs).toHaveLength(2);
    // Each segment spans the session plus one bar of width for its last point.
    expect(segs[0]![1] - segs[0]![0]).toBe(390 * MIN);
    // The excised overnight is the real 17.5 hours between close and next open.
    expect(segs[1]![0] - segs[0]![1]).toBe(17.5 * 3_600_000);
  });

  it('collapses a weekend as one gap, not two days of axis', () => {
    const fri = Date.UTC(2026, 0, 9);
    const times = [...sessionMinutes(fri), ...sessionMinutes(fri + 3 * DAY)];
    const segs = sessionSegments(times);
    expect(segs).toHaveLength(2);
    expect(segs[1]![0] - segs[0]![1]).toBe(3 * DAY - 390 * MIN);
  });

  /** A holiday needs no special case: no bars means no segment, which is the
   *  whole reason for deriving from data rather than from a calendar. */
  it('handles a holiday without knowing it is one', () => {
    const d0 = Date.UTC(2026, 0, 5);
    const times = [...sessionMinutes(d0), ...sessionMinutes(d0 + 2 * DAY)];
    expect(sessionSegments(times)).toHaveLength(2);
  });

  /** Likewise a half-day — it is simply a shorter segment. */
  it('handles an early close as a shorter segment', () => {
    const d0 = Date.UTC(2026, 0, 5);
    const times = [...sessionMinutes(d0, 390), ...sessionMinutes(d0 + DAY, 210)];
    const segs = sessionSegments(times);
    expect(segs).toHaveLength(2);
    expect(segs[1]![1] - segs[1]![0]).toBe(210 * MIN);
  });

  it('splits a daily series on weekends but not on trading days', () => {
    // Mon–Fri, then the following Mon–Tue.
    const mon = Date.UTC(2026, 0, 5);
    const times = [0, 1, 2, 3, 4, 7, 8].map((d) => mon + d * DAY);
    const segs = sessionSegments(times);
    expect(segs).toHaveLength(2);
    expect(segs[0]![1] - segs[0]![0]).toBe(5 * DAY);
  });

  /** A missing minute inside a session is time that did not trade, so
   *  collapsing it is correct — but it must not be mistaken for a boundary that
   *  swallows real time. */
  it('treats a single missing bar as its own tiny gap', () => {
    const d0 = Date.UTC(2026, 0, 5);
    const times = sessionMinutes(d0).filter((_, i) => i !== 100);
    const segs = sessionSegments(times);
    expect(segs).toHaveLength(2);
    expect(segs[1]![0] - segs[0]![1]).toBe(MIN);
  });

  it('returns nothing to excise for a degenerate series', () => {
    expect(sessionSegments([])).toEqual([]);
    expect(sessionSegments([1])).toEqual([]);
  });

  it('ignores non-finite keys rather than producing a NaN segment', () => {
    const d0 = Date.UTC(2026, 0, 5);
    const times = [...sessionMinutes(d0, 5), NaN, ...sessionMinutes(d0 + DAY, 5)];
    const segs = sessionSegments(times);
    expect(segs).toHaveLength(2);
    expect(segs.flat().every(Number.isFinite)).toBe(true);
  });
});

describe('sessionSegments over a union of symbols', () => {
  const MIN2 = 60_000;
  const DAY2 = 86_400_000;

  /** The axis is shared, so its segments must come from every series on it. A
   *  minute one symbol missed is still live if another printed in it. */
  it('is unaffected by duplicate timestamps and covers minutes only one symbol has', () => {
    const open = Date.UTC(2026, 0, 5) + 13.5 * 3_600_000;
    const a = Array.from({ length: 60 }, (_, i) => open + i * MIN2);
    const b = a.filter((_, i) => i !== 30).concat(open + 60 * MIN2); // misses one, adds one
    const union = [...a, ...b].sort((x, y) => x - y);

    const segs = sessionSegments(union);
    expect(segs).toHaveLength(1); // duplicates must not fragment it
    expect(segs[0]![0]).toBe(open);
    expect(segs[0]![1]).toBe(open + 61 * MIN2); // the extra minute is inside
  });

  it('still splits sessions when the union spans two days', () => {
    const d0 = Date.UTC(2026, 0, 5) + 13.5 * 3_600_000;
    const day = (base: number) => Array.from({ length: 30 }, (_, i) => base + i * MIN2);
    const union = [...day(d0), ...day(d0), ...day(d0 + DAY2)].sort((x, y) => x - y);
    expect(sessionSegments(union)).toHaveLength(2);
  });
});

describe('inferBarMs', () => {
  const MIN3 = 60_000;
  const DAY3 = 86_400_000;

  /** The regression behind "1d candles do not work on intraday data": code that
   *  reads the token `'1d'` as "the native bar" draws one mark per minute. The
   *  interval has to come from the data. */
  it('reports the minute interval for intraday bars, not a day', () => {
    const open = Date.UTC(2026, 0, 5) + 13.5 * 3_600_000;
    const times = Array.from({ length: 390 }, (_, i) => open + i * MIN3);
    expect(inferBarMs(times)).toBe(MIN3);
  });

  it('reports a day for daily bars', () => {
    const mon = Date.UTC(2026, 0, 5);
    const times = [0, 1, 2, 3, 4, 7, 8, 9].map((d) => mon + d * DAY3);
    expect(inferBarMs(times)).toBe(DAY3);
  });

  /** Session boundaries and missing bars are outliers; the median must ignore
   *  them, which min/mean would not. */
  it('is unmoved by an overnight gap or a hole', () => {
    const open = Date.UTC(2026, 0, 5) + 13.5 * 3_600_000;
    const day1 = Array.from({ length: 60 }, (_, i) => open + i * MIN3).filter((_, i) => i !== 20);
    const day2 = Array.from({ length: 60 }, (_, i) => open + DAY3 + i * MIN3);
    expect(inferBarMs([...day1, ...day2])).toBe(MIN3);
  });

  it('declines to guess for fewer than two points', () => {
    expect(inferBarMs([])).toBeUndefined();
    expect(inferBarMs([1])).toBeUndefined();
  });
});

describe('shiftKeys — a close belongs at its bar’s end', () => {
  const MIN = 60_000;
  const session = (day: number, bars = 390) => {
    const rows: PriceRow[] = [];
    const open = Date.UTC(2026, 6, day, 13, 30);
    for (let m = 0; m < bars; m += 1) {
      const v = 300 + m * 0.01;
      rows.push([open + m * MIN, v, v + 0.5, v - 0.5, v + 0.2, 1000]);
    }
    return rows;
  };
  const keys = (s: unknown) => {
    const a = s as { keyColumn(): { at(i: number): number }; length: number };
    return Array.from({ length: a.length }, (_, i) => a.keyColumn().at(i));
  };

  it('moves every key forward by one bar and leaves values alone', () => {
    const raw = buildPriceSeries('X', session(15, 5));
    const shifted = shiftKeys(raw, MIN);
    const before = keys(raw);
    const after = keys(shifted);
    expect(after.map((t, i) => t - before[i]!)).toEqual([MIN, MIN, MIN, MIN, MIN]);
    // Values ride along untouched — this moves x, not y.
    const closeOf = (s: unknown) =>
      (s as { toObjects(): { close?: number }[] }).toObjects().map((o) => o.close);
    expect(closeOf(shifted)).toEqual(closeOf(raw));
  });

  it('puts the last close ON the session end and the first one bar inside', () => {
    // The spec: the previous session's line ends AT 22:00 Madrid (= the segment
    // end), then a one-bar gap, then the next session's first close at 15:31.
    const rows = [...session(15), ...session(16)];
    const raw = buildPriceSeries('X', rows);
    const segments = sessionSegments(keys(raw));
    const shifted = keys(shiftKeys(raw, MIN));

    const [open0, end0] = segments[0]!;
    expect(shifted[0]).toBe(open0 + MIN); // first close is one bar after the open
    expect(shifted[389]).toBe(end0); // last close lands exactly on the session end
    // …and the gap between the last close and the next session's first close is
    // the overnight gap plus that one bar, not a bar short of it.
    expect(shifted[390]! - shifted[389]!).toBe(segments[1]![0] + MIN - end0);
  });

  it('is a no-op for a zero shift or a series with no time key', () => {
    const raw = buildPriceSeries('X', session(15, 3));
    expect(shiftKeys(raw, 0)).toBe(raw);
  });
});

describe('sessionOpenLine — open, then every close', () => {
  const MIN = 60_000;
  /** `bars` one-minute bars from 13:30 UTC on `day`, with distinguishable o/c. */
  const session = (day: number, bars: number, base: number): PriceRow[] => {
    const rows: PriceRow[] = [];
    const open = Date.UTC(2026, 6, day, 13, 30);
    for (let m = 0; m < bars; m += 1) {
      // open = base + m, close = base + m + 0.5 — so a point's value says which
      // column and which bar it came from.
      rows.push([open + m * MIN, base + m, base + m + 1, base + m - 1, base + m + 0.5, 10]);
    }
    return rows;
  };
  const points = (s: unknown) => {
    const a = s as {
      keyColumn(): { at(i: number): number };
      length: number;
      toObjects(): { close?: number }[];
    };
    const vals = a.toObjects();
    return Array.from(
      { length: a.length },
      (_, i) => [a.keyColumn().at(i), vals[i]!.close] as const,
    );
  };

  it('prepends the session open and keeps one close per bar', () => {
    const s = buildPriceSeries('X', session(15, 3, 100));
    const line = sessionOpenLine(s, MIN, { open: 'open', close: 'close' });
    const open0 = Date.UTC(2026, 6, 15, 13, 30);
    expect(points(line)).toEqual([
      [open0, 100], //          15:30 — the OPEN of the first bar
      [open0 + MIN, 100.5], //  15:31 — close of bar 0
      [open0 + 2 * MIN, 101.5], // 15:32 — close of bar 1
      [open0 + 3 * MIN, 102.5], // 15:33 — close of bar 2
    ]);
  });

  it('gives every session its own open, so a line spans the whole live segment', () => {
    const rows = [...session(15, 3, 100), ...session(16, 3, 200)];
    const s = buildPriceSeries('X', rows);
    const line = sessionOpenLine(s, MIN, { open: 'open', close: 'close' });
    const segments = sessionSegments(rows.map((r) => r[0]));
    const pts = points(line);
    expect(pts.length).toBe(rows.length + segments.length); // one extra per session

    for (const [start, end] of segments) {
      // The line reaches both ends of the live segment: a point AT the open, and
      // a point AT the close. Neither is inside it.
      expect(pts.some(([t]) => t === start)).toBe(true);
      expect(pts.some(([t]) => t === end)).toBe(true);
    }
    // …and the second session's first point is ITS open, not the previous close.
    const open1 = Date.UTC(2026, 6, 16, 13, 30);
    expect(pts.find(([t]) => t === open1)?.[1]).toBe(200);
  });

  it('leaves a series without both columns alone', () => {
    const s = buildPriceSeries('X', session(15, 3, 100));
    expect(sessionOpenLine(s, MIN, { open: 'nope', close: 'close' })).toBe(s);
    expect(sessionOpenLine(s, MIN, { open: 'open', close: 'nope' })).toBe(s);
  });
});

describe('sessionOpenLine at DAILY grain — the rule is grain-independent', () => {
  const DAY_MS = 86_400_000;
  /** A trading week of daily bars, stamped at UTC midnight like the archive. */
  const week = (mondayUtc: number, base: number): PriceRow[] =>
    Array.from({ length: 5 }, (_, i) => {
      const v = base + i;
      return [mondayUtc + i * DAY_MS, v, v + 2, v - 2, v + 1, 1000] as PriceRow;
    });

  it('leaves no dead tail: the last close lands on the segment end', () => {
    // The bug this fixes: a weekly segment runs one bar past its last key, so
    // Fri 00:00Z → Sat 00:00Z was a fifth of the week with live axis and no line.
    const mon = Date.UTC(2026, 3, 27); // Mon 27 Apr 2026
    const rows = [...week(mon, 100), ...week(mon + 7 * DAY_MS, 200)];
    const s = buildPriceSeries('D', rows);
    const keys = rows.map((r) => r[0]);
    const segments = sessionSegments(keys);
    const line = sessionOpenLine(s, DAY_MS, { open: 'open', close: 'close' });
    const pts = line as unknown as { keyColumn(): { at(i: number): number }; length: number };
    const at = Array.from({ length: pts.length }, (_, i) => pts.keyColumn().at(i));

    expect(segments.length).toBe(2);
    for (const [start, end] of segments) {
      expect(at).toContain(start); // a point AT the open …
      expect(at).toContain(end); //   … and one AT the close
    }
    // One extra point per week (the open), and nothing beyond the segment.
    expect(pts.length).toBe(rows.length + segments.length);
    expect(Math.max(...at)).toBe(segments[1]![1]);
  });

  it('puts each close on the right NEW YORK day', () => {
    // The reason daily is not exempt: a UTC-midnight stamp is a boundary, not the
    // session. Monday's close belongs at Tue 00:00Z, which is Mon 20:00 in NY.
    const mon = Date.UTC(2026, 3, 27);
    const s = buildPriceSeries('D', week(mon, 100));
    const line = sessionOpenLine(s, DAY_MS, { open: 'open', close: 'close' });
    const a = line as unknown as {
      keyColumn(): { at(i: number): number };
      length: number;
      toObjects(): { close?: number }[];
    };
    const vals = a.toObjects();
    // index 1 is Monday's CLOSE (index 0 is Monday's open)
    expect(a.keyColumn().at(1)).toBe(mon + DAY_MS); // Tue 00:00Z
    expect(vals[1]!.close).toBe(101); // = base + 0 + 1, Monday's close
    const nyDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      day: '2-digit',
    }).format(mon + DAY_MS);
    expect(nyDay).toBe('27'); // still the 27th in New York
  });
});

describe('exactSessionSegments', () => {
  const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  const show = (segs: readonly Segment[]) =>
    segs.map(
      ([a, b]) =>
        `${new Date(a).toISOString().slice(0, 10)}→${new Date(b).toISOString().slice(0, 10)}`,
    );

  it('merges consecutive sessions into one span', () => {
    // Adjacent days have no gap to collapse, so one span, not three.
    const segs = exactSessionSegments(['2025-11-24', '2025-11-25', '2025-11-26'].map(utc), DAY);
    expect(show(segs)).toEqual(['2025-11-24→2025-11-27']);
  });

  it('splits at a holiday REGARDLESS of how few sessions are in view', () => {
    // The defect this replaces: `sessionSegments` thresholds against the window's
    // median gap, so at five bars a 1-day holiday gap stopped clearing it and
    // Thanksgiving ended up INSIDE a live span. A calendar has no median.
    const week = ['2025-11-25', '2025-11-26', '2025-11-28'].map(utc); // 27th closed
    const holiday = utc('2025-11-27');
    const segs = exactSessionSegments(week, DAY);
    expect(segs.some(([a, b]) => a < holiday && holiday < b)).toBe(false);
    expect(show(segs)).toEqual(['2025-11-25→2025-11-27', '2025-11-28→2025-11-29']);
  });

  it('gives the same answer for a day however wide the window around it', () => {
    // The structural property: a market closure is a fact about the market, not
    // about the viewport. Two windows must agree about every day they share.
    const days = (from: string, to: string) => {
      const out: number[] = [];
      for (let t = utc(from); t < utc(to); t += DAY) {
        const d = new Date(t).getUTCDay();
        const iso = new Date(t).toISOString().slice(0, 10);
        if (d !== 0 && d !== 6 && iso !== '2025-11-27') out.push(t);
      }
      return out;
    };
    const inside = (ds: number[]) => {
      const h = utc('2025-11-27');
      return exactSessionSegments(ds, DAY).some(([a, b]) => a < h && h < b);
    };
    expect(inside(days('2025-11-24', '2025-12-01'))).toBe(false); // one week
    expect(inside(days('2025-06-01', '2026-01-01'))).toBe(false); // seven months
  });

  it('splits a weekend as readily as a holiday — one rule, no special case', () => {
    const segs = exactSessionSegments(['2025-11-21', '2025-11-24'].map(utc), DAY);
    expect(show(segs)).toEqual(['2025-11-21→2025-11-22', '2025-11-24→2025-11-25']);
  });

  it('takes the days it is GIVEN, so the caller decides about missing data', () => {
    // Passing the raw calendar shows a session that should have existed; passing
    // the intersection with held data shows only real bars. Both are legitimate
    // and this function does not choose.
    expect(show(exactSessionSegments([utc('2025-11-25')], DAY))).toEqual(['2025-11-25→2025-11-26']);
  });

  it('returns nothing rather than excising everything', () => {
    expect(exactSessionSegments([], DAY)).toEqual([]);
    expect(exactSessionSegments([utc('2025-11-25')], 0)).toEqual([]);
  });
});

describe('what a calendar buys over inferring from bars', () => {
  const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  const span = (segs: readonly Segment[]) =>
    segs.map(
      ([a, b]) =>
        `${new Date(a).toISOString().slice(0, 10)}→${new Date(b).toISOString().slice(0, 10)}`,
    );

  // A week where the market opened every weekday, but our data is MISSING the
  // Wednesday. `2025-11-19` is a real session; we simply have no bar for it.
  const HELD = ['2025-11-17', '2025-11-18', '2025-11-20', '2025-11-21'].map(utc);
  const CALENDAR = ['2025-11-17', '2025-11-18', '2025-11-19', '2025-11-20', '2025-11-21'].map(utc);

  it('inferring from bars COLLAPSES the missing session — it looks like a closure', () => {
    // The limitation, stated as a test: data cannot report what it does not contain,
    // so an absent session is indistinguishable from a day the market was shut.
    const segs = exactSessionSegments(HELD, DAY);
    expect(span(segs)).toEqual(['2025-11-17→2025-11-19', '2025-11-20→2025-11-22']);
    // Two spans with the 19th excised — the axis reserves no width for it, so the
    // line is continuous and nothing on screen says a session is missing.
    expect(segs).toHaveLength(2);
  });

  it('the calendar KEEPS it live, so the hole in our data is visible', () => {
    // One unbroken span across the whole week: the axis reserves width for the 19th,
    // and the series simply has no point there. That gap is the truth.
    const segs = exactSessionSegments(CALENDAR, DAY);
    expect(span(segs)).toEqual(['2025-11-17→2025-11-22']);
    expect(segs).toHaveLength(1);
  });

  it('still collapses a real closure, because the calendar omits it', () => {
    // The distinction the whole thing rests on: a session the market never held is
    // absent from the calendar too, so it collapses either way. Only a session that
    // EXISTED and is missing from our data stays visible.
    const withHoliday = ['2025-11-26', '2025-11-28'].map(utc); // 27th = Thanksgiving
    expect(span(exactSessionSegments(withHoliday, DAY))).toEqual([
      '2025-11-26→2025-11-27',
      '2025-11-28→2025-11-29',
    ]);
  });

  it('clipping to the data span is what stops a listing date reading as a gap', () => {
    // A calendar reaches back further than any one instrument. Clipped to the bars
    // we hold, the sessions before it listed are simply outside the axis rather than
    // drawn as a hole the size of a decade.
    const listed = utc('2025-11-20');
    const clipped = CALENDAR.filter((d) => d >= listed);
    expect(span(exactSessionSegments(clipped, DAY))).toEqual(['2025-11-20→2025-11-22']);
  });
});
