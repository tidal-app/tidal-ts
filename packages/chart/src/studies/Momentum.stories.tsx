import type { Meta, StoryObj } from '@storybook/react';
import { StudyPage } from '../../.storybook/studies/StudyPage.js';

/** The momentum studies, one page each — see `.storybook/studies/` for the page
 *  and its prose. Export names are the op in PascalCase (`studyDocs.test.ts`). */
const meta: Meta<typeof StudyPage> = {
  title: 'Studies/Momentum',
  component: StudyPage,
  parameters: { layout: 'fullscreen' },
  render: (args, { globals }) => (
    <StudyPage key={args.op} op={args.op} scheme={globals.scheme === 'light' ? 'light' : 'dark'} />
  ),
};
export default meta;
type Story = StoryObj<typeof StudyPage>;

export const AwesomeOscillator: Story = {
  name: 'Awesome Oscillator (AO)',
  args: { op: 'awesomeOscillator' },
};
export const CenterOfGravity: Story = {
  name: 'Center of Gravity (CG)',
  args: { op: 'centerOfGravity' },
};
export const ChandeForecastOscillator: Story = {
  name: 'Chande Forecast Oscillator (CFO)',
  args: { op: 'chandeForecastOscillator' },
};
export const ChandeMomentum: Story = {
  name: 'Chande Momentum Oscillator (CMO)',
  args: { op: 'chandeMomentum' },
};
export const CommodityChannelIndex: Story = {
  name: 'Commodity Channel Index (CCI)',
  args: { op: 'commodityChannelIndex' },
};
export const FisherTransform: Story = { name: 'Fisher Transform', args: { op: 'fisherTransform' } };
export const IntradayMomentumIndex: Story = {
  name: 'Intraday Momentum Index (IMI)',
  args: { op: 'intradayMomentumIndex' },
};
export const Momentum: Story = { name: 'Momentum', args: { op: 'momentum' } };
export const PrettyGoodOscillator: Story = {
  name: 'Pretty Good Oscillator (PGO)',
  args: { op: 'prettyGoodOscillator' },
};
export const PrimeNumberOscillator: Story = {
  name: 'Prime Number Oscillator',
  args: { op: 'primeNumberOscillator' },
};
export const PsychologicalLine: Story = {
  name: 'Psychological Line',
  args: { op: 'psychologicalLine' },
};
export const PercentChange: Story = { name: 'Rate of Change (ROC)', args: { op: 'percentChange' } };
export const Rsi: Story = { name: 'Relative Strength Index (RSI)', args: { op: 'rsi' } };
export const RelativeVigorIndex: Story = {
  name: 'Relative Vigor Index (RVI)',
  args: { op: 'relativeVigorIndex' },
};
export const StochasticMomentumIndex: Story = {
  name: 'Stochastic Momentum Index (SMI)',
  args: { op: 'stochasticMomentumIndex' },
};
export const Stochastic: Story = { name: 'Stochastic Oscillator', args: { op: 'stochastic' } };
export const StochasticRsi: Story = { name: 'Stochastic RSI', args: { op: 'stochasticRsi' } };
export const TrueStrengthIndex: Story = {
  name: 'True Strength Index (TSI)',
  args: { op: 'trueStrengthIndex' },
};
export const UltimateOscillator: Story = {
  name: 'Ultimate Oscillator',
  args: { op: 'ultimateOscillator' },
};
export const WilliamsR: Story = { name: 'Williams %R', args: { op: 'williamsR' } };
