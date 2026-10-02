---
title: '@tidal-ts/chart'
description: TimeSeriesChart, the settings that describe what it draws, and the step that prepares data for it.
---

# @tidal-ts/chart

A multi-row time-series chart built on `@pond-ts/charts`. Rows stack top to
bottom on one shared time axis; each row holds any number of series on a left
and a right axis. Peers: React 18 or 19, `pond-ts`, `@pond-ts/charts`,
`@pond-ts/react` and `@pond-ts/financial`.

The chart reads no CSS, no context provider and no storage. Its theme, colours
and settings all arrive as props, so it takes on whatever design system the
host app uses. [Getting started](../getting-started.mdx) has a complete example.

## Describing a series: `SeriesConfig`

Each line, candle series or study is one config:

| Field           | Meaning                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------- |
| `id`            | Stable identity: hover readouts and `dimmed` refer to it.                                |
| `source`        | Which entry of `sources` to read (`'price'`, `'vol'`, or your own keys).                 |
| `column`        | The column to draw. For a study, `deriveId(spec)`.                                       |
| `derive`        | The study spec, when this config is a study.                                             |
| `style`         | `line`, `area`, `bar`, `candle`, `band` (a shaded channel) or `lines` (several outputs). |
| `axis`          | `'L'` or `'R'`.                                                                          |
| `axisGroup`     | Give a series its own axis on that side instead of the shared one.                       |
| `color`         | A CSS colour, or a key your `resolveColor` understands.                                  |
| `label`, `unit` | What the readout and axis say.                                                           |
| `visible`       | Hide without removing.                                                                   |

Candles also take `colorMode: 'split'` with `riseColor` and `fallColor`.

## Preparing the data: `prepareChart`

```ts
const { rows, sources } = prepareChart({ price: { series } }, [
  { id: 'main', configs: [candles, sma] },
  { id: 'rsi', configs: [rsi] },
]);
```

It computes every study onto its source, leaves out plain series whose column
holds no data, gives each config its latest value (for a legend or readout),
and returns rows and sources ready for the chart. Add a pixel `height` to each
row before drawing. `facts` reports which columns each source ended up
carrying, which is how a host can tell that a study produced no values.

`prepareChart` is three steps in one call: `foldSources` (the expensive one:
computing studies), `sourceFacts` and `assembleRows`. A host that recolours or
reorders often can call them separately and memoise the first.

## Drawing: `TimeSeriesChart`

The props most hosts use:

| Prop                                           | Purpose                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `rows`, `sources`                              | From `prepareChart`, with heights added.                                                                |
| `theme`                                        | A `ChartTheme` from `@pond-ts/charts`: write it out, or build it from CSS variables with `cssVarTheme`. |
| `colorScheme`                                  | `'dark'` or `'light'`: which way a hovered axis brightens.                                              |
| `resolveColor`                                 | Maps palette keys in configs to real colours. Leave it out for CSS colours.                             |
| `ohlcSources`                                  | Sources that carry open/high/low/close, so `candle` can draw.                                           |
| `onTracker`                                    | Hover readout: the time under the cursor and every series' value there.                                 |
| `dimmed`                                       | Series ids to fade, to emphasise the rest.                                                              |
| `viewRange`, `onViewRangeChange`               | Control the visible time window (pan and zoom).                                                         |
| `axisOptions`                                  | Per-axis fixed bounds, decimals, log scale, title and tick count.                                       |
| `annotations`                                  | Date markers, such as earnings or expiries, drawn across every row.                                     |
| `pricePill`                                    | A live last-price tag on the axis; ticks repaint only the tag.                                          |
| `collapseWeekends`, `calendarDays`, `timeZone` | How the time axis treats closed markets and which zone it reads in.                                     |

## Settings

`ChartSettings` (with `DEFAULT_CHART_SETTINGS` and `mergeChartSettings`) holds
app-wide presentation defaults: line weights and dashes per kind of series, and
the default rise and fall colours.
