import { describe, expect, it } from 'vitest';
import { seriesSnap } from './snap.js';
import type { CursorSnap } from '@pond-ts/charts';

const snap = (label: string): CursorSnap =>
  ({ label, x: 1, value: 2, color: '#fff', axisId: 'top:L', formatted: '2.0' }) as CursorSnap;

describe('seriesSnap', () => {
  it('takes a plain layer’s label as the id', () => {
    expect(seriesSnap(snap('s-1'), ['s-1', 's-2'])?.id).toBe('s-1');
    expect(seriesSnap(snap('s-1'), ['s-1'])?.part).toBeUndefined();
  });

  it('undoes a MULTI-LAYER mark’s composite label', () => {
    // A band and a candle with `showOHLC` report `"<as> <role>"`, which is
    // where a host keying on the id alone matched nothing.
    expect(seriesSnap(snap('s-3 lower'), ['s-3'])).toMatchObject({ id: 's-3', part: 'lower' });
    expect(seriesSnap(snap('s-1 high'), ['s-1'])).toMatchObject({ id: 's-1', part: 'high' });
  });

  it('undoes a split bar’s falling half', () => {
    expect(seriesSnap(snap('s-4__down'), ['s-4'])).toMatchObject({ id: 's-4', part: 'down' });
  });

  it('gives the LONGEST id that claims the label, not the first', () => {
    // `sma(iv21)` and `sma(iv21;period=20)` can sit in one row, and the shorter
    // would otherwise claim the longer's layers.
    const ids = ['p1:sma(iv21)', 'p1:sma(iv21) x', 'p1:sma(iv21;period=20)'];
    expect(seriesSnap(snap('p1:sma(iv21;period=20) upper'), ids)?.id).toBe(
      'p1:sma(iv21;period=20)',
    );
    expect(seriesSnap(snap('p1:sma(iv21) x lower'), ids)).toMatchObject({
      id: 'p1:sma(iv21) x',
      part: 'lower',
    });
  });

  it('keeps everything the cursor reported', () => {
    const s = seriesSnap(snap('s-1 close'), ['s-1'])!;
    expect(s).toMatchObject({ axisId: 'top:L', formatted: '2.0', value: 2, color: '#fff' });
  });

  it('is null for a label no config claims — better than a guess', () => {
    expect(seriesSnap(snap('someone-else'), ['s-1'])).toBeNull();
    expect(seriesSnap(snap('s-1x'), ['s-1'])).toBeNull();
    expect(seriesSnap(snap('s-1'), [])).toBeNull();
  });
});
