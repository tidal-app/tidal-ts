/**
 * **Host levels** — horizontal lines a host places on a row, beside the
 * study-catalog guides (`guideLevels`). A level is a value the host already
 * holds, such as the last value of a series or the low and high of a window,
 * drawn across the plot on the axis of a series in that row.
 *
 * Drawn with `@pond-ts/charts`' `<Baseline>` (a level, each edge of a range)
 * and `<Zone>` (a range's wash). Like the guides, they never move an axis:
 * the marks read the axis's scale and do not feed its extent, so a level
 * outside the window is simply off the plot. A level that should be on screen
 * is the host's to frame (`axisOptions`).
 *
 * Library friction, recorded here for upstream (charts' annotation register):
 *
 * 1. **No per-mark ink.** `<Baseline>` / `<Zone>` take colour and dash only from
 *    `theme.annotation.roles[role]` ("colour is a theme concern"). Each level
 *    therefore gets its own role ({@link levelRole}), folded into the theme by
 *    {@link levelRoles} — the same route `ChartAnnotation.color` takes.
 * 2. **No stroke width.** A baseline is always 1px, and a role cannot change
 *    it. So a level takes no `lineWidth` yet; adding one that is silently
 *    ignored would be worse than leaving it out.
 * 3. **An inert mark is always at the back.** `selectable={false}` paints at
 *    the register's `depth[2]` (0.4 in charts' shipped themes), and a role
 *    cannot override depth. A level's `opacity` is folded into its colour, so
 *    the line reads at `opacity × depth[2]`, as the guides and the date
 *    markers do. A host wanting a level at full strength today has to raise
 *    `depth[2]` for every mark. Asked for: a per-role depth, or a per-mark
 *    opacity.
 *
 * @module
 */
import { configAxisId, dashPattern, type SeriesConfig } from './series.js';
import type { LineDash } from './chartSettings.js';
import { withAlpha } from './withAlpha.js';

/** How a level draws. Every field but `color` is optional. */
export interface ChartLevelStyle {
  /** A palette key (resolved by the chart's `resolveColor`) or raw CSS. */
  color: string;
  /** Texture. Omitted ⇒ `solid`, whatever the theme's register dash is. */
  lineDash?: LineDash;
  /** `0..1`, folded into the colour. Composes with the register's resting
   *  depth (see the module note) and with the series' dimming. */
  opacity?: number;
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
export const levelRole = (rowId: string, levelId: string): string => `level:${rowId}:${levelId}`;

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
    const key = `level:${rowId}:${l.id}`;
    if (l.kind === 'level') {
      if (ok(l.value)) lines.push({ key, role, axis, value: l.value, label: l.label || false });
      continue;
    }
    if (ok(l.low))
      lines.push({ key: `${key}:low`, role, axis, value: l.low, label: l.labels?.low || false });
    if (ok(l.high))
      lines.push({ key: `${key}:high`, role, axis, value: l.high, label: l.labels?.high || false });
    if (l.fill !== undefined && l.fill > 0 && ok(l.low) && ok(l.high)) {
      washes.push({ key: `${key}:fill`, role, axis, from: l.low, to: l.high });
    }
  }
  return { lines, washes };
}

/** A role entry, as `theme.annotation.roles` takes it. */
export interface LevelRoleStyle {
  color: string;
  dash: readonly number[];
  fillOpacity?: number;
}

const unit = (o: number | undefined): number =>
  typeof o === 'number' && Number.isFinite(o) ? Math.min(1, Math.max(0, o)) : 1;

/**
 * The theme roles every host level draws in, keyed by {@link levelRole}. Its
 * colour is resolved and carries the level's `opacity` (and the chart's
 * dimming, when the series it rides on is dimmed, at the same `0.22` a series
 * takes). `dash` is always stated, so a `solid` level stays solid on a theme
 * whose register is dashed.
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
          `${r.id}\u0000${l.id}\u0000${l.series}\u0000${l.color}\u0000${l.lineDash ?? ''}\u0000${l.opacity ?? ''}\u0000${l.kind === 'range' ? (l.fill ?? '') : ''}`,
      ),
    )
    .join('|');
}
