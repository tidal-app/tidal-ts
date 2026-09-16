import { describe, expect, it } from 'vitest';
import { generatePriceSeries, DEMO_INSTRUMENTS } from './fixture.js';
import type { Instrument } from './types.js';

const AAPL: Instrument = { symbol: 'AAPL', name: 'Apple Inc.', kind: 'equity' };

describe('generatePriceSeries', () => {
  it('produces the requested number of bars', () => {
    const ts = generatePriceSeries(AAPL, { bars: 50 });
    expect(ts.length).toBe(50);
  });

  it('carries the OHLCV columns keyed by time', () => {
    const ts = generatePriceSeries(AAPL, { bars: 5 });
    const row = ts.toObjects()[0]!;
    for (const col of ['open', 'high', 'low', 'close', 'volume']) {
      expect(typeof row[col]).toBe('number');
    }
  });

  it('is deterministic for a given symbol (no wall-clock, no Math.random)', () => {
    const a = generatePriceSeries(AAPL, { bars: 30 });
    const b = generatePriceSeries(AAPL, { bars: 30 });
    expect(a.toObjects()).toEqual(b.toObjects());
  });

  it('varies by seed', () => {
    const a = generatePriceSeries(AAPL, { bars: 30, seed: 1 });
    const b = generatePriceSeries(AAPL, { bars: 30, seed: 2 });
    expect(a.toObjects()).not.toEqual(b.toObjects());
  });

  it('keeps prices positive and high ≥ low for every bar', () => {
    const ts = generatePriceSeries(AAPL, { bars: 200 });
    for (const row of ts.toObjects()) {
      expect(row.low as number).toBeGreaterThan(0);
      expect(row.high as number).toBeGreaterThanOrEqual(row.low as number);
    }
  });

  it('orders bars ascending in time', () => {
    const ts = generatePriceSeries(AAPL, { bars: 10 });
    const first = ts.first();
    const last = ts.last();
    expect(first).toBeDefined();
    expect(last).toBeDefined();
  });

  it('ships a demo universe', () => {
    expect(DEMO_INSTRUMENTS.length).toBeGreaterThan(0);
    for (const inst of DEMO_INSTRUMENTS) {
      expect(generatePriceSeries(inst, { bars: 3 }).length).toBe(3);
    }
  });
});
