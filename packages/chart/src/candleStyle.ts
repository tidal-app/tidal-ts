import type { CandleStyle } from '@pond-ts/charts';

/** A single-colour {@link CandleStyle} for `colorBy='series'` — every candle
 *  draws in one resolved `color` (rising === falling === neutral; only `rising`
 *  is read under `colorBy='series'`). Used in the vol terminal so a price candle
 *  beside colour-coded vol lines takes the series' colour, not market green/red
 *  — the theme's `candle.default` keeps green/red for a standalone price candle. */
export function candleStyleForColor(color: string): CandleStyle {
  const pair = { body: color, wick: color };
  return { rising: pair, falling: pair, neutral: pair, bodyWidth: 0.7, wickWidth: 1 };
}

/** A two-colour {@link CandleStyle} for `colorBy='direction'` with the user's
 *  own rise/fall picks (already **resolved** to concrete colors). `neutral` is
 *  omitted, so a doji falls back to the rising colour. */
export function candleStyleForPair(rise: string, fall: string): CandleStyle {
  return {
    rising: { body: rise, wick: rise },
    falling: { body: fall, wick: fall },
    bodyWidth: 0.7,
    wickWidth: 1,
  };
}
