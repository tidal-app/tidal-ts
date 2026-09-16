import { describe, expect, it } from 'vitest';
import { DEMO_INSTRUMENTS, deriveId, generatePriceSeries, generateVolSeries } from '@tidal-ts/core';
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
