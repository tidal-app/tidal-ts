import { describe, expect, it } from 'vitest';
import { monthlyExpirations, thirdFriday } from './expirations.js';

/**
 * The expiration derivation, pinned against **measured** calendar behaviour.
 *
 * The four back-step cases below are not invented: they are every month in
 * 2015–2026 where an exchange trading calendar has the third Friday closed (144 months
 * checked). Three are Good Friday; the fourth is Juneteenth 2026, which is why
 * this reads a calendar rather than computing Easter.
 */

const d = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Every weekday in a range, as a stand-in calendar. Holidays are then removed by
 *  name, which is how the real calendar differs from a weekday grid. */
function weekdays(fromIso: string, toIso: string, closed: string[] = []): number[] {
  const shut = new Set(closed.map(d));
  const out: number[] = [];
  for (let t = d(fromIso); t <= d(toIso); t += 86_400_000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6 && !shut.has(t)) out.push(t);
  }
  return out;
}

describe('thirdFriday', () => {
  it('lands on a Friday for every month of a year', () => {
    for (let m = 0; m < 12; m++) {
      expect(new Date(thirdFriday(2025, m)).getUTCDay()).toBe(5);
    }
  });

  it('is the third Friday by calendar date, holidays notwithstanding', () => {
    // April 2025's third Friday IS Good Friday. This function must still say so —
    // the holiday adjustment belongs to the caller, and folding it in here is
    // exactly the conflation that produced the wrong dates.
    expect(iso(thirdFriday(2025, 3))).toBe('2025-04-18');
    // Where the 1st is itself a Friday, the third is the 15th (no off-by-one).
    expect(iso(thirdFriday(2025, 7))).toBe('2025-08-15');
    expect(new Date(Date.UTC(2025, 7, 1)).getUTCDay()).toBe(5);
  });
});

describe('monthlyExpirations', () => {
  it('takes the third Friday when the market is open', () => {
    const cal = weekdays('2025-01-01', '2025-03-31');
    expect(monthlyExpirations(cal, d('2025-01-01'), d('2025-03-31')).map(iso)).toEqual([
      '2025-01-17',
      '2025-02-21',
      '2025-03-21',
    ]);
  });

  it('steps BACK to Thursday when the third Friday is closed — all four real cases', () => {
    // Measured: every month in 2015–2026 whose third Friday the market was shut.
    const cases = [
      { closed: '2019-04-19', expiry: '2019-04-18' }, // Good Friday
      { closed: '2022-04-15', expiry: '2022-04-14' }, // Good Friday
      { closed: '2025-04-18', expiry: '2025-04-17' }, // Good Friday
      { closed: '2026-06-19', expiry: '2026-06-18' }, // Juneteenth — not Easter-derived
    ];
    for (const { closed, expiry } of cases) {
      const month = closed.slice(0, 7);
      const cal = weekdays(`${month}-01`, `${month}-28`, [closed]);
      const got = monthlyExpirations(cal, d(`${month}-01`), d(`${month}-28`)).map(iso);
      expect(got, `expiration for ${month}`).toEqual([expiry]);
    }
  });

  it('never steps FORWARD past a closed third Friday', () => {
    // The contract cannot outlive its own expiry, so the adjustment is always
    // backwards. Asserted as a direction, not a date.
    const cal = weekdays('2025-04-01', '2025-04-30', ['2025-04-18']);
    const [expiry] = monthlyExpirations(cal, d('2025-04-01'), d('2025-04-30'));
    expect(expiry!).toBeLessThan(d('2025-04-18'));
  });

  it('counts Fridays on the calendar, not among trading days', () => {
    // THE regression. July 2025's Fridays are the 4th, 11th, 18th, 25th, and the
    // 4th is a holiday. Counting only open Fridays makes the 25th "third"; the
    // real expiration is the 18th. Same shape as the April case, different cause,
    // and it is the one a "third trading Friday" implementation gets wrong while
    // still passing every Good Friday test above.
    const cal = weekdays('2025-07-01', '2025-07-31', ['2025-07-04']);
    expect(monthlyExpirations(cal, d('2025-07-01'), d('2025-07-31')).map(iso)).toEqual([
      '2025-07-18',
    ]);
  });

  it('range-checks AFTER resolving, so a back-step can leave the window', () => {
    // A window starting on the closed Friday itself: its expiration resolved to
    // the day before, which is outside. Dropping it is correct — the alternative
    // is a marker on a session the window does not cover.
    const cal = weekdays('2025-04-01', '2025-04-30', ['2025-04-18']);
    expect(monthlyExpirations(cal, d('2025-04-18'), d('2025-04-30'))).toEqual([]);
  });

  it('skips a month the calendar cannot place rather than guessing', () => {
    // Calendar begins after the third Friday: there is no previous session to
    // step back to. Emitting the bare date arithmetic would put a marker on a day
    // we have no evidence the market was open.
    const cal = weekdays('2025-04-21', '2025-04-30', []);
    expect(monthlyExpirations(cal, d('2025-04-01'), d('2025-04-30'))).toEqual([]);
  });

  it('does NOT invent an expiration when the calendar stops mid-month', () => {
    // `previousSession` cannot distinguish "the market was shut that Friday" from
    // "the calendar ends before that Friday", so a partial trailing month used to
    // back-step onto the final session and emit it. Here the calendar ends
    // 2025-03-10 and March's third Friday is 03-21, which it never reaches — so
    // March has no expiration, and 03-10 is just the last session.
    const cal = weekdays('2025-01-01', '2025-03-10');
    const got = monthlyExpirations(cal, cal[0]!, cal[cal.length - 1]!).map(iso);
    expect(got).toEqual(['2025-01-17', '2025-02-21']);
    expect(got).not.toContain('2025-03-10');
  });

  it('returns nothing for an empty calendar or an inverted range', () => {
    expect(monthlyExpirations([], d('2025-01-01'), d('2025-12-31'))).toEqual([]);
    const cal = weekdays('2025-01-01', '2025-12-31');
    expect(monthlyExpirations(cal, d('2025-12-31'), d('2025-01-01'))).toEqual([]);
  });

  it('spans years without dropping or duplicating a month', () => {
    const cal = weekdays('2024-01-01', '2026-12-31');
    const got = monthlyExpirations(cal, d('2024-01-01'), d('2026-12-31'));
    expect(got).toHaveLength(36); // three full years, one per month
    expect(got).toEqual([...got].sort((a, b) => a - b)); // ascending
    expect(new Set(got).size).toBe(36); // no duplicates at the year boundary
  });

  it('puts every expiration on a session', () => {
    // The property that makes these safe to draw: a marker never lands on a day
    // the market was shut.
    const closed = ['2025-04-18', '2025-07-04', '2025-12-25', '2025-01-01'];
    const cal = weekdays('2025-01-01', '2025-12-31', closed);
    const open = new Set(cal);
    for (const e of monthlyExpirations(cal, d('2025-01-01'), d('2025-12-31'))) {
      expect(open.has(e), `${iso(e)} is not a session`).toBe(true);
    }
  });
});
