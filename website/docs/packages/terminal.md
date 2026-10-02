---
title: '@tidal-ts/terminal'
description: A state machine that holds a chart's setup (rows, series, studies, axes, presets) and never its data.
---

# @tidal-ts/terminal

For apps where users build their own charts. The terminal package is a state
machine (XState v5) that holds the chart's setup: which rows exist, which series
and studies sit on each, which axis each one uses, and up to five saved presets.
It never fetches, stores or draws data. Peers: React, `xstate` and
`@xstate/react`.

Its output is the `rows` that [`prepareChart`](chart.md) takes, so the machine
and the chart meet at one shape.

## Setting it up

```tsx
<TerminalProvider initialRows={rows} catalog={metrics} storage={presetStorage} palette={colours}>
  <YourChartAndControls />
</TerminalProvider>
```

What the host supplies:

| Prop          | Purpose                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| `initialRows` | The starting layout, as `RowState` rows (an id, a height, configs).              |
| `catalog`     | The metrics a user can add: id, label, colour, unit, source, style, axis.        |
| `storage`     | Where presets live: four functions to load and save presets and the active slot. |
| `palette`     | Colour keys handed to new series, in order.                                      |
| `spreadColor` | A colour reserved for spreads between two series, if you keep one.               |
| `inspect`     | An XState inspector, if you want to watch the machine.                           |

## Reading and changing it

Hooks read state (`useRows`, `useSelectedSeries`, `useAxisRanges`, …) and send
one kind of change each (`useAddSeries`, `useAddStudy`, `useSetStudyParam`,
`useMoveToAxis`, `useSavePreset`, …). Every change goes through the machine's
rules, so a study is only offered on data that has the columns it reads, removing a series
also removes the studies built on it, and an axis move that would mix units is
refused.

The same rules are exported as plain functions (`allowedAxes`, `canAddUnit`,
`studyOfferable`, …) so your menus can grey out what the machine would refuse.
