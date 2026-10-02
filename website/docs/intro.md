---
title: Overview
slug: /
description: What tidal-ts is, what is in each package, and where to start.
---

# tidal-ts

tidal-ts draws financial time series: price bars, volatility curves, and the
technical studies traders lay over them. It is built on
[pond-ts](https://pond-ts.org), and it came out of
[Tidal](https://github.com/tidal-app/tidal), a volatility analytics terminal, so
that other apps can draw the same chart without Tidal's controls or data layer.

**Pre-1.0: pin an exact version.** All three packages ship together on one
version number.

## The packages

| Package                                      | What it gives you                                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [`@tidal-ts/core`](packages/core.md)         | Every study in the catalog, the volatility data layout, bar windows, the wire-format adapter, sessions and time zones. |
| [`@tidal-ts/chart`](packages/chart.md)       | `TimeSeriesChart`, the settings that describe what to draw, and the step that prepares data for it.                    |
| [`@tidal-ts/terminal`](packages/terminal.md) | A state machine that holds a chart's setup (rows, series, studies, axes, saved presets), never its data.               |

The dependency runs one way: `terminal` uses `chart`, `chart` uses `core`.

## How the pieces fit

1. **Your app fetches the data.** tidal-ts never makes a network call. You turn
   your API's response into a pond `TimeSeries` (core has an adapter for a
   column-by-column wire format).
2. **You describe the chart.** Each line, candle series or study is a small
   settings object: which column, which colour, which axis, which row.
3. **The prepare step does the work.** It computes every study, works out the
   axes, and hands back rows the chart can draw.
4. **The chart draws.** Its theme and colours come in as props; it reads no CSS
   and needs no provider, so it fits into any design system.

If you want users to build their own charts (add a study, move a line to
another axis, save a layout), the terminal package holds that state for you.

## Where to go next

- [Getting started](getting-started.mdx): install, then a chart with candles,
  a moving average and an RSI panel.
- [The study catalog](studies.mdx): every study with a live chart, its settings,
  and how traders use it.
- [Storybook](pathname:///storybook/): the chart's workshop, with every story
  the package is tested against.
