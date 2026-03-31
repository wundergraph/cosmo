import { type FieldName, type SubgraphName, type TypeName } from '../../types/types';
import { type GraphFieldData } from '../../../utils/types';

export type NodeResolutionDataParams = {
  readonly fieldDataByName: ReadonlyMap<FieldName, GraphFieldData>;
  typeName: TypeName;
  isResolved?: boolean;
  resolvedDescendantNames?: Set<FieldName>;
  resolvedFieldNames?: Set<FieldName>;
};

export type AddExternalSubgraphNameParams = {
  fieldName: FieldName;
  subgraphName: SubgraphName;
};
