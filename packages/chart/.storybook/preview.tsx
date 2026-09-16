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
