import type { GraphiQLPlugin } from '@graphiql/react';
import { DeferAdvisorIcon } from './defer-advisor-icon';
import { DeferAdvisorPluginContent } from './defer-advisor-plugin-content';

export const createDeferAdvisorPlugin = (routingUrl: string): GraphiQLPlugin => ({
  title: 'Defer Advisor',
  icon: DeferAdvisorIcon,
  content: () => <DeferAdvisorPluginContent routingUrl={routingUrl} />,
});
