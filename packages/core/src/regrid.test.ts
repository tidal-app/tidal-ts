import { describe, expect, it } from 'vitest';
import { holdVolAcrossGrid } from './regrid.js';
import { buildVolSeries, VOL_SCHEMA } from './vol.js';

/**
 * Holding a daily vol curve across an intraday grid.
 *
 * The behaviour that matters is that it is a **step**, not a slope, and that a day
 * with no source row reads as a gap rather than as zero. Both are about not
 * inventing intraday structure the archive cannot support.
 */

const DAY = 24 * 60 * 60 * 1000;
const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
/** A trading minute inside a given UTC day. */
const min = (iso: string, hh: number, mm = 0) => d(iso) + hh * 3600_000 + mm * 60_000;

/**
 * A vol series carrying the FULL `VOL_SCHEMA` — `buildVolSeries` requires every
 * column, so a fixture naming only the ones it cares about is rejected. Named
 * columns take their values; the rest are NaN, which is what a real series with
 * sparse tenors looks like.
 */
const volSeries = (time: number[], cols: Record<string, number[]>) => {
  const columns: Record<string, number[]> = { time };
  for (const spec of VOL_SCHEMA) {
    if (spec.name === 'time') continue;
    columns[spec.name] = cols[spec.name] ?? time.map(() => NaN);
  }
  return buildVolSeries('vol', columns);
};

const daily = (rows: { day: string; iv21: number }[]) =>
  volSeries(
    rows.map((r) => d(r.day)),
    { iv21: rows.map((r) => r.iv21) },
  );

const read = (s: ReturnType<typeof buildVolSeries>, col: string) => {
  const c = s.column(col) as unknown as { at(i: number): number | undefined };
  return Array.from({ length: s.length }, (_, i) => c.at(i));
};

describe('holdVolAcrossGrid', () => {
  it('holds each day’s value flat across that day’s bars', () => {
    const coarse = daily([
      { day: '2026-05-18', iv21: 23 },
      { day: '2026-05-19', iv21: 25 },
    ]);
    const times = [
      min('2026-05-18', 13, 30),
      min('2026-05-18', 16, 0),
      min('2026-05-18', 19, 59),
      min('2026-05-19', 13, 30),
      min('2026-05-19', 19, 59),
    ];
    const out = holdVolAcrossGrid(coarse, times);
    expect(out.length).toBe(5);
    // A STEP: three identical values then a jump. Not 23, 24, 25 — interpolating
    // would invent an intraday path the daily observation does not contain.
    expect(read(out, 'iv21')).toEqual([23, 23, 23, 25, 25]);
  });

  it('re-keys onto the target grid, not the source’s midnights', () => {
    // The reason this exists: a daily key is UTC midnight, which is not a trading
    // minute, and `TimeSeriesChart` builds its session model from the UNION of source
    // timestamps. Leaking midnight in corrupts the axis, not just the panel.
    const times = [min('2026-05-18', 13, 30), min('2026-05-18', 14, 0)];
    const out = holdVolAcrossGrid(daily([{ day: '2026-05-18', iv21: 23 }]), times);
    const key = out.keyColumn() as unknown as { at(i: number): number | undefined };
    expect([key.at(0), key.at(1)]).toEqual(times);
    expect(key.at(0)! % DAY).not.toBe(0); // emphatically not a midnight
  });

  it('gaps a target day the source has no row for, rather than zeroing it', () => {
    // "No vol published for this session" is not "vol was nothing" — a 0 would
    // draw a spike to the axis floor, the same trap as the sentinel-price case.
    const times = [min('2026-05-18', 14), min('2026-05-19', 14), min('2026-05-20', 14)];
    const out = holdVolAcrossGrid(
      daily([
        { day: '2026-05-18', iv21: 23 },
        { day: '2026-05-20', iv21: 27 },
      ]),
      times,
    );
    const got = read(out, 'iv21');
    expect(got[0]).toBe(23);
    expect(Number.isFinite(got[1]!)).toBe(false); // the missing middle day
    expect(got[2]).toBe(27);
  });

  it('lets a later row win when a day is restated', () => {
    // `TickerHistory3` restates `ccVar`, and a restatement arrives as a second row
    // for the same day. The newer value is the one to hold.
    const coarse = volSeries([d('2026-05-18'), d('2026-05-18')], { iv21: [23, 24.5] });
    const out = holdVolAcrossGrid(coarse, [min('2026-05-18', 14)]);
    expect(read(out, 'iv21')).toEqual([24.5]);
  });

  it('keeps the full vol schema, gapping the columns the source lacks', () => {
    // `buildVolSeries` requires every `VOL_SCHEMA` column, and keeping the vol
    // series' TYPE stable is worth more than signalling absence by omission. So a
    // column the source never had is all-NaN — an empty layer, not a wrong one.
    const coarse = volSeries([d('2026-05-18')], { iv21: [23], ccVar: [0.0001] });
    const out = holdVolAcrossGrid(coarse, [min('2026-05-18', 14)]);
    expect(read(out, 'iv21')).toEqual([23]);
    expect(read(out, 'ccVar')).toEqual([0.0001]);
    expect(Number.isFinite(read(out, 'hv21')[0]!)).toBe(false);
  });

  it('is a no-op with nothing to do, so the caller can apply it unconditionally', () => {
    const coarse = daily([{ day: '2026-05-18', iv21: 23 }]);
    expect(holdVolAcrossGrid(coarse, [])).toBe(coarse);
    expect(holdVolAcrossGrid(volSeries([], {}), [1, 2])).toHaveLength(0);
  });

  it('holds across a whole real session without drifting off the day', () => {
    // 390 minutes, 09:30–16:00 ET on a summer day = 13:30–20:00 UTC. Every one of
    // them must land on the same source day — an off-by-one in `dayOf` would gap
    // the tail of the session.
    const times = Array.from({ length: 390 }, (_, i) => min('2026-05-18', 13, 30 + i));
    const out = holdVolAcrossGrid(daily([{ day: '2026-05-18', iv21: 23 }]), times);
    expect(new Set(read(out, 'iv21'))).toEqual(new Set([23]));
  });
});
