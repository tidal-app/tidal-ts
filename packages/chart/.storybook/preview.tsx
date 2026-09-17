import type { CSSProperties } from 'react';
import type { Preview } from '@storybook/react';

/**
 * The workshop has **no theme provider and no stylesheet** — deliberately.
 *
 * A host owns the look; the chart takes a `ChartTheme` object and a
 * `colorScheme` as props. So the toolbar switches a global that each story maps
 * to a literal theme (`.storybook/demoTheme.ts`), which is exactly what a
 * consumer's own code will do. If a story ever needs a provider to render, the
 * library has grown a dependency on its host and that is the bug.
 */

/**
 * The **pane chrome's** tokens — the workshop's own, not the chart's.
 *
 * `paneAtoms.tsx` reads `--pane-*` for every colour it paints, and nothing was
 * defining them: the consumer pane shipped with transparent grounds and
 * inherited ink. They are set here, as inline custom properties on the
 * decorator's element, for the same reason the chart theme is a literal object
 * — no stylesheet, so there is nowhere else they could come from, and a story
 * that rendered without them would be lying about what a host has to supply.
 *
 * They are a SHAPE, not a transcription of anyone's design system: a ground,
 * one step BELOW it for the plot, three lifted steps above it, two rules, four
 * ink tiers, and the ink that sits ON a curve's own colour. `--pane-well` is
 * the odd one: chrome lifts away from the ground and the reading surface sinks
 * away from it, in opposite directions, so the plot is the furthest thing from
 * the controls in both schemes — darker in dark, lighter in light. A real consumer maps its own ladder onto these names, and
 * the chart never sees any of them.
 *
 * `PANE_TOKENS` is the list, exported so `paneTokens.test.ts` can fail when an
 * atom reads a name no scheme defines — the type system cannot, because a style
 * object carrying custom properties has to be cast to `CSSProperties` and the
 * cast takes excess-property checking with it. That cast is why the tokens went
 * undefined unnoticed in the first place.
 */
export const PANE_TOKENS = [
  '--pane-well',
  '--pane-surface',
  '--pane-surface-raised',
  '--pane-surface-hover',
  '--pane-surface-active',
  '--pane-border',
  '--pane-border-strong',
  '--pane-ink-strong',
  '--pane-ink',
  '--pane-ink-muted',
  '--pane-ink-faint',
  '--pane-swatch-ink',
] as const;

export type PaneTokens = Record<(typeof PANE_TOKENS)[number], string>;

export const PANE_DARK: PaneTokens = {
  '--pane-well': '#0d1322',
  '--pane-surface': '#141a2b',
  '--pane-surface-raised': '#1d2438',
  '--pane-surface-hover': '#262e44',
  '--pane-surface-active': '#333c55',
  '--pane-border': '#414b66',
  '--pane-border-strong': '#5a6584',
  '--pane-ink-strong': '#f2f5fc',
  '--pane-ink': '#c4cbdd',
  '--pane-ink-muted': '#a6aec4',
  '--pane-ink-faint': '#868fa6',
  '--pane-swatch-ink': '#141a2b',
};

export const PANE_LIGHT: PaneTokens = {
  // The pane steps OFF pure white so the plot has somewhere brighter to go —
  // the light ladder runs the other way, and a ground already at #fff leaves
  // the reading surface nowhere.
  '--pane-well': '#ffffff',
  '--pane-surface': '#eef1f6',
  '--pane-surface-raised': '#e4e8f0',
  '--pane-surface-hover': '#d8dde8',
  '--pane-surface-active': '#c6cdda',
  '--pane-border': '#b0b8c8',
  '--pane-border-strong': '#858ea3',
  '--pane-ink-strong': '#0f172a',
  '--pane-ink': '#334155',
  '--pane-ink-muted': '#55607a',
  '--pane-ink-faint': '#606b80',
  '--pane-swatch-ink': '#ffffff',
};

const preview: Preview = {
  globalTypes: {
    scheme: {
      description: 'Colour scheme',
      defaultValue: 'dark',
      toolbar: {
        title: 'Scheme',
        icon: 'contrast',
        items: [
          { value: 'dark', title: 'Dark' },
          { value: 'light', title: 'Light' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const dark = context.globals.scheme !== 'light';
      return (
        <div
          style={
            {
              background: dark ? '#0b1020' : '#f7f8fa',
              color: dark ? '#e9edf6' : '#111827',
              padding: 12,
              minHeight: '100vh',
              ...(dark ? PANE_DARK : PANE_LIGHT),
            } as CSSProperties
          }
        >
          <Story />
        </div>
      );
    },
  ],
  parameters: {
    layout: 'fullscreen',
    backgrounds: { disable: true },
    controls: { expanded: true },
  },
};

export default preview;
