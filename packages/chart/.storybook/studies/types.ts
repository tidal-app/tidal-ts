/**
 * One study's page in the catalog — the prose a reader needs beside the live
 * chart. Everything MECHANICAL (params, bounds, outputs, guide levels, which
 * bar columns it reads, whether it sits on the price axis) is read off the
 * registry at render time, so it cannot drift from what the engine runs; only
 * what the registry cannot say lives here.
 *
 * Written for someone who trades but has not met this particular study: plain
 * words, no formula without a sentence saying what it means.
 */
export interface StudyDoc {
  /** The study's full name, as a trader would search for it. */
  name: string;
  /** What it measures, in two or three plain sentences. */
  what: string;
  /** How it is used in trading — one entry per distinct use. */
  uses: readonly string[];
  /** What each param controls, keyed by the registry's param name. Every
   *  declared param must be described (the catalog test holds this). */
  params?: Readonly<Record<string, string>>;
  /** What each output is, keyed by the registry's output suffix — required for
   *  a study with more than one output, so a reader can tell the lines apart. */
  outputs?: Readonly<Record<string, string>>;
  /** Anything that differs from the textbook picture: a convention this
   *  implementation follows, or something the chart does not draw yet. */
  note?: string;
  /** Bars of fixture to draw, when the study needs a long warm-up before its
   *  first value (default {@link DEFAULT_BARS}). */
  bars?: number;
}

/** Enough daily bars that the longest common warm-up (about 90 bars) still
 *  leaves most of the chart drawn. */
export const DEFAULT_BARS = 320;
