import { type NormalizationSuccess } from '../../normalization/types';
import { type SubgraphName } from '../../types/types';

export type InternalSubgraphFromNormalizationParams = {
  normalization: NormalizationSuccess;
  subgraphName: SubgraphName;
};
