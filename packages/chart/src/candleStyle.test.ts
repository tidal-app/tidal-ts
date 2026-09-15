import { describe, expect, it } from 'vitest';
import { candleStyleForColor } from './candleStyle.js';

describe('candleStyleForColor', () => {
  it('is a single-colour pair (rising === falling) for colorBy="series"', () => {
    const s = candleStyleForColor('#abcdef');
    expect(s.rising).toEqual({ body: '#abcdef', wick: '#abcdef' });
    expect(s.falling).toEqual(s.rising);
    expect(s.neutral).toEqual(s.rising);
    expect(s.wickWidth).toBe(1);
  });
});
