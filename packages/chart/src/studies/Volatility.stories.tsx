import type { Meta, StoryObj } from '@storybook/react';
import { StudyPage } from '../../.storybook/studies/StudyPage.js';

/** The volatility studies, one page each — see `.storybook/studies/` for the page
 *  and its prose. Export names are the op in PascalCase (`studyDocs.test.ts`). */
const meta: Meta<typeof StudyPage> = {
  title: 'Studies/Volatility',
  component: StudyPage,
  parameters: { layout: 'fullscreen' },
  render: (args, { globals }) => (
    <StudyPage key={args.op} op={args.op} scheme={globals.scheme === 'light' ? 'light' : 'dark'} />
  ),
};
export default meta;
type Story = StoryObj<typeof StudyPage>;

export const Atr: Story = { name: 'Average True Range (ATR)', args: { op: 'atr' } };
export const ChaikinVolatility: Story = {
  name: 'Chaikin Volatility',
  args: { op: 'chaikinVolatility' },
};
export const ChoppinessIndex: Story = { name: 'Choppiness Index', args: { op: 'choppinessIndex' } };
export const GopalakrishnanRangeIndex: Story = {
  name: 'Gopalakrishnan Range Index (GAPO)',
  args: { op: 'gopalakrishnanRangeIndex' },
};
export const HistoricalVolatility: Story = {
  name: 'Historical Volatility',
  args: { op: 'historicalVolatility' },
};
export const MassIndex: Story = { name: 'Mass Index', args: { op: 'massIndex' } };
export const RealizedVol: Story = { name: 'Realized Volatility', args: { op: 'realizedVol' } };
export const RelativeVolatilityIndex: Story = {
  name: 'Relative Volatility Index (RVI)',
  args: { op: 'relativeVolatilityIndex' },
};
export const UlcerIndex: Story = { name: 'Ulcer Index', args: { op: 'ulcerIndex' } };
