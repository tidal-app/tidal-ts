/**
 * **Host levels** — horizontal lines a host places on a row, beside the
 * study-catalog guides (`guideLevels`). A level is a value the host already
 * holds, such as the last value of a series or the low and high of a window,
 * drawn across the plot on the axis of a series in that row.
 *
 * Drawn with `@pond-ts/charts`' `<Baseline>` (a level, each edge of a range)
 * and `<Zone>` (a range's wash). Like the guides, they never move an axis:
 * the marks read the axis's scale and do not feed its extent, so the line of a
 * level outside the window is off the plot. A level that should be on screen
 * is the host's to frame (`axisOptions`).
 *
 * How it meets charts' annotation register:
 *
 * - **Ink by role.** `<Baseline>` / `<Zone>` take colour from
 *   `theme.annotation.roles[role]` ("colour is a theme concern"), so each level
 *   gets its own role ({@link levelRole}), folded into the theme by
 *   {@link levelRoles}, the same route `ChartAnnotation.color` takes. The role
 *   carries the level's dash, `lineWidth` and wash too.
 * - **`opacity` is the line's opacity.** An inert mark paints at its role's
 *   `depth[2]`, so each level's role sets its depth to `[1, 1, 1]`: the line
 *   reads at the level's own `opacity`, not at that times the register's
 *   resting depth (0.4 in charts' themes) as it did before charts 0.76.
 * - **A chip stays in its row.** Since charts 0.77 `<Baseline>` hides a line
 *   and its chip when the value is off the visible y-range, and keeps a chip
 *   near the edge inside the row.
 * - **A bare theme keeps its ink.** A theme with no `annotation` gets one
 *   holding only the level roles; charts fills the rest from its
 *   `defaultAnnotation`, which is what it drew in anyway.
 *
 * Still open upstream: no per-mark colour prop, so a level is one theme role.
 *
 * @module
 */
import { configAxisId, dashPattern, type SeriesConfig } from './series.js';
import type { LineDash } from './chartSettings.js';
import { withAlpha } from './withAlpha.js';
import type { ChartTheme } from '@pond-ts/charts';

/** How a level draws. Every field but `color` is optional. */
export interface ChartLevelStyle {
  /** A palette key (resolved by the chart's `resolveColor`) or raw CSS. */
  color: string;
  /** Texture. Omitted ⇒ `solid`, whatever the theme's register dash is. */
  lineDash?: LineDash;
  /** `0..1`, folded into the colour: the line's own opacity (see the module
   *  note). Composes with the series' dimming. Omitted ⇒ `1`. */
  opacity?: number;
  /** Stroke width in px, for the line (or both edges of a range). Omitted ⇒
   *  the theme's annotation `lineWidth`, else `1`. */
  lineWidth?: number;
}

/** Shared by both kinds. */
interface ChartLevelBase extends ChartLevelStyle {
  /** Unique within its row. */
  id: string;
  /**
   * The id of the config in THIS row whose axis the level rides on. It scales
   * with that series, and is hidden while that series is not drawn (hidden, or
   * its column absent). A config in another row draws nothing.
   */
  series: string;
}

/** One value: a horizontal line across the plot. */
export interface ChartLevelLine extends ChartLevelBase {
  kind: 'level';
  value: number;
  /** A chip at the line's left end. Omitted ⇒ no chip. */
  label?: string;
}

/** A low and a high: two lines, optionally with a wash between them. */
export interface ChartLevelRange extends ChartLevelBase {
  kind: 'range';
  low: number;
  high: number;
  /** A chip on each edge. Omitted ⇒ none. */
  labels?: { low?: string; high?: string };
  /**
   * Opacity (`0..1`) of a wash between the two lines, in the level's colour.
   * Omitted (or `0`) ⇒ the two lines alone. Keep it light: the wash paints
   * over the data, like every annotation. `0.1` is the register's own fill.
   * The level's `opacity` scales it too; the register's depth does not.
   */
  fill?: number;
}

/** A host level on a row: one value, or a range. */
export type ChartLevel = ChartLevelLine | ChartLevelRange;

/** The theme role a level draws in. Unique per (row, level id). */
export const levelRole = (rowId: string, levelId: string): string =>
  `level\u0000${rowId}\u0000${levelId}`;

/** One `<Baseline>` to draw. */
export interface LevelLineMark {
  key: string;
  role: string;
  axis: string;
  value: number;
  /** `false` ⇒ no chip. */
  label: string | false;
}

/** One `<Zone>` (a range's wash) to draw. */
export interface LevelWashMark {
  key: string;
  role: string;
  axis: string;
  from: number;
  to: number;
}

/**
 * What a row's host levels draw: one line per level, two per range, and a
 * wash per range with a `fill`. Only levels whose `series` is in `drawn` (the
 * row's drawn configs); each on that config's axis ({@link configAxisId}).
 *
 * A non-finite value draws nothing. On a log axis a value at or below zero
 * draws nothing (as the guides skip theirs), and a range with such an edge
 * keeps its other line but loses its wash.
 */
export function rowLevelMarks(
  levels: readonly ChartLevel[] | undefined,
  drawn: readonly SeriesConfig[],
  rowId: string,
  isLog: (axisId: string) => boolean = () => false,
): { lines: LevelLineMark[]; washes: LevelWashMark[] } {
  const lines: LevelLineMark[] = [];
  const washes: LevelWashMark[] = [];
  if (!levels || levels.length === 0) return { lines, washes };
  const byId = new Map(drawn.map((c) => [c.id, c]));
  for (const l of levels) {
    const c = byId.get(l.series);
    if (!c) continue;
    const axis = configAxisId(rowId, c);
    const log = isLog(axis);
    const ok = (v: number) => Number.isFinite(v) && !(log && v <= 0);
    const role = levelRole(rowId, l.id);
    // The role doubles as the key: NUL-separated, so no row or level id can
    // collide with another's, nor with a host's own annotation role or id.
    const key = role;
    if (l.kind === 'level') {
      if (ok(l.value)) lines.push({ key, role, axis, value: l.value, label: l.label || false });
      continue;
    }
    if (ok(l.low))
      lines.push({
        key: `${key}\u0000low`,
        role,
        axis,
        value: l.low,
        label: l.labels?.low || false,
      });
    if (ok(l.high))
      lines.push({
        key: `${key}\u0000high`,
        role,
        axis,
        value: l.high,
        label: l.labels?.high || false,
      });
    if (l.fill !== undefined && l.fill > 0 && ok(l.low) && ok(l.high)) {
      washes.push({ key: `${key}\u0000fill`, role, axis, from: l.low, to: l.high });
    }
  }
  return { lines, washes };
}

/** A role entry, as `theme.annotation.roles` takes it. */
export interface LevelRoleStyle {
  color: string;
  dash: readonly number[];
  /** Always `[1, 1, 1]`: an inert mark paints at `depth[2]`, and a level's
   *  strength is its `opacity`, already in `color`. */
  depth: readonly [number, number, number];
  lineWidth?: number;
  fillOpacity?: number;
}

/** A level's depth ramp: every level at full strength, so `opacity` rules. */
const LEVEL_DEPTH = [1, 1, 1] as const;

const unit = (o: number | undefined): number =>
  typeof o === 'number' && Number.isFinite(o) ? Math.min(1, Math.max(0, o)) : 1;

/**
 * The theme roles every host level draws in, keyed by {@link levelRole}. Its
 * colour is resolved and carries the level's `opacity` (and the chart's
 * dimming, when the series it rides on is dimmed, at the same `0.22` a series
 * takes). `dash` is always stated, so a `solid` level stays solid on a theme
 * whose register is dashed, and `depth` is always `[1, 1, 1]`, so the line
 * reads at that colour. `lineWidth` is set only when the level gives one.
 */
export function levelRoles(
  rows: readonly { id: string; levels?: readonly ChartLevel[] }[],
  resolveColor: (color: string) => string,
  dimmed: ReadonlySet<string> = new Set(),
): Record<string, LevelRoleStyle> {
  const out: Record<string, LevelRoleStyle> = {};
  for (const r of rows) {
    for (const l of r.levels ?? []) {
      const alpha = unit(l.opacity) * (dimmed.has(l.series) ? 0.22 : 1);
      const dash = dashPattern(l.lineDash);
      out[levelRole(r.id, l.id)] = {
        color: withAlpha(resolveColor(l.color), alpha),
        dash: dash ? [...dash] : [],
        depth: LEVEL_DEPTH,
        ...(typeof l.lineWidth === 'number' && Number.isFinite(l.lineWidth) && l.lineWidth > 0
          ? { lineWidth: l.lineWidth }
          : {}),
        ...(l.kind === 'range' && l.fill !== undefined && l.fill > 0
          ? { fillOpacity: unit(l.fill) }
          : {}),
      };
    }
  }
  return out;
}

/** The theme-shaping fields of every row's levels, as one memo key. */
export function levelsSig(rows: readonly { id: string; levels?: readonly ChartLevel[] }[]): string {
  return rows
    .flatMap((r) =>
      (r.levels ?? []).map(
        (l) =>
          `${r.id}\u0000${l.id}\u0000${l.series}\u0000${l.color}\u0000${l.lineDash ?? ''}\u0000${l.opacity ?? ''}\u0000${l.lineWidth ?? ''}\u0000${l.kind === 'range' ? (l.fill ?? '') : ''}`,
      ),
    )
    .join('|');
}
