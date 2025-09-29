import { GraphFieldData } from '../../utils/types';
import { unexpectedEdgeFatalError } from '../../errors/errors';
import { FieldName, SubgraphName } from '../types/types';
import { NodeResolutionDataParams } from './types/params';

export class NodeResolutionData {
  #isResolved = false;
  fieldDataByName: Map<FieldName, GraphFieldData>;
  resolvedDescendantNames: Set<FieldName>;
  resolvedFieldNames: Set<FieldName>;
  typeName: string;

  constructor({
    fieldDataByName,
    isResolved = false,
    resolvedDescendentNames,
    resolvedFieldNames,
    typeName,
  }: NodeResolutionDataParams) {
    this.#isResolved = isResolved;
    this.fieldDataByName = fieldDataByName;
    this.resolvedDescendantNames = new Set<FieldName>(resolvedDescendentNames);
    this.resolvedFieldNames = new Set<FieldName>(resolvedFieldNames);
    this.typeName = typeName;
  }

  addResolvedFieldName(fieldName: FieldName) {
    if (!this.fieldDataByName.has(fieldName)) {
      throw unexpectedEdgeFatalError(this.typeName, [fieldName]);
    }
    this.resolvedFieldNames.add(fieldName);
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
      isResolved: this.#isResolved,
      resolvedDescendentNames: this.resolvedDescendantNames,
      resolvedFieldNames: this.resolvedFieldNames,
      typeName: this.typeName,
    });
  }

  areDescendantsResolved(): boolean {
    return this.fieldDataByName.size === this.resolvedDescendantNames.size;
  }

  isResolved(): boolean {
    if (this.#isResolved) {
      return true;
    }
    if (this.fieldDataByName.size !== this.resolvedFieldNames.size) {
      return false;
    }
    for (const fieldName of this.fieldDataByName.keys()) {
      if (!this.resolvedFieldNames.has(fieldName)) {
        return false;
      }
    }
    this.#isResolved = true;
    return true;
  }
}
