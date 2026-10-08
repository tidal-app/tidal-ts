import { describe, expect, it } from 'vitest';
import { TimeSeries } from 'pond-ts';
import {
  applyDerived,
  DEMO_INSTRUMENTS,
  deriveId,
  generatePriceSeries,
  generateVolSeries,
  holdAcrossGrid,
} from '@tidal-ts/core';
import type { DeriveSpec } from '@tidal-ts/core';
import type { SeriesConfig } from './series.js';
import type { ChartSeries } from './types.js';
import { lastRow } from './seriesFacts.js';
import {
  assembleRows,
  carries,
  foldKey,
  foldSources,
  prepareChart,
  sourceFacts,
} from './prepare.js';
import { bandColumns } from './series.js';

// Deterministic fixtures (seeded walks) — the same the app runs on with no socket.
const price = generatePriceSeries(DEMO_INSTRUMENTS[0]!, { bars: 40 }) as unknown as ChartSeries;
const compare = generatePriceSeries(DEMO_INSTRUMENTS[1]!, { bars: 40 }) as unknown as ChartSeries;
const vol = generateVolSeries('AAPL', { bars: 40 }) as unknown as ChartSeries;

const cfg = (over: Partial<SeriesConfig> & Pick<SeriesConfig, 'id' | 'column'>): SeriesConfig => ({
  label: over.id,
  color: 'blue',
  axis: 'L',
  style: 'line',
  visible: true,
  value: null,
  source: 'price',
  ...over,
});
const sma: DeriveSpec = { op: 'sma', inputs: ['close'], params: { period: 5 } };
const smaOfNothing: DeriveSpec = { op: 'sma', inputs: ['nope'], params: { period: 5 } };
const ratioVsCompare: DeriveSpec = { op: 'ratio', inputs: ['close', 'cmp_close'] };

describe('foldSources', () => {
  it('folds a study onto its source so the derived column exists before the chart reads it', () => {
    const study = cfg({ id: 's-1', column: deriveId(sma), derive: sma });
    const out = foldSources({ price: { series: price } }, [study]);
    expect(sourceFacts(out).columns.price!.has(deriveId(sma))).toBe(true);
    // The raw columns survive the fold untouched.
    expect(sourceFacts(out).columns.price!.has('close')).toBe(true);
  });

  it('produces only the sources it was given; a spec on a missing input yields no column', () => {
    const ghost = cfg({ id: 's-2', column: deriveId(smaOfNothing), derive: smaOfNothing });
    const out = foldSources({ price: { series: price }, vol: { series: vol } }, [ghost]);
    expect(Object.keys(out).sort()).toEqual(['price', 'vol']);
    expect(sourceFacts(out).columns.price!.has(deriveId(smaOfNothing))).toBe(false);
  });

  it('joins the comparison under the compare prefix only when a config asks for it', () => {
    const plain = cfg({ id: 's-1', column: 'close' });
    const untouched = foldSources({ price: { series: price, compare } }, [plain]);
    expect(sourceFacts(untouched).columns.price!.has('cmp_close')).toBe(false);

    // A RAW compare leg (a split pair's leg: no spec) asks for the join…
    const leg = cfg({ id: 's-3', column: 'cmp_close' });
    const joined = foldSources({ price: { series: price, compare } }, [leg]);
    expect(sourceFacts(joined).columns.price!.has('cmp_close')).toBe(true);
    expect(sourceFacts(joined).columns.price!.has('close')).toBe(true);

    // …and so does a compare-bound spec, whose column then folds.
    const spread = cfg({ id: 's-4', column: deriveId(ratioVsCompare), derive: ratioVsCompare });
    const folded = foldSources({ price: { series: price, compare } }, [spread]);
    expect(sourceFacts(folded).columns.price!.has(deriveId(ratioVsCompare))).toBe(true);

    // Compare off ⇒ no join, and the spread simply is not carried.
    const off = foldSources({ price: { series: price } }, [spread]);
    expect(carries(sourceFacts(off), spread)).toBe(false);
  });
});

describe('foldKey', () => {
  it('ignores presentation and order; changes with the specs and the raw-compare set', () => {
    const a = cfg({ id: 's-1', column: deriveId(sma), derive: sma, color: 'blue' });
    const b = cfg({ id: 's-2', column: 'close', color: 'amber', visible: false });
    const recoloured = { ...a, color: 'red', lineWidth: 3, visible: false };
    expect(foldKey([a, b])).toBe(foldKey([recoloured, b]));
    expect(foldKey([a, b])).toBe(foldKey([b, a]));
    // Two STUDIES on one source swapped — the case a raw sibling would mask.
    // The machine reorders blocks; that must not re-fold.
    const c = cfg({ id: 's-3', column: deriveId(smaOfNothing), derive: smaOfNothing });
    expect(foldKey([a, c])).toBe(foldKey([c, a]));
    expect(foldKey([a, b])).not.toBe(foldKey([b]));
    const leg = cfg({ id: 's-3', column: 'cmp_close' });
    expect(foldKey([a, b, leg])).not.toBe(foldKey([a, b]));
  });
});

describe('assembleRows', () => {
  const study = cfg({ id: 's-1', column: deriveId(sma), derive: sma });
  const raw = cfg({ id: 's-2', column: 'close' });
  const missingRaw = cfg({ id: 's-3', column: 'nope' });
  const ghost = cfg({ id: 's-4', column: deriveId(smaOfNothing), derive: smaOfNothing });
  const legOfPair = cfg({
    id: 's-5',
    column: 'cmp_close',
    group: { id: 'g-1', side: 'A' },
  });
  const rows = [{ id: 'top', configs: [study, raw, missingRaw, ghost, legOfPair] }];
  const sources = foldSources({ price: { series: price } }, rows[0]!.configs);
  const facts = sourceFacts(sources);
  const [top] = assembleRows(rows, facts);

  it('drops a raw metric the data lacks, keeps a derived config and a leg-group member', () => {
    expect(top!.configs.map((c) => c.id)).toEqual(['s-1', 's-2', 's-4', 's-5']);
  });

  it('stamps the latest value from the last bar, columnar, and null where nothing is carried', () => {
    const last = lastRow(price)!;
    const byId = new Map(top!.configs.map((c) => [c.id, c]));
    expect(byId.get('s-2')!.value).toBe(last.close);
    expect(Number.isFinite(byId.get('s-1')!.value)).toBe(true);
    expect(byId.get('s-4')!.value).toBeNull();
    expect(byId.get('s-5')!.value).toBeNull();
  });

  it('carries() is the "this config draws" predicate, distinct from being listed', () => {
    expect(carries(facts, raw)).toBe(true);
    expect(carries(facts, study)).toBe(true);
    expect(carries(facts, ghost)).toBe(false);
    expect(carries(facts, legOfPair)).toBe(false);
  });

  it('prepareChart is the three steps composed', () => {
    const all = prepareChart({ price: { series: price } }, rows);
    expect(Object.keys(all.sources)).toEqual(['price']);
    expect(all.rows).toEqual(assembleRows(rows, sourceFacts(all.sources)));
  });
});

describe('a multi-output config is carried by ALL its outputs and valued by its primary', () => {
  // A band's `column` is the spec id, which names none of its three columns;
  // testing it directly said "not carried" for every band (and every
  // multi-output study once #182 landed), so the chip sat blank while the
  // hover readout showed a value.
  const bb: DeriveSpec = { op: 'bollinger', inputs: ['close'], params: { period: 5 } };
  const band = cfg({ id: 's-b', column: deriveId(bb), derive: bb, style: 'band' });
  const sources = foldSources({ price: { series: price } }, [band]);
  const facts = sourceFacts(sources);

  it('is carried when its edges exist, though its own column names nothing', () => {
    const { middle, upper, lower } = bandColumns(band.column);
    expect(facts.columns.price!.has(band.column)).toBe(false);
    expect([middle, upper, lower].every((c) => facts.columns.price!.has(c))).toBe(true);
    expect(carries(facts, band)).toBe(true);
  });

  it('reads its value off the primary output (the centre), not the spec id', () => {
    const [row] = assembleRows([{ id: 'top', configs: [band] }], facts);
    const valued = row!.configs[0]!;
    expect(valued.value).toBe(facts.last.price![bandColumns(band.column).middle]);
    expect(Number.isFinite(valued.value)).toBe(true);
  });
});

describe('a coarse source folds at its own grain, then holds across the axis', () => {
  // A daily curve on a one-minute axis. The curve is a ramp (day d reads
  // 50 + d), so a 20-day average has one right answer per day, and folding
  // the held series instead gives a different one.
  const DAY = 86_400_000;
  const DAYS = 30;
  const MINUTES = 30; // per session, from 13:30 UTC
  const day0 = Date.parse('2026-05-04T00:00:00Z');
  const daily = (name: string, value: (d: number) => number, skip?: number): ChartSeries => {
    const days = Array.from({ length: DAYS }, (_, d) => d).filter((d) => d !== skip);
    return TimeSeries.fromColumns({
      name,
      schema: [
        { name: 'time', kind: 'time' },
        { name: 'iv21', kind: 'number' },
      ] as const,
      columns: { time: days.map((d) => day0 + d * DAY), iv21: days.map(value) },
    }) as unknown as ChartSeries;
  };
  const vol = daily('vol', (d) => 50 + d);
  // The comparison has no row for day 12.
  const cmpVol = daily('cmp', (d) => 30 + d, 12);
  const grid = Float64Array.from({ length: DAYS * MINUTES }, (_, i) => {
    const d = Math.floor(i / MINUTES);
    return day0 + d * DAY + (13 * 60 + 30 + (i % MINUTES)) * 60_000;
  });
  const dayOf = (i: number) => Math.floor(i / MINUTES);

  const sma20: DeriveSpec = { op: 'sma', inputs: ['iv21'], params: { period: 20 } };
  const study = cfg({ id: 's-v', source: 'vol', column: deriveId(sma20), derive: sma20 });
  const mirror = cfg({ id: 'm-v', source: 'vol', column: 'cmp_iv21' });
  const out = foldSources({ vol: { series: vol, compare: cmpVol, hold: { grid, grainMs: DAY } } }, [
    study,
    mirror,
  ]).vol!;
  // Through `at`: a missing cell is `undefined` there, read here as NaN.
  const read = (s: ChartSeries, col: string) => {
    const c = s.column(col) as unknown as { at(i: number): number | undefined };
    return Array.from({ length: s.length }, (_, i) => c.at(i) ?? NaN);
  };

  it('is keyed on the grid, one row per grid point', () => {
    expect(out.length).toBe(grid.length);
    expect(Array.from((out.keyColumn() as unknown as { begin: Float64Array }).begin)).toEqual(
      Array.from(grid),
    );
  });

  it('a study of it is the daily study held, not a study of the held series', () => {
    const want = read(applyDerived(vol, [sma20]), deriveId(sma20));
    const got = read(out, deriveId(sma20));
    // The last session: the mean of days 10–29 is 69.5. A 20-bar average of
    // the held series is a 20-minute window over one flat day, so it reads that
    // day's raw value, 79.
    expect(got[grid.length - 1]).toBe(69.5);
    // Every grid point reads its own day's study; the first 19 days have none.
    expect(got).toEqual(Array.from(grid, (_, i) => want[dayOf(i)]));
    expect(Number.isNaN(got[0])).toBe(true);
  });

  it('holding first, then folding, reads the raw value instead (the order this replaces)', () => {
    const heldFirst = foldSources(
      { vol: { series: holdAcrossGrid(vol, grid, DAY), compare: cmpVol } },
      [study],
    ).vol!;
    expect(read(heldFirst, deriveId(sma20))[grid.length - 1]).toBe(79);
  });

  it('the comparison columns survive the hold, and a missing day stays a gap', () => {
    const cmp = read(out, 'cmp_iv21');
    const own = read(out, 'iv21');
    for (let i = 0; i < grid.length; i += 1) {
      expect(own[i]).toBe(50 + dayOf(i));
      if (dayOf(i) === 12) expect(Number.isNaN(cmp[i])).toBe(true);
      else expect(cmp[i]).toBe(30 + dayOf(i));
    }
    expect(carries(sourceFacts({ vol: out }), mirror)).toBe(true);
  });

  // Four sessions, one grid point each, for the edge cases below.
  const four = (name: string, days: number[], values: number[]): ChartSeries =>
    TimeSeries.fromColumns({
      name,
      schema: [
        { name: 'time', kind: 'time' },
        { name: 'iv21', kind: 'number' },
      ] as const,
      columns: { time: days.map((d) => day0 + d * DAY), iv21: values },
    }) as unknown as ChartSeries;
  const noon = Float64Array.from([0, 1, 2, 3], (d) => day0 + d * DAY + 12 * 3_600_000);
  const sma2: DeriveSpec = { op: 'sma', inputs: ['iv21'], params: { period: 2 } };
  const edge = (series: ChartSeries, compare: ChartSeries) =>
    foldSources({ vol: { series, compare, hold: { grid: noon, grainMs: DAY } } }, [
      cfg({ id: 's-2', source: 'vol', column: deriveId(sma2), derive: sma2 }),
      mirror,
    ]).vol!;
  const cmp4 = four('cmp', [0, 1, 2, 3], [10, 20, 30, 40]);

  it('a restated row replaces the one before it, before the join and the studies read it', () => {
    // Day 1 arrives twice. Joined as it is, the second copy pairs with nothing
    // (a gap in the comparison for the whole day) and the study counts it as a
    // bar of its own (2.25 where the day's average is 1.75).
    const restated = four('vol', [0, 1, 1, 2, 3], [1, 2, 2.5, 3, 4]);
    const held = edge(restated, cmp4);
    expect(read(held, 'iv21')).toEqual([1, 2.5, 3, 4]);
    expect(read(held, 'cmp_iv21')).toEqual([10, 20, 30, 40]);
    expect(read(held, deriveId(sma2))).toEqual([NaN, 1.75, 2.75, 3.5]);
    // The same on the comparison's side: its later row is the one joined.
    const cmpRestated = four('cmp', [0, 1, 1, 2, 3], [10, 20, 25, 30, 40]);
    expect(read(edge(four('vol', [0, 1, 2, 3], [1, 2, 3, 4]), cmpRestated), 'cmp_iv21')).toEqual([
      10, 25, 30, 40,
    ]);
  });

  it('the comparison joins on the coarse keys, as it does unheld', () => {
    // A day the source lacks is a gap in the comparison too.
    const missing = four('vol', [0, 2, 3], [1, 3, 4]);
    expect(read(edge(missing, cmp4), 'cmp_iv21')).toEqual([10, NaN, 30, 40]);
    // A comparison keyed at another time of day matches nothing.
    const at4 = TimeSeries.fromColumns({
      name: 'cmp',
      schema: [
        { name: 'time', kind: 'time' },
        { name: 'iv21', kind: 'number' },
      ] as const,
      columns: {
        time: [0, 1, 2, 3].map((d) => day0 + d * DAY + 4 * 3_600_000),
        iv21: [1, 2, 3, 4],
      },
    }) as unknown as ChartSeries;
    expect(read(edge(four('vol', [0, 1, 2, 3], [1, 2, 3, 4]), at4), 'cmp_iv21')).toEqual([
      NaN,
      NaN,
      NaN,
      NaN,
    ]);
  });

  it('a comparison column with no value on the first day is still carried', () => {
    // The column names come from the schema. Taken from the first row, a
    // `cmp_*` column whose first day had no match was never scanned (pond
    // before 0.72 left an unmatched column out of a row's `data()`).
    const late = four('cmp', [1, 2, 3], [20, 30, 40]);
    const held = edge(four('vol', [0, 1, 2, 3], [1, 2, 3, 4]), late);
    expect(read(held, 'cmp_iv21')).toEqual([NaN, 20, 30, 40]);
    expect(carries(sourceFacts({ vol: held }), mirror)).toBe(true);
  });

  it('an empty grid gives an empty source, never the coarse keys on the axis', () => {
    const empty = foldSources(
      { vol: { series: vol, hold: { grid: new Float64Array(0), grainMs: DAY } } },
      [study],
    ).vol!;
    expect(empty.length).toBe(0);
  });
});
