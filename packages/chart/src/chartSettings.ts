/**
 * App-wide **chart settings** — the user's default presentation preferences,
 * distinct from per-series overrides (which live on each `SeriesConfig`) and
 * from presets (which capture a terminal's configuration). Settings are the
 * *defaults* a fresh series starts from: what a bar/candle's rise/fall split
 * looks like, and how heavy/dashed each category of line draws.
 *
 * This module is the **vocabulary**: the types, the shipped defaults and the
 * forward-compatible merge — what the chart reads (`<TimeSeriesChart settings>`)
 * and what any host persists. Who OWNS the value is the host's affair: Tidal's
 * `ChartSettingsProvider` (context + localStorage, edited in the settings
 * dialog) lives outside the chart entry, and a library consumer can hold the
 * settings however it likes. Presentational components receive them as
 * **props** (props in, events out).
 */

export type LineDash = 'solid' | 'dashed';

/** One line category's presentation default: stroke style + weight (px). */
export interface CategoryLineStyle {
  dash: LineDash;
  weight: number;
}

/** Default coloring for a direction-capable mark (bar / candle): split rise/fall
 *  (market convention) vs the series' own single color. `rise`/`fall` are color
 *  keys — palette keys, the market `positive`/`negative` tokens, or raw CSS. */
export interface SplitColorDefault {
  split: boolean;
  rise: string;
  fall: string;
}

/** Where a trading-time axis marks its collapse seams (a session/day open). */
export type SessionDividers = 'labeled' | 'all' | 'none';

export interface ChartSettings {
  /**
   * How a session boundary reads on a collapsed axis.
   *
   * `dividers` draws the vertical at each seam — `'labeled'` only where the axis
   * also labels, `'all'` at every seam in view (crowds when zoomed out). We
   * default it ON, against charts' `'none'`, because an intraday price line steps
   * VERTICALLY at a seam: the overnight move has no horizontal room once the gap
   * is collapsed, so without a divider that step reads as a price move inside the
   * session rather than the boundary it is.
   *
   * `breaks` ends the line at the close and restarts it at the open instead of
   * connecting across. It does visible work only where a series has live time it
   * cannot fill: a price line starts at the session's open, so its seam is
   * zero-width and there is nothing to break — a vol line has no open, starts one
   * bar in, and breaks there.
   */
  sessions: { dividers: SessionDividers; breaks: boolean };
  /** Bar-styled series (volume …): split rise/fall by direction, or single. */
  bars: SplitColorDefault;
  /** Area-styled series WITH A BASELINE: split above/below it, or single. An
   *  area without a baseline has nothing to split at and ignores this. */
  areas: SplitColorDefault;
  /** Candle-styled series: split rise/fall by direction, or single. */
  candles: SplitColorDefault;
  /** Raw metric lines (vol curves, price, derived catalog metrics). */
  metrics: CategoryLineStyle;
  /** Windowed studies (SMA / EMA overlays). */
  derived: CategoryLineStyle;
  /** The comparison ticker's counterpart lines. */
  comparisons: CategoryLineStyle;
  /**
   * Per-annotation overrides (earnings, expirations …), keyed by the annotation's
   * catalog id.
   *
   * **Every field is optional and absence means "as shipped"** — the catalog owns
   * each default and this records only what the user changed. That is what keeps a
   * new annotation kind from needing a settings migration: it appears at its own
   * default, and a stored blob written before it existed stays valid.
   *
   * Deliberately an open map rather than a named pair. The other sections here are
   * fixed presentation categories, but *which annotations exist* is the app's
   * catalog to decide, and this package cannot import it (dependency direction).
   * The dialog is handed the options as a prop for the same reason.
   */
  annotations: Record<string, AnnotationOverride>;
}

/** What a user can change about one annotation. Both optional — see
 *  {@link ChartSettings.annotations}. */
export interface AnnotationOverride {
  /** Drawn or not. Absent ⇒ the catalog's `default`. */
  on?: boolean;
  /** Palette key (or raw CSS). Absent ⇒ the catalog's `defaultColor`. */
  color?: string;
}

/** The shipped defaults (settings dialog spec): split green/red marks; solid
 *  1.5 metrics, solid 0.5 studies, dashed 1.0 comparisons. */
export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  bars: { split: true, rise: 'positive', fall: 'negative' },
  candles: { split: true, rise: 'positive', fall: 'negative' },
  areas: { split: true, rise: 'positive', fall: 'negative' },
  metrics: { dash: 'solid', weight: 1.5 },
  derived: { dash: 'solid', weight: 0.5 },
  comparisons: { dash: 'dashed', weight: 1 },
  sessions: { dividers: 'labeled', breaks: true },
  // Empty on purpose — every annotation starts at its catalog default until the
  // user says otherwise. See `ChartSettings.annotations`.
  annotations: {},
};

/** Merge a stored (possibly partial / stale-shaped) value over the defaults —
 *  section by section, so a settings shape that grows stays forward-compatible
 *  with older persisted blobs. Unknown sections/fields are dropped. */
export function mergeChartSettings(stored: unknown): ChartSettings {
  const d = DEFAULT_CHART_SETTINGS;
  if (typeof stored !== 'object' || stored === null) return d;
  const s = stored as Partial<Record<keyof ChartSettings, unknown>>;
  const split = (v: unknown, base: SplitColorDefault): SplitColorDefault => {
    const o = (typeof v === 'object' && v !== null ? v : {}) as Partial<SplitColorDefault>;
    return {
      split: typeof o.split === 'boolean' ? o.split : base.split,
      rise: typeof o.rise === 'string' ? o.rise : base.rise,
      fall: typeof o.fall === 'string' ? o.fall : base.fall,
    };
  };
  const lineStyle = (v: unknown, base: CategoryLineStyle): CategoryLineStyle => {
    const o = (typeof v === 'object' && v !== null ? v : {}) as Partial<CategoryLineStyle>;
    // Weight must be a sane stroke (a stored 0/negative would draw nothing and
    // read as a data bug) — out-of-range falls back to the default.
    const w = o.weight;
    return {
      dash: o.dash === 'solid' || o.dash === 'dashed' ? o.dash : base.dash,
      weight: typeof w === 'number' && Number.isFinite(w) && w > 0 && w <= 8 ? w : base.weight,
    };
  };
  const sessions = (v: unknown, base: ChartSettings['sessions']): ChartSettings['sessions'] => {
    const o = (typeof v === 'object' && v !== null ? v : {}) as Partial<ChartSettings['sessions']>;
    return {
      dividers:
        o.dividers === 'labeled' || o.dividers === 'all' || o.dividers === 'none'
          ? o.dividers
          : base.dividers,
      breaks: typeof o.breaks === 'boolean' ? o.breaks : base.breaks,
    };
  };
  // The keys are the app's, so this cannot validate them against a list — but it
  // can validate the VALUES, and must: consumers resolve with
  // `override?.on ?? entry.default`, so a stored `"false"` would bypass the
  // default and then read as truthy.
  //
  // A **bare boolean is accepted** and read as `{ on }`. That was the shape this
  // section shipped with before colours existed, so a dev's stored blob (or an
  // early user's) still carries it; migrating on read costs two lines and means
  // nobody's toggle silently resets.
  const annotations = (v: unknown): Record<string, AnnotationOverride> => {
    if (typeof v !== 'object' || v === null) return {};
    const out: Record<string, AnnotationOverride> = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'boolean') {
        out[k] = { on: val };
        continue;
      }
      if (typeof val !== 'object' || val === null) continue;
      const o = val as Partial<AnnotationOverride>;
      const entry: AnnotationOverride = {};
      if (typeof o.on === 'boolean') entry.on = o.on;
      // A colour is a palette key or raw CSS — both are strings here, and the
      // renderer resolves either. Empty string is not a colour.
      if (typeof o.color === 'string' && o.color !== '') entry.color = o.color;
      // Drop an entry that overrides nothing, so `{}` does not accumulate.
      if (entry.on !== undefined || entry.color !== undefined) out[k] = entry;
    }
    return out;
  };
  return {
    bars: split(s.bars, d.bars),
    areas: split(s.areas, d.areas),
    candles: split(s.candles, d.candles),
    metrics: lineStyle(s.metrics, d.metrics),
    derived: lineStyle(s.derived, d.derived),
    comparisons: lineStyle(s.comparisons, d.comparisons),
    sessions: sessions(s.sessions, d.sessions),
    annotations: annotations(s.annotations),
  };
}
