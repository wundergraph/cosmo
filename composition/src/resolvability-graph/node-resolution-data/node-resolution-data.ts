import { type GraphFieldData } from '../../utils/types';
import { unexpectedEdgeFatalError } from '../../errors/errors';
import { type FieldName } from '../types/types';
import { type AddExternalSubgraphNameParams, type NodeResolutionDataParams } from './types/params';
import { CompactSet } from '../../utils/compact-collections';

export class NodeResolutionData {
  #isResolved = false;
  // Whether the Sets are shared copy-on-write with another instance (see copy()).
  #isShared = false;
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
    this.resolvedDescendantNames = resolvedDescendantNames
      ? CompactSet.from(resolvedDescendantNames)
      : new CompactSet<FieldName>();
    this.resolvedFieldNames = resolvedFieldNames ? CompactSet.from(resolvedFieldNames) : new CompactSet<FieldName>();
    this.typeName = typeName;
  }

  // Clones the Sets before the first mutation if they are still shared with another instance.
  #materialize() {
    if (!this.#isShared) {
      return;
    }
    this.resolvedDescendantNames = CompactSet.from(this.resolvedDescendantNames);
    this.resolvedFieldNames = CompactSet.from(this.resolvedFieldNames);
    this.#isShared = false;
  }

  addData({ resolvedDescendantNames, resolvedFieldNames }: NodeResolutionData) {
    this.#materialize();
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
    this.#materialize();
    this.resolvedFieldNames.add(fieldName);
  }

  addResolvedDescendantName(fieldName: FieldName) {
    this.#materialize();
    this.resolvedDescendantNames.add(fieldName);
  }

  addExternalSubgraphName({ fieldName, subgraphName }: AddExternalSubgraphNameParams) {
    const fieldData = this.fieldDataByName.get(fieldName);
    if (!fieldData) {
      throw unexpectedEdgeFatalError(this.typeName, [fieldName]);
    }
    (fieldData.externalSubgraphNames ??= new CompactSet()).add(subgraphName);
  }

  copy(): NodeResolutionData {
    const copy = new NodeResolutionData({
      // Only used for reading, so just a shallow copy.
      fieldDataByName: this.fieldDataByName,
      isResolved: this.#isResolved,
      typeName: this.typeName,
    });
    // The Sets are shared copy-on-write; either instance clones them before its first mutation.
    copy.resolvedDescendantNames = this.resolvedDescendantNames;
    copy.resolvedFieldNames = this.resolvedFieldNames;
    copy.#isShared = true;
    this.#isShared = true;
    return copy;
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
