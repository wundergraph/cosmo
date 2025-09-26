import { GraphFieldData } from '../../utils/types';
import { getEntriesNotInHashSet } from '../../utils/utils';
import { unexpectedEdgeFatalError } from '../../errors/errors';
import { FieldName, SubgraphName } from '../types/types';
import { NodeResolutionDataParams } from './types/params';

export class NodeResolutionData {
  fieldDataByName: Map<FieldName, GraphFieldData>;
  isResolved: boolean
  resolvedDescendentNames: Set<FieldName>;
  resolvedFieldNames: Set<FieldName>;
  typeName: string;

  constructor({
    fieldDataByName,
    isResolved = false,
    resolvedDescendentNames,
    resolvedFieldNames,
    typeName,
  }: NodeResolutionDataParams) {
    this.fieldDataByName = fieldDataByName;
    this.isResolved = isResolved;
    this.resolvedDescendentNames = new Set<FieldName>(resolvedDescendentNames);
    this.resolvedFieldNames = new Set<FieldName>(resolvedFieldNames);
    this.typeName = typeName;
  }

  add(fieldName: FieldName): boolean {
    this.resolvedFieldNames.add(fieldName);
    if (this.resolvedFieldNames.size > this.fieldDataByName.size) {
      const unexpectedEntries = getEntriesNotInHashSet(this.resolvedFieldNames, this.fieldDataByName);
      throw unexpectedEdgeFatalError(this.typeName, unexpectedEntries);
    }
    this.isResolved = this.resolvedFieldNames.size === this.fieldDataByName.size;
    return this.isResolved;
  }

  copy(): NodeResolutionData {
    const fieldDataByName = new Map<FieldName, GraphFieldData>();
    for (const [fieldName, data] of this.fieldDataByName) {
      fieldDataByName.set(fieldName, {
        isLeaf: data.isLeaf,
        name: data.name,
        namedTypeName: data.namedTypeName,
        subgraphNames: new Set<SubgraphName>(data.subgraphNames),
      });
    }
    return new NodeResolutionData({
      fieldDataByName: this.fieldDataByName,
      isResolved: this.isResolved,
      resolvedDescendentNames: this.resolvedDescendentNames,
      resolvedFieldNames: this.resolvedFieldNames,
      typeName: this.typeName,
    });
  }

  areDescendentsResolved(): boolean {
    return this.fieldDataByName.size === this.resolvedDescendentNames.size;
  }
}