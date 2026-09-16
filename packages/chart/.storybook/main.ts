import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials'],
  framework: { name: '@storybook/react-vite', options: {} },
  // Docgen disabled: the default `react-docgen` walks the whole module graph and
  // crashes on a `#private` field in pond-ts's runtime (pulled in via
  // @pond-ts/charts). Stories and controls still work; only the auto-extracted
  // prop tables are lost.
  typescript: { reactDocgen: false },
};

export default config;
