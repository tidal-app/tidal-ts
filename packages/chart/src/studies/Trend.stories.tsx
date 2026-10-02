import type { Meta, StoryObj } from '@storybook/react';
import { StudyPage } from '../../.storybook/studies/StudyPage.js';

/** The trend studies, one page each — see `.storybook/studies/` for the page
 *  and its prose. Export names are the op in PascalCase (`studyDocs.test.ts`). */
const meta: Meta<typeof StudyPage> = {
  title: 'Studies/Trend',
  component: StudyPage,
  parameters: { layout: 'fullscreen' },
  render: (args, { globals }) => (
    <StudyPage key={args.op} op={args.op} scheme={globals.scheme === 'light' ? 'light' : 'dark'} />
  ),
};
export default meta;
type Story = StoryObj<typeof StudyPage>;

export const AccumulativeSwingIndex: Story = {
  name: 'Accumulative Swing Index (ASI)',
  args: { op: 'accumulativeSwingIndex' },
};
export const Aroon: Story = { name: 'Aroon', args: { op: 'aroon' } };
export const Bollinger: Story = { name: 'Bollinger Bands', args: { op: 'bollinger' } };
export const DirectionalMovement: Story = {
  name: 'Directional Movement Index (DMI / ADX)',
  args: { op: 'directionalMovement' },
};
export const ElderRay: Story = {
  name: 'Elder Ray (Bull and Bear Power)',
  args: { op: 'elderRay' },
};
export const Ema: Story = { name: 'Exponential Moving Average (EMA)', args: { op: 'ema' } };
export const Ichimoku: Story = {
  name: 'Ichimoku Cloud (Ichimoku Kinko Hyo)',
  args: { op: 'ichimoku' },
};
export const RandomWalkIndex: Story = {
  name: 'Random Walk Index (RWI)',
  args: { op: 'randomWalkIndex' },
};
export const Ravi: Story = { name: 'Range Action Verification Index (RAVI)', args: { op: 'ravi' } };
export const Sma: Story = { name: 'Simple Moving Average (SMA)', args: { op: 'sma' } };
export const SwingIndex: Story = { name: 'Swing Index', args: { op: 'swingIndex' } };
export const TrendIntensityIndex: Story = {
  name: 'Trend Intensity Index (TII)',
  args: { op: 'trendIntensityIndex' },
};
export const VerticalHorizontalFilter: Story = {
  name: 'Vertical Horizontal Filter (VHF)',
  args: { op: 'verticalHorizontalFilter' },
};
export const Vortex: Story = { name: 'Vortex Indicator', args: { op: 'vortex' } };
