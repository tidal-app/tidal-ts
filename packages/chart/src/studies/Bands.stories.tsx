import type { Meta, StoryObj } from '@storybook/react';
import { StudyPage } from '../../.storybook/studies/StudyPage.js';

/** The bands and channels studies, one page each — see `.storybook/studies/` for the page
 *  and its prose. Export names are the op in PascalCase (`studyDocs.test.ts`). */
const meta: Meta<typeof StudyPage> = {
  title: 'Studies/Bands and channels',
  component: StudyPage,
  parameters: { layout: 'fullscreen' },
  render: (args, { globals }) => (
    <StudyPage key={args.op} op={args.op} scheme={globals.scheme === 'light' ? 'light' : 'dark'} />
  ),
};
export default meta;
type Story = StoryObj<typeof StudyPage>;

export const AtrBands: Story = { name: 'ATR Bands', args: { op: 'atrBands' } };
export const BollingerPercentB: Story = { name: 'Bollinger %B', args: { op: 'bollingerPercentB' } };
export const BollingerBandwidth: Story = {
  name: 'Bollinger BandWidth',
  args: { op: 'bollingerBandwidth' },
};
export const Donchian: Story = { name: 'Donchian Channel', args: { op: 'donchian' } };
export const PrimeNumberBands: Story = {
  name: 'Prime Number Bands',
  args: { op: 'primeNumberBands' },
};
