import { EmptyState } from '@/components/empty-state';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

export interface SchemaNotFoundProps {
  featureFlagName: string;
  featureSubgraphName?: string;
}

export const SchemaNotFound = ({ featureFlagName, featureSubgraphName }: SchemaNotFoundProps) => {
  return (
    <EmptyState
      icon={<ExclamationTriangleIcon />}
      title="Schema not found"
      description={`${featureSubgraphName ?? 'The selected feature subgraph'} is not part of the latest composition of feature flag ${featureFlagName}. The flag may have been deleted or disabled, its latest composition may have failed, or the feature subgraph may have been removed from it.`}
    />
  );
};
