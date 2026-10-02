import type { Meta, StoryObj } from '@storybook/react';
import { StudyPage } from '../../.storybook/studies/StudyPage.js';

/** The price transforms studies, one page each — see `.storybook/studies/` for the page
 *  and its prose. Export names are the op in PascalCase (`studyDocs.test.ts`). */
const meta: Meta<typeof StudyPage> = {
  title: 'Studies/Price transforms',
  component: StudyPage,
  parameters: { layout: 'fullscreen' },
  render: (args, { globals }) => (
    <StudyPage key={args.op} op={args.op} scheme={globals.scheme === 'light' ? 'light' : 'dark'} />
  ),
};
export default meta;
type Story = StoryObj<typeof StudyPage>;

export const AveragePrice: Story = { name: 'Average Price (OHLC/4)', args: { op: 'averagePrice' } };
export const MedianPrice: Story = { name: 'Median Price', args: { op: 'medianPrice' } };
export const TypicalPrice: Story = { name: 'Typical Price', args: { op: 'typicalPrice' } };
export const WeightedClose: Story = { name: 'Weighted Close', args: { op: 'weightedClose' } };
