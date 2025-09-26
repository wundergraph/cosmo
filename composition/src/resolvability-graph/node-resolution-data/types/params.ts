import { FieldName, TypeName } from '../../types/types';
import { GraphFieldData } from '../../../utils/types';

export type NodeResolutionDataParams = {
  fieldDataByName: Map<FieldName, GraphFieldData>;
  typeName: TypeName;
  isResolved?: boolean;
  resolvedDescendentNames?: Set<FieldName>;
  resolvedFieldNames?: Set<FieldName>;
};