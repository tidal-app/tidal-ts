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
 * They are a SHAPE, not a transcription of anyone's design system: a ground and
 * three lifted steps, two rules, four ink tiers, one caution. A real consumer
 * maps its own ladder onto these names, and the chart never sees any of them.
 */
const PANE_DARK: CSSProperties = {
  '--pane-surface': '#141a2b',
  '--pane-surface-raised': '#1d2438',
  '--pane-surface-hover': '#262e44',
  '--pane-surface-active': '#333c55',
  '--pane-border': '#333c55',
  '--pane-border-strong': '#4b5570',
  '--pane-ink-strong': '#f2f5fc',
  '--pane-ink': '#c4cbdd',
  '--pane-ink-muted': '#a6aec4',
  '--pane-ink-faint': '#868fa6',
  '--pane-caution': '#f0cb62',
} as CSSProperties;

const PANE_LIGHT: CSSProperties = {
  '--pane-surface': '#ffffff',
  '--pane-surface-raised': '#f1f3f7',
  '--pane-surface-hover': '#e7eaf1',
  '--pane-surface-active': '#d7dce7',
  '--pane-border': '#d7dce7',
  '--pane-border-strong': '#a8b0c2',
  '--pane-ink-strong': '#0f172a',
  '--pane-ink': '#334155',
  '--pane-ink-muted': '#55607a',
  '--pane-ink-faint': '#6b7280',
  '--pane-caution': '#8a6100',
} as CSSProperties;

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
          style={{
            background: dark ? '#0b1020' : '#f7f8fa',
            color: dark ? '#e9edf6' : '#111827',
            padding: 12,
            minHeight: '100vh',
            ...(dark ? PANE_DARK : PANE_LIGHT),
          }}
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
