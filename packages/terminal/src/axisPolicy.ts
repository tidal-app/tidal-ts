import type { SeriesAxis } from '@tidal-ts/chart';

/**
 * Unit-driven axis compatibility for a panel. A panel has two sides (L / R);
 * once a series sits on a side, that side is **bound** to its unit. The rules
 * (pure functions, so they're unit-tested directly):
 *
 * - A series may share a side only with series of the **same unit** (exact match).
 * - A different unit must take the other side.
 * - With both sides bound to different units, a third unit can't be added.
 *
 * `members` is the panel's present series (each contributes its `unit` + `axis`).
 */
export interface AxisMember {
  unit: string;
  axis: SeriesAxis;
}

const SIDES: readonly SeriesAxis[] = ['L', 'R'];

/** The unit bound to each side (undefined = free). Reports the FIRST series' unit
 *  per side — sides are single-unit by construction (every add/move goes through
 *  {@link allowedAxes}), so this is for display/queries, not the safety gate. */
export function axisBindings(members: readonly AxisMember[]): { L?: string; R?: string } {
  const bindings: { L?: string; R?: string } = {};
  for (const m of members) if (bindings[m.axis] === undefined) bindings[m.axis] = m.unit;
  return bindings;
}

/** Sides where a series of `unit` may sit given `members`: a free side, or one
 *  where **every** present series already shares `unit`. Checking all members
 *  (not just the first-bound unit) keeps the gate correct even if a mixed-unit
 *  side ever slips in — such a side is then allowed for no unit. Pass `members`
 *  WITHOUT the series itself when asking where an existing series may move. */
export function allowedAxes(members: readonly AxisMember[], unit: string): SeriesAxis[] {
  return SIDES.filter((side) => members.every((m) => m.axis !== side || m.unit === unit));
}

/** Whether a series of `unit` can be added to the panel at all. */
export function canAddUnit(members: readonly AxisMember[], unit: string): boolean {
  return allowedAxes(members, unit).length > 0;
}

/** Which side to place a new series of `unit` on — its `preferred` side if that's
 *  allowed, else the other allowed side, else `null` (incompatible). */
export function axisForAdd(
  members: readonly AxisMember[],
  unit: string,
  preferred: SeriesAxis,
): SeriesAxis | null {
  const allowed = allowedAxes(members, unit);
  if (allowed.includes(preferred)) return preferred;
  return allowed[0] ?? null;
}
