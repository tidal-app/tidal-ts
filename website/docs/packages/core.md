---
title: '@tidal-ts/core'
description: Studies, the volatility data layout, bar windows, the wire-format adapter, sessions and time zones.
---

# @tidal-ts/core

The part of tidal-ts with no drawing in it: what a study is, how data arrives,
and how time is cut into bars and sessions. Peers: `pond-ts`,
`@pond-ts/financial` and `@pond-ts/process` (pinned exactly).

## Studies

A study is described by a plain object, a `DeriveSpec`:

```ts
const macd: DeriveSpec = {
  op: 'macd',
  inputs: ['close'],
  params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
};
```

The same spec always produces the same column name (`deriveId`), so a study can
be saved, shared and recomputed without ambiguity.

The studies come from `@pond-ts/financial` and run through `@pond-ts/process`.
The [study catalog](../studies.mdx) shows every one with a live chart. To read
the list in code:

| Function                      | Answers                                                                    |
| ----------------------------- | -------------------------------------------------------------------------- |
| `studyCatalog()`              | Every study on offer: its op, display label, one-line summary and family.  |
| `opParams(op)`                | Its settings, with defaults and allowed ranges.                            |
| `opOutputs(op)`               | The lines it produces (one, or several such as `Upper` / `Lower`).         |
| `opNeedsColumns(op)`          | Which bar columns it reads (empty for a study of one column, such as RSI). |
| `opSharesSourceAxis(op)`      | Whether it is drawn over price, or in a panel of its own.                  |
| `studyLevels(op)`             | The guide lines it declares, such as 30 and 70 for RSI.                    |
| `isValidSpec(spec)`           | Whether a spec's settings are legal before you draw it.                    |
| `applyDerived(series, specs)` | Compute studies onto a series yourself, without the chart.                 |

## Data in

- `snapshotToTimeSeries(snapshot)` turns a column-by-column payload (a name, a
  row count, a schema and one array per column) into a pond `TimeSeries`, and
  `appendToRows` turns a later update in the same layout into rows to append.
- `buildPriceSeries(name, rows)` builds an open/high/low/close/volume series from
  plain rows.
- `generatePriceSeries` and `generateVolSeries` make seeded practice data for
  tests, stories and these docs.

## Volatility

`VOL_SCHEMA` is the layout for a volatility history. Per tenor it holds two
at-the-money implied vol curves (`iv` and `hv`, which treat earnings days
differently; despite the letter, `hv` is implied, not historical), realized
vol, and skew. `impliedCol`, `hvCol`, `rvCol`, `rvCenCol` and `skewCol` name a
column for a tenor, so code never spells column names by hand.

## Bars, sessions and time zones

- `ohlcWindow` rolls bars up into coarser ones (minutes into hours, days into
  weeks), and `autoBarWindow` picks the finest bar size that still leaves each
  candle at least a few pixels wide, so up and down colours stay honest when
  zoomed far out.
- `sessionSegments` and `exactSessionSegments` find the trading sessions in the
  data, so the time axis can skip nights and weekends instead of drawing them as
  empty space. `sessionOpenLine` starts each session's price line at its open.
- `DATA_TIME_ZONE`, `TIME_ZONE_CHOICES` and `resolveTimeZone` keep the zone the
  data is stored in separate from the zone the axis is read in.
- `holdAcrossGrid(series, grid, grainMs)` puts a coarse series on a finer
  grid: a daily curve across one-minute bars. Each row holds from its key for
  `grainMs`, or until the next row starts. A grid point never reads a bar that
  starts after it, and a day with no row stays a gap. Every column comes
  through, as optional. Hold **after** computing studies, not before: a 20-bar
  average of a held daily series is a 20-minute window. The chart's prepare
  step does this for you with `hold` (see the chart page).
