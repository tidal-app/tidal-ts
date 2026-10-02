import type { Meta, StoryObj } from '@storybook/react';
import { StudyPage } from '../../.storybook/studies/StudyPage.js';

/** The statistical studies, one page each — see `.storybook/studies/` for the page
 *  and its prose. Export names are the op in PascalCase (`studyDocs.test.ts`). */
const meta: Meta<typeof StudyPage> = {
  title: 'Studies/Statistical',
  component: StudyPage,
  parameters: { layout: 'fullscreen' },
  render: (args, { globals }) => (
    <StudyPage key={args.op} op={args.op} scheme={globals.scheme === 'light' ? 'light' : 'dark'} />
  ),
};
export default meta;
type Story = StoryObj<typeof StudyPage>;

export const LinearRegression: Story = {
  name: 'Linear Regression',
  args: { op: 'linearRegression' },
};
export const RollingMax: Story = { name: 'Rolling Maximum', args: { op: 'rollingMax' } };
export const RollingMin: Story = { name: 'Rolling Minimum', args: { op: 'rollingMin' } };
export const RollingPercentile: Story = {
  name: 'Rolling Percentile',
  args: { op: 'rollingPercentile' },
};
export const RollingStdev: Story = {
  name: 'Rolling Standard Deviation',
  args: { op: 'rollingStdev' },
};
export const TimeSeriesForecast: Story = {
  name: 'Time Series Forecast (TSF)',
  args: { op: 'timeSeriesForecast' },
};
export const ZScore: Story = { name: 'Z-Score', args: { op: 'zScore' } };
