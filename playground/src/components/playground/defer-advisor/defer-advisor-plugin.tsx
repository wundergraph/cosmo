import type { GraphiQLPlugin } from '@graphiql/react';
import { TbHourglass } from 'react-icons/tb';
import { DeferAdvisorPluginContent } from './defer-advisor-plugin-content';

export const createDeferAdvisorPlugin = (routingUrl: string): GraphiQLPlugin => ({
  title: 'Defer Advisor',
  icon: TbHourglass,
  content: () => <DeferAdvisorPluginContent routingUrl={routingUrl} />,
});
