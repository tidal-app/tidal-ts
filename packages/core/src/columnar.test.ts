import { describe, expect, it } from 'vitest';
import {
  appendToRows,
  snapshotToTimeSeries,
  type PondAppend,
  type PondSnapshot,
  type WireColumnSpec,
} from './columnar.js';

// A daily-history snapshot — a backend's wire example, filled in: a `time`
// key, a string `ticker` column, numeric
// OHLC. The string column is the case that must be dropped.
const TICKER_HISTORY: PondSnapshot = {
  name: 'AAPL',
  count: 3,
  schema: [
    { name: 'time', kind: 'time', required: true },
    { name: 'ticker', kind: 'string', required: true },
    { name: 'open', kind: 'number', required: true },
    { name: 'high', kind: 'number', required: true },
    { name: 'low', kind: 'number', required: true },
    { name: 'close', kind: 'number', required: true },
  ],
  columns: {
    time: [1751932800000, 1752019200000, 1752105600000],
    ticker: ['AAPL', 'AAPL', 'AAPL'],
    open: [192.51, 193.02, 193.44],
    high: [194.1, 194.0, 195.2],
    low: [191.8, 192.5, 193.0],
    close: [193.02, 193.44, 194.8],
  },
};

describe('snapshotToTimeSeries', () => {
  it('adapts a columnar snapshot into a pond TimeSeries (count + values)', () => {
    const rows = snapshotToTimeSeries(TICKER_HISTORY).toObjects() as Record<string, number>[];
    expect(rows).toHaveLength(3);
    expect(rows[0]?.open).toBe(192.51);
    expect(rows[2]?.close).toBe(194.8);
  });

  it('drops non-numeric (string) columns — fromColumns is time+numeric only', () => {
    const row = snapshotToTimeSeries(TICKER_HISTORY).toObjects()[0] as Record<string, unknown>;
    expect('ticker' in row).toBe(false); // the ticker/key echo is partition metadata, not a series
    expect('open' in row).toBe(true);
  });

  it('handles an empty snapshot (a live-stream subscribe → count 0)', () => {
    const empty: PondSnapshot = {
      name: 'AAPL:NMS:EQT:2026-07-17',
      count: 0,
      schema: TICKER_HISTORY.schema,
      columns: { time: [], ticker: [], open: [], high: [], low: [], close: [] },
    };
    expect(snapshotToTimeSeries(empty).toObjects()).toHaveLength(0);
  });

  it('throws when a column length disagrees with count', () => {
    const bad: PondSnapshot = {
      ...TICKER_HISTORY,
      columns: { ...TICKER_HISTORY.columns, close: [1, 2] },
    };
    expect(() => snapshotToTimeSeries(bad)).toThrow(/close/);
  });

  it('throws when a required column is missing', () => {
    const { close: _drop, ...columns } = TICKER_HISTORY.columns;
    expect(() => snapshotToTimeSeries({ ...TICKER_HISTORY, columns })).toThrow(/close/);
  });
});

// A live-stream append: one tick, a string key column plus numerics.
const LIVE_SCHEMA: WireColumnSpec[] = [
  { name: 'time', kind: 'time', required: true },
  { name: 'key', kind: 'string', required: true },
  { name: 'atmVol', kind: 'number', required: true },
  { name: 'atmEMA', kind: 'number', required: true },
  { name: 'uPrc', kind: 'number', required: true },
  { name: 'sdiv', kind: 'number', required: true },
  { name: 'rate', kind: 'number', required: true },
];

const APPEND: PondAppend = {
  name: 'AAPL:NMS:EQT:2026-07-17',
  count: 1,
  columns: {
    time: [1752192000123],
    key: ['AAPL:NMS:EQT:2026-07-17'],
    atmVol: [0.2841],
    atmEMA: [0.2836],
    uPrc: [212.13],
    sdiv: [0.0],
    rate: [0.0524],
  },
};

describe('appendToRows', () => {
  it('transposes a columnar append to rows in numeric-schema order (time first, key dropped)', () => {
    expect(appendToRows(APPEND, LIVE_SCHEMA)).toEqual([
      [1752192000123, 0.2841, 0.2836, 212.13, 0.0, 0.0524],
    ]);
  });

  it('coerces a missing cell to NaN (pond treats non-finite as a gap)', () => {
    const gap: PondAppend = { ...APPEND, columns: { ...APPEND.columns, atmVol: [] } };
    expect(appendToRows(gap, LIVE_SCHEMA)[0]?.[1]).toBeNaN();
  });
});
