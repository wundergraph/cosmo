import type { GraphiQLPlugin } from '@graphiql/react';
import { DeferAdvisorIcon } from './defer-advisor-icon';
import { DeferAdvisorPluginContent } from './defer-advisor-plugin-content';

export const createDeferAdvisorPlugin = (): GraphiQLPlugin => ({
  title: 'Defer',
  icon: DeferAdvisorIcon,
  content: DeferAdvisorPluginContent,
});
