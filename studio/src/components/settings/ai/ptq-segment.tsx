import { AiSegment, SimpleAiSegmentProps } from './ai-segment';
import { Feature } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';

export function PtQSegment({ organization }: SimpleAiSegmentProps) {
  const feature = organization.features.find((f) => f.id === 'prompt-to-query');
  const isFeatureEnabled = feature?.enabled;
  if (!feature) {
    return null;
  }

  return (
    <AiSegment organization={organization} feature={Feature.promptToQuery} isEnabled={isFeatureEnabled ?? false}>
      Prompt-to-Query
    </AiSegment>
  );
}
