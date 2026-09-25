import { AiSegment, SimpleAiSegmentProps } from './ai-segment';
import { Feature } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { docsBaseURL } from '@/lib/constants';

export function CosmoAiSegment({ organization }: SimpleAiSegmentProps) {
  const isFeatureEnabled = organization.features.find((f) => f.id === 'ai')?.enabled;

  return (
    <AiSegment
      organization={organization}
      feature={Feature.ai}
      isEnabled={isFeatureEnabled ?? false}
      docsLink={docsBaseURL + '/studio/cosmo-ai'}
    >
      Enable generative AI to create documentation for your GraphQL schema or fix queries.
    </AiSegment>
  );
}
