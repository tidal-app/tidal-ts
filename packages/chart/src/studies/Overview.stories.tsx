import type { Meta, StoryObj } from '@storybook/react';
import { StudyOverview } from '../../.storybook/studies/Overview.js';

/** The study catalog's front page: every study, grouped as the menu groups
 *  them, linking to one page each. */
const meta: Meta<typeof StudyOverview> = {
  title: 'Studies/Overview',
  component: StudyOverview,
  parameters: { layout: 'fullscreen' },
};
export default meta;

export const Overview: StoryObj<typeof StudyOverview> = {};
