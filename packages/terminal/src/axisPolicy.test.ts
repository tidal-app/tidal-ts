import { describe, expect, it } from 'vitest';
import {
  allowedAxes,
  axisBindings,
  axisForAdd,
  canAddUnit,
  type AxisMember,
} from './axisPolicy.js';

const pct = (axis: 'L' | 'R'): AxisMember => ({ unit: '%', axis });
const usd = (axis: 'L' | 'R'): AxisMember => ({ unit: '$', axis });

describe('axisBindings', () => {
  it('binds a side to the unit of the first series on it', () => {
    expect(axisBindings([pct('L')])).toEqual({ L: '%' });
  });
  it('reports both sides when each is occupied', () => {
    expect(axisBindings([pct('L'), usd('R')])).toEqual({ L: '%', R: '$' });
  });
  it('is empty for no members', () => {
    expect(axisBindings([])).toEqual({});
  });
});

describe('allowedAxes', () => {
  it('allows both sides when the panel is empty', () => {
    expect(allowedAxes([], '%')).toEqual(['L', 'R']);
  });
  it('allows the bound side + the free side for the same unit', () => {
    expect(allowedAxes([pct('L')], '%')).toEqual(['L', 'R']);
  });
  it('forces a different unit onto the free side only', () => {
    expect(allowedAxes([pct('L')], '$')).toEqual(['R']);
  });
  it('allows nothing when both sides are bound to other units', () => {
    expect(allowedAxes([pct('L'), usd('R')], '')).toEqual([]);
  });
  it('still allows the matching side when both sides are bound', () => {
    expect(allowedAxes([pct('L'), usd('R')], '%')).toEqual(['L']);
  });
  it('allows no unit onto a (malformed) mixed-unit side — the gate is not lossy', () => {
    const mixedLeft: AxisMember[] = [pct('L'), usd('L')]; // shouldn't happen; must fail safe
    expect(allowedAxes(mixedLeft, '%')).toEqual(['R']); // L rejected (holds a $), R free
    expect(allowedAxes(mixedLeft, '$')).toEqual(['R']); // L rejected (holds a %), R free
  });
});

describe('canAddUnit', () => {
  it('is false only when no side is compatible', () => {
    expect(canAddUnit([pct('L'), usd('R')], '')).toBe(false);
    expect(canAddUnit([pct('L')], '$')).toBe(true);
  });
});

describe('axisForAdd', () => {
  it('keeps the preferred side when allowed', () => {
    expect(axisForAdd([pct('L')], '%', 'R')).toBe('R');
  });
  it('falls back to the other allowed side when the preferred is incompatible', () => {
    // preferred L is bound to %, a $ series must go R
    expect(axisForAdd([pct('L')], '$', 'L')).toBe('R');
  });
  it('returns null when incompatible with both sides', () => {
    expect(axisForAdd([pct('L'), usd('R')], '', 'R')).toBeNull();
  });
});
