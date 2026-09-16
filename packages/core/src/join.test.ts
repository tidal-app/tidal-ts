import { describe, expect, it } from 'vitest';
import { TimeSeries } from 'pond-ts';
import { applyDerived, deriveId, type DeriveSpec } from './derive.js';
import { joinUnderPrefix } from './join.js';

const SCHEMA = [
  { name: 'time', kind: 'time' },
  { name: 'iv21', kind: 'number' },
] as const;

const mk = (vals: number[]) =>
  TimeSeries.fromColumns({
    name: 's',
    schema: SCHEMA,
    columns: { time: vals.map((_, i) => i * 86_400_000), iv21: vals },
    sort: true,
  }) as unknown as TimeSeries<typeof SCHEMA>;

describe('joinUnderPrefix', () => {
  it('carries the other side under the prefix and keeps the primary names intact', () => {
    const joined = joinUnderPrefix(mk([20, 22, 24]), mk([10, 11, 12]));
    const names = joined.schema.map((c) => c.name);
    // The primary's name survives untouched (the whole point of rename-then-join
    // over pond's onConflict:'prefix', which inserts an implicit `_`).
    expect(names).toContain('iv21');
    expect(names).toContain('cmp_iv21');
    expect(names).not.toContain('_iv21');
    expect(names).not.toContain('cmp__iv21');
  });

  it('feeds a compare-bound pair spec end to end (join, then fold)', () => {
    const joined = joinUnderPrefix(mk([20, 22, 24]), mk([10, 11, 12]));
    const spec: DeriveSpec = { op: 'ratio', inputs: ['iv21', 'cmp_iv21'] };
    const out = applyDerived(joined, [spec]);
    const objs = out.toObjects() as Record<string, number | null>[];
    expect(objs.map((r) => r[deriveId(spec)])).toEqual([2, 2, 2]);
  });

  it('left-joins on exact timestamps — a missing compare row is a gap, not a dropped row', () => {
    const primary = mk([20, 22, 24]);
    const compare = TimeSeries.fromColumns({
      name: 's',
      schema: SCHEMA,
      // Only the first and third timestamps — the middle row has no compare match.
      columns: { time: [0, 2 * 86_400_000], iv21: [10, 12] },
      sort: true,
    }) as unknown as TimeSeries<typeof SCHEMA>;
    const joined = joinUnderPrefix(primary, compare);
    const objs = joined.toObjects() as Record<string, number | null>[];
    expect(objs).toHaveLength(3); // left join keeps every primary row
    expect(objs[1]!.cmp_iv21 ?? null).toBeNull(); // the unmatched row reads as a gap
  });
});
