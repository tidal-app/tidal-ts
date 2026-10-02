import type { Meta, StoryObj } from '@storybook/react';
import { StudyPage } from '../../.storybook/studies/StudyPage.js';

/** The volume studies, one page each — see `.storybook/studies/` for the page
 *  and its prose. Export names are the op in PascalCase (`studyDocs.test.ts`). */
const meta: Meta<typeof StudyPage> = {
  title: 'Studies/Volume',
  component: StudyPage,
  parameters: { layout: 'fullscreen' },
  render: (args, { globals }) => (
    <StudyPage key={args.op} op={args.op} scheme={globals.scheme === 'light' ? 'light' : 'dark'} />
  ),
};
export default meta;
type Story = StoryObj<typeof StudyPage>;

export const AccumulationDistribution: Story = {
  name: 'Accumulation / Distribution Line (A/D)',
  args: { op: 'accumulationDistribution' },
};
export const ChaikinMoneyFlow: Story = {
  name: 'Chaikin Money Flow (CMF)',
  args: { op: 'chaikinMoneyFlow' },
};
export const ChaikinOscillator: Story = {
  name: 'Chaikin Oscillator',
  args: { op: 'chaikinOscillator' },
};
export const ForceIndex: Story = { name: 'Force Index', args: { op: 'forceIndex' } };
export const Klinger: Story = { name: 'Klinger Volume Oscillator', args: { op: 'klinger' } };
export const MarketFacilitationIndex: Story = {
  name: 'Market Facilitation Index (BW MFI)',
  args: { op: 'marketFacilitationIndex' },
};
export const MoneyFlowIndex: Story = {
  name: 'Money Flow Index (MFI)',
  args: { op: 'moneyFlowIndex' },
};
export const NegativeVolumeIndex: Story = {
  name: 'Negative Volume Index (NVI)',
  args: { op: 'negativeVolumeIndex' },
};
export const Obv: Story = { name: 'On-Balance Volume (OBV)', args: { op: 'obv' } };
export const PositiveVolumeIndex: Story = {
  name: 'Positive Volume Index (PVI)',
  args: { op: 'positiveVolumeIndex' },
};
export const PriceVolumeTrend: Story = {
  name: 'Price Volume Trend (PVT)',
  args: { op: 'priceVolumeTrend' },
};
export const Vwap: Story = { name: 'Rolling VWAP', args: { op: 'vwap' } };
export const ShinoharaIntensityRatio: Story = {
  name: 'Shinohara Intensity Ratio',
  args: { op: 'shinoharaIntensityRatio' },
};
export const TradeVolumeIndex: Story = {
  name: 'Trade Volume Index (TVI)',
  args: { op: 'tradeVolumeIndex' },
};
export const TwiggsMoneyFlow: Story = {
  name: 'Twiggs Money Flow',
  args: { op: 'twiggsMoneyFlow' },
};
