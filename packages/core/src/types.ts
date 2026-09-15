/**
 * Tidal domain vocabulary — the financial-instrument types every other layer
 * speaks. Pure: no React, no platform deps, no pond import. (The pond
 * `TimeSeries` is the *carrier* for price data; see `fixture.ts` / the data
 * layer. These types describe *what* a series is of.)
 */

/** The asset class an instrument belongs to. Drives display + later, which
 *  data endpoint serves it. */
export type InstrumentKind = 'equity' | 'crypto' | 'fx' | 'index';

/** A tradeable thing Tidal can chart. `symbol` is the stable identity
 *  (e.g. `AAPL`, `BTC-USD`); `name` is display-only. */
export interface Instrument {
  symbol: string;
  name: string;
  kind: InstrumentKind;
}

/** A bar interval (the spacing between samples). Display + generation use it;
 *  the value is the bar duration in milliseconds. */
export type BarInterval = '1m' | '5m' | '1h' | '1d';

export const BAR_INTERVAL_MS: Record<BarInterval, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '1h': 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};
