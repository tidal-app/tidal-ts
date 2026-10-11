import { describe, expect, it } from 'vitest';
import { withAlpha } from './withAlpha.js';

describe('withAlpha', () => {
  it('is the identity at 1', () => {
    expect(withAlpha('#4f9cd9', 1)).toBe('#4f9cd9');
  });
  it('fades the hex forms', () => {
    expect(withAlpha('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
    expect(withAlpha('#4f9cd9', 0.5)).toBe('rgba(79, 156, 217, 0.5)');
  });
  it('multiplies an alpha the colour already carries', () => {
    expect(withAlpha('#00000080', 0.5)).toBe('rgba(0, 0, 0, 0.251)');
    expect(withAlpha('rgba(1, 2, 3, 0.4)', 0.5)).toBe('rgba(1, 2, 3, 0.2)');
    expect(withAlpha('rgb(1 2 3 / 50%)', 0.5)).toBe('rgba(1, 2, 3, 0.25)');
  });
  it('composes: opacity then dimming is their product', () => {
    expect(withAlpha('#000', 0.5 * 0.4)).toBe('rgba(0, 0, 0, 0.2)');
  });
  it('leaves a form it cannot read unchanged', () => {
    expect(withAlpha('hsl(10 20% 30%)', 0.5)).toBe('hsl(10 20% 30%)');
    expect(withAlpha('var(--td-accent)', 0.5)).toBe('var(--td-accent)');
  });
});
