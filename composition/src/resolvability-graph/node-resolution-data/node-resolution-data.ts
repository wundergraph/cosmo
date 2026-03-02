import { GraphFieldData } from '../../utils/types';
import { unexpectedEdgeFatalError } from '../../errors/errors';
import { FieldName } from '../types/types';
import { AddExternalSubgraphNameParams, NodeResolutionDataParams } from './types/params';

export class NodeResolutionData {
  #isResolved = false;
  readonly fieldDataByName: ReadonlyMap<FieldName, GraphFieldData>;
  resolvedDescendantNames: Set<FieldName>;
  resolvedFieldNames: Set<FieldName>;
  typeName: string;

  constructor({
    fieldDataByName,
    isResolved = false,
    resolvedDescendantNames,
    resolvedFieldNames,
    typeName,
  }: NodeResolutionDataParams) {
    this.#isResolved = isResolved;
    this.fieldDataByName = fieldDataByName;
    this.resolvedDescendantNames = new Set<FieldName>(resolvedDescendantNames);
    this.resolvedFieldNames = new Set<FieldName>(resolvedFieldNames);
    this.typeName = typeName;
  }

  addData({ resolvedDescendantNames, resolvedFieldNames }: NodeResolutionData) {
    for (const fieldName of resolvedFieldNames) {
      this.addResolvedFieldName(fieldName);
    }
    for (const fieldName of resolvedDescendantNames) {
      this.resolvedDescendantNames.add(fieldName);
    }
  }

  addResolvedFieldName(fieldName: FieldName) {
    if (!this.fieldDataByName.has(fieldName)) {
      throw unexpectedEdgeFatalError(this.typeName, [fieldName]);
    }
    this.resolvedFieldNames.add(fieldName);
  }

  addExternalSubgraphName({ fieldName, subgraphName }: AddExternalSubgraphNameParams) {
    const fieldData = this.fieldDataByName.get(fieldName);
    if (!fieldData) {
      throw unexpectedEdgeFatalError(this.typeName, [fieldName]);
    }
    fieldData.externalSubgraphNames.add(subgraphName);
  }

  copy(): NodeResolutionData {
    return new NodeResolutionData({
      // Only used for reading, so just a shallow copy.
      fieldDataByName: this.fieldDataByName,
      isResolved: this.#isResolved,
      resolvedDescendantNames: this.resolvedDescendantNames,
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
