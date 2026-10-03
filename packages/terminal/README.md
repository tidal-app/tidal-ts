# @tidal-ts/terminal

A state machine (XState v5) for apps where users build their own charts. It
holds a chart's setup (rows, series, studies, axes and up to five saved
presets) and never its data: no fetching, no storage of its own, no drawing.
Its rows are what [`@tidal-ts/chart`](https://www.npmjs.com/package/@tidal-ts/chart)'s
`prepareChart` takes. Part of [tidal-ts](https://github.com/tidal-app/tidal-ts).

**Pre-1.0: pin an exact version.** Every `@tidal-ts/*` package ships on one
version number.

- [Docs](https://tidal-app.github.io/tidal-ts/docs/packages/terminal/)

## Install

```bash
npm install --save-exact @tidal-ts/terminal @tidal-ts/chart @tidal-ts/core
npm install xstate @xstate/react
```

Plus the pond peers `@tidal-ts/chart` needs (see its README).

## The shape

```tsx
import { TerminalProvider, useRows, useAddStudy } from '@tidal-ts/terminal';

<TerminalProvider initialRows={rows} catalog={metrics} storage={presetStorage} palette={colours}>
  <YourChartAndControls />
</TerminalProvider>;
```

The host supplies the starting rows, the metrics a user may add, where presets
are saved, and the colours new series take. Hooks read state (`useRows`,
`useAxisRanges`, …) and send one kind of change each (`useAddStudy`,
`useMoveToAxis`, `useSavePreset`, …). The machine's rules are exported as
plain functions (`allowedAxes`, `studyOfferable`, …) so your menus can grey
out what it would refuse.

MIT.
