import type { Meta, StoryObj } from '@storybook/react';
import { StudyPage } from '../../.storybook/studies/StudyPage.js';

/** The moving-average oscillators studies, one page each — see `.storybook/studies/` for the page
 *  and its prose. Export names are the op in PascalCase (`studyDocs.test.ts`). */
const meta: Meta<typeof StudyPage> = {
  title: 'Studies/Moving-average oscillators',
  component: StudyPage,
  parameters: { layout: 'fullscreen' },
  render: (args, { globals }) => (
    <StudyPage key={args.op} op={args.op} scheme={globals.scheme === 'light' ? 'light' : 'dark'} />
  ),
};
export default meta;
type Story = StoryObj<typeof StudyPage>;

export const Coppock: Story = { name: 'Coppock Curve', args: { op: 'coppock' } };
export const Kst: Story = { name: 'Know Sure Thing (KST)', args: { op: 'kst' } };
export const Macd: Story = {
  name: 'MACD (Moving Average Convergence Divergence)',
  args: { op: 'macd' },
};
export const PriceMomentumOscillator: Story = {
  name: 'Price Momentum Oscillator (PMO)',
  args: { op: 'priceMomentumOscillator' },
};
export const SpecialK: Story = { name: 'Pring’s Special K', args: { op: 'specialK' } };
export const SchaffTrendCycle: Story = {
  name: 'Schaff Trend Cycle (STC)',
  args: { op: 'schaffTrendCycle' },
};
export const Trix: Story = { name: 'TRIX', args: { op: 'trix' } };
