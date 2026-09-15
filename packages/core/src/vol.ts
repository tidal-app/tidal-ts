import { TimeSeries } from 'pond-ts';
import { BAR_INTERVAL_MS, type BarInterval } from './types.js';

/**
 * The **volatility** series schema + deterministic fixtures — the vol terminal's
 * data shape.
 *
 * A vol series is `time`-keyed with two ATM columns per standard tenor —
 * `iv{tenor}` (implied) and `hv{tenor}` (the producer's second ATM family; see
 * {@link impliedCol} for why it is not named for a meaning) — the term
 * structure. A "metric" is a column and a tenor is just another column, so
 * several tenors plot as independent series (compare tenors / read the curve); a
 * series id doubles as its column name (instance identity — `iv63` is ATM
 * implied at 63 days). All values are percent. Extraction-ready for
 * `@pond-ts/finance`.
 *
 * GARCH / skew are intentionally absent: the daily feed has no source, and a
 * placeholder column reads as a dead chip. They return as computed columns via
 * the indicator/derive seam (PLAN item 4).
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function symbolSeed(symbol: string, salt: string): number {
  let h = 2166136261;
  for (const ch of `${symbol}:${salt}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const REFERENCE_EPOCH_MS = 1_704_067_200_000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** The standard ATM tenor set (calendar days) — the daily feed's per-tenor
 *  columns. Ascending; `21` (~1 month) is the default. */
export const VOL_TENORS = [5, 21, 42, 63, 84, 105, 126, 189, 252, 378, 504] as const;
export type VolTenor = (typeof VOL_TENORS)[number];

/** The tenor a fresh ATM-vol series shows until another is picked (~1 month). */
export const DEFAULT_VOL_TENOR = 21;

/**
 * Column ids for the feed's two ATM vol families at a tenor. The id doubles as
 * the chart series id (instance identity), so these must be stable +
 * collision-free.
 *
 * **Both are ATM implied vol.** They are the producer's `atmCenI_{t}d` and
 * `atmCenH_{t}d`, and the `I`/`H` names which **expected-earnings-move estimate
 * was censored out** of the curve — `iEMove` (a fit) versus `hEMove` (a sample of
 * past moves) — not implied versus historical. `docs/datasources.md` carries the
 * four lines of evidence: a shared `_st`/`_lt`/`_decay` curve parameterisation,
 * the pairing with the two EMove column families, realized vol living in its own
 * dataset (`HistoricalVolatilitiesHist`, keyed by `windowType`), and the two
 * columns coinciding exactly wherever `nEarnCnt` is 0.
 *
 * That matters here because `hvCol` was `historicalCol` and surfaced as
 * **"Realized Vol"** until 2026-08-24 — so the default chart drew two implied
 * curves and named one of them realized. A fifth line of evidence, measured over
 * 36,003 rows of a daily history table while fixing the label:
 *
 * | check                                       | result            |
 * | ------------------------------------------- | ----------------- |
 * | `hv21` bit-identical to `iv21`              | **63.4%** of rows |
 * | `corr(hv21, iv21)`                          | 0.9748            |
 * | `corr(hv21, realized)` vs `corr(iv21, …)`   | 0.8196 vs 0.8391  |
 * | …on the 13,178 rows where `hv21 != iv21`    | 0.8147 vs 0.8617  |
 *
 * The last row is the one that closes the question. It rules out the charitable
 * reading — a genuine historical fit that falls back to implied when unavailable
 * — because on exactly the rows where such a fit would reveal itself, `hv` tracks
 * realized vol *worse* than implied does. There is no realized signal hiding
 * under the duplication. (Realized is `√(mean(ccVar, 21)·252)`; correlation is
 * scale-invariant, so that estimator's own calibration does not affect the
 * comparison.)
 *
 * Names, therefore: `iv` keeps its meaning, and `hv` is a neutral abbreviation of
 * the producer's field rather than a claim about it — `@tidal/core` does not adopt
 * `atmCenH` itself, which is a vendor field, and this package is
 * extraction-bound. The user-facing label is `ATM Vol (h-censored)`.
 */
export const impliedCol = (tenor: number): string => `iv${tenor}`;

/**
 * `hv{t}` — the producer's `atmCenH_{t}d`, and **not historical or realized vol**
 * despite the letter.
 *
 * It is ATM *implied* vol under the other earnings-censoring basis; see
 * {@link impliedCol} for the full evidence and measurements. Named for the column
 * rather than for a meaning precisely because the meaning was guessed wrong once:
 * this was `historicalCol` and surfaced as "Realized Vol" until 2026-08-24, and an
 * identifier that asserts a quantity leaves the bug in the code after it is fixed
 * on screen.
 *
 * Carries its own comment rather than deferring entirely to `impliedCol`, because
 * hovering `hvCol` in an editor is exactly when a reader needs to be told this.
 */
export const hvCol = (tenor: number): string => `hv${tenor}`;

/**
 * **Realized** vol at a tenor — `rv{t}` / `rvCen{t}`, from the producer's own
 * `HistoricalVolatilitiesHist`, and the first realized series on this feed that is
 * not derived client-side.
 *
 * These are trailing windows, already annualized and rooted at the source. That
 * detail is load-bearing: the terminal's existing `√(ccVar·252)` is the SAME
 * quantity at window length one (the source's per-day column literally is our
 * `ccVar`), and it cannot be turned into these by smoothing it here. `√` is
 * concave, so averaging the already-rooted series lands ~19% low — the variance has
 * to be averaged first.
 *
 * `rvCen` is earnings-censored on the same convention as {@link hvCol}, which is
 * what finally makes realized-versus-implied a *same-basis* comparison: `rvCen{t}`
 * against `hv{t}`, rather than one censored series against one uncensored one.
 *
 * Null before 2017-11-30 — the source does not reach further back, where the ATM
 * columns start in 2012.
 */
export const rvCol = (tenor: number): string => `rvcc${tenor}`;
export const rvCenCol = (tenor: number): string => `rvccen${tenor}`;

/**
 * ATM vol **slope** at a tenor — the daily skew measure, from
 * `SurfaceFixedTermHist`.
 *
 * It is `atmVol × (skewU1 − skewD1)`: the fitted curve one grid step above ATM
 * minus one step below, in **absolute vol points**, not a ratio.
 *
 * **Negative is normal equity skew** — downside vol above upside — and more
 * negative is a steeper crash premium. Worth stating because the sign is the whole
 * signal and getting it backwards would be worse than not having it: verified
 * against 34,159 expiries, and corroborated on the loaded data three ways (SPY is
 * steeper than every single name; 252d is ~1.5× the 21d; SPY's 2020 median is
 * nearly 3× calm 2024).
 *
 * Carries its own unit rather than sharing the vol `%` axis. It is a *difference*
 * of two vols, an order of magnitude smaller and signed, so putting it on the ATM
 * axis would flatten both curves into a line.
 */
export const skewCol = (tenor: number): string => `skew${tenor}`;

/** Columns of a vol series — `time`, the two ATM term structures (`iv{t}` +
 *  `hv{t}`, percent — see {@link impliedCol} for what each one is and is not),
 *  plus the daily variance + expected-move scalars from `TickerHistoryDaily`:
 *  `ccVar`/`hlVar` (close-close / high-low variance, raw decimals) and
 *  `hEMove`/`iEMove` (historical / implied expected move, percent). Built from
 *  {@link VOL_TENORS} so the term structure is the schema, not a fixed handful
 *  of series. */
export const VOL_SCHEMA = [
  { name: 'time', kind: 'time' },
  ...VOL_TENORS.flatMap((t) => [
    { name: impliedCol(t), kind: 'number' as const },
    { name: hvCol(t), kind: 'number' as const },
    { name: rvCol(t), kind: 'number' as const },
    { name: rvCenCol(t), kind: 'number' as const },
    { name: skewCol(t), kind: 'number' as const },
  ]),
  { name: 'ccVar', kind: 'number' as const },
  { name: 'hlVar', kind: 'number' as const },
  { name: 'hEMove', kind: 'number' as const },
  { name: 'iEMove', kind: 'number' as const },
] as const satisfies readonly { name: string; kind: string }[];

export type VolSeries = TimeSeries<typeof VOL_SCHEMA>;

/** A vol series' columns keyed by name — `time` plus every `iv{t}`/`hv{t}`. A
 *  non-finite cell is a gap (columnar ingress tolerates it). */
export type VolColumns = Readonly<Record<string, readonly number[]>>;

/** Build a {@link VolSeries} from its columns (ascending in time) — the one place
 *  the vol `TimeSeries` is constructed, shared by the fixture and the real
 *  ticker-history adapter. Columnar (not row) ingress so a non-finite cell reads
 *  as a gap rather than being rejected. */
export function buildVolSeries(name: string, columns: VolColumns): VolSeries {
  return TimeSeries.fromColumns({
    name,
    schema: VOL_SCHEMA,
    columns: columns as Record<string, readonly number[]>,
    sort: true,
  }) as VolSeries;
}

export interface VolSeriesOptions {
  bars?: number;
  interval?: BarInterval;
  endMs?: number;
  seed?: number;
}

/**
 * Generate a deterministic vol **term structure** for a symbol: a base level
 * that drifts + spikes, with each tenor an `hv`/`iv` pair around it — longer
 * tenors sit a touch higher and feel a stress spike less (a plausible
 * upward-sloping curve). Seeded by symbol so a ticker's surface is stable across
 * stories/tests/dev.
 *
 * **Known fidelity gap.** This models `hv` as a noisy leader and `iv` as its
 * smoothed tracker, which is what the columns were believed to be. Production is
 * not like that: `hv21` is bit-identical to `iv21` on 63.4% of rows and
 * correlates at 0.97 (see {@link impliedCol}). So mock shows two visibly
 * distinct lines where real data shows one line most of the time. Harmless for
 * layout, axis and interaction work — which is what fixtures are for here — but
 * do not read a *relationship* between these two series off mock data.
 */
export function generateVolSeries(symbol: string, options: VolSeriesOptions = {}): VolSeries {
  const { bars = 180, interval = '1d', endMs = REFERENCE_EPOCH_MS, seed } = options;
  const rng = mulberry32(seed ?? symbolSeed(symbol, 'vol'));
  const stepMs = BAR_INTERVAL_MS[interval];
  const spikeAt = Math.floor(bars * 0.68);

  const time: number[] = [];
  const cols: Record<string, number[]> = { ccVar: [], hlVar: [], hEMove: [], iEMove: [] };
  for (const t of VOL_TENORS) {
    cols[impliedCol(t)] = [];
    cols[hvCol(t)] = [];
    cols[rvCol(t)] = [];
    cols[rvCenCol(t)] = [];
    cols[skewCol(t)] = [];
  }
  // Per-tenor smoothed `iv` (tracks its `hv`, a touch slower).
  const atm: Record<number, number> = {};
  let level = 19 + rng() * 3; // ~19–22%
  for (const t of VOL_TENORS) atm[t] = level;

  for (let i = 0; i < bars; i++) {
    time.push(endMs - (bars - 1 - i) * stepMs);
    // base level mean-reverts to ~20; a transient spike decays after `spikeAt`
    level += (20 - level) * 0.03 + (rng() - 0.5) * 1.2;
    const spike = i >= spikeAt ? 26 * Math.exp(-(i - spikeAt) / 14) : 0;
    for (const t of VOL_TENORS) {
      // Term structure: longer tenors sit higher + flatter, and damp the spike.
      const lift = Math.log(t / 21) * 1.1; // ~0 at 21d, positive for longer
      const damp = 0.45 + 21 / (21 + t); // 1.0 at 5d → ~0.5 at 504d
      const hv = Math.max(6, level + lift + spike * damp + (rng() - 0.5) * 3);
      const iv = (atm[t] ?? level) + (hv - (atm[t] ?? level)) * 0.45; // iv tracks hv, smoother
      atm[t] = iv;
      cols[hvCol(t)]!.push(round2(hv));
      cols[impliedCol(t)]!.push(round2(iv));

      // Realized sits NEAR implied but wanders independently — a vol-risk-premium
      // sign that flips, which is the real relationship. The censored twin runs a
      // touch lower, since removing the earnings jump can only reduce the measure.
      const rv = Math.max(4, iv + (rng() - 0.45) * 6);
      cols[rvCol(t)]!.push(round2(rv));
      cols[rvCenCol(t)]!.push(round2(Math.max(3, rv - 0.4 - rng() * 1.6)));

      // NEGATIVE — normal equity skew, downside vol above upside — and steeper at
      // longer tenors, matching the measured ~1.5× from 21d to 252d. The fixture
      // reproduces the SIGN and the term shape deliberately: those are the two
      // things a reader would take away from a mock chart, and a fixture that got
      // either backwards would teach the opposite of the data.
      const steepen = 0.6 + Math.log(t / 5) * 0.35;
      cols[skewCol(t)]!.push(round2(-(1.2 * steepen + rng() * 0.5)));
    }
    // Variance + expected-move scalars, tracking the same level (mock analogues of
    // the daily feed's columns). Variance is a raw decimal — a daily close-close
    // variance ~ (σ/√252)²; expected move ~ a 21-day move, in percent.
    const sigma = level / 100;
    const dailyVar = (sigma * sigma) / 252;
    cols.ccVar!.push(round6(dailyVar));
    cols.hlVar!.push(round6(dailyVar * 1.5)); // high-low runs a touch wider
    const emove = level * Math.sqrt(21 / 252); // ~monthly move, percent
    cols.hEMove!.push(round2(emove));
    cols.iEMove!.push(round2(emove * 1.08)); // implied a touch richer
  }

  return buildVolSeries(`${symbol}:vol`, { time, ...cols });
}
