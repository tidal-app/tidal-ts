import { describe, expect, it } from 'vitest';
import { generateVolSeries, impliedCol, hvCol, VOL_TENORS } from './vol.js';

describe('generateVolSeries', () => {
  it('produces the requested bars with both ATM columns per tenor', () => {
    const ts = generateVolSeries('AAPL', { bars: 60 });
    expect(ts.length).toBe(60);
    const row = ts.toObjects()[0]!;
    for (const t of VOL_TENORS) {
      expect(typeof row[impliedCol(t)]).toBe('number');
      expect(typeof row[hvCol(t)]).toBe('number');
    }
  });

  it('is deterministic per symbol', () => {
    expect(generateVolSeries('AAPL', { bars: 40 }).toObjects()).toEqual(
      generateVolSeries('AAPL', { bars: 40 }).toObjects(),
    );
  });

  it('keeps every tenor positive', () => {
    for (const row of generateVolSeries('MSFT', { bars: 200 }).toObjects()) {
      for (const t of VOL_TENORS) {
        expect(row[impliedCol(t)] as number).toBeGreaterThan(0);
        expect(row[hvCol(t)] as number).toBeGreaterThan(0);
      }
    }
  });

  it('slopes upward on average — long tenors sit above the front (contango-ish)', () => {
    const rows = generateVolSeries('AAPL', { bars: 120 }).toObjects();
    const mean = (col: string) => rows.reduce((s, r) => s + (r[col] as number), 0) / rows.length;
    expect(mean(impliedCol(504))).toBeGreaterThan(mean(impliedCol(5)));
  });
});
