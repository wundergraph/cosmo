import { Kind, ListTypeNode, NamedTypeNode, NonNullTypeNode, TypeNode } from 'graphql';
import { maximumTypeNestingExceededError } from '../../errors/errors';
import { getMutableTypeNode, MutableIntermediateTypeNode } from '../../schema-building/ast';
import { stringToNameNode } from '../../ast/utils';
import { FieldData } from '../../schema-building/types';
import { MAXIMUM_TYPE_NESTING } from '../../utils/integer-constants';

export enum DivergentType {
  NONE,
  CURRENT,
  OTHER,
}

export type FederateTypeSuccess = {
  success: true;
  typeNode: TypeNode;
};

export type FederateTypeFailure = {
  success: false;
};

export type FederateTypeResult = FederateTypeSuccess | FederateTypeFailure;

export type FederateTypeParams = {
  current: TypeNode;
  other: TypeNode;
  coords: string;
  mostRestrictive: boolean;
};

export type GetMergedTypeFailure = {
  actualType: string;
  expectedType: string;
  success: false;
};

export type GetMergedTypeSuccess = {
  success: true;
  typeNode: TypeNode;
};

export type GetMergedTypeResult = GetMergedTypeFailure | GetMergedTypeSuccess;

function getMergedTypeNode(
  current: TypeNode,
  other: TypeNode,
  hostPath: string,
  mostRestrictive: boolean,
  errors: Array<Error>,
): GetMergedTypeResult {
  other = getMutableTypeNode(other, hostPath, errors); // current is already a deep copy
  // The first type of the pair to diverge in restriction takes precedence in all future differences.
  // If the other type of the pair also diverges, it's an error.
  // To keep the output link intact, it is not possible to spread assign "lastTypeNode".
  const mergedTypeNode: MutableIntermediateTypeNode = { kind: current.kind };
  let divergentType = DivergentType.NONE;
  let lastTypeNode: MutableIntermediateTypeNode = mergedTypeNode;
  for (let i = 0; i < MAXIMUM_TYPE_NESTING; i++) {
    if (current.kind === other.kind) {
      switch (current.kind) {
        case Kind.NAMED_TYPE:
          const otherName = (other as NamedTypeNode).name.value;
          if (current.name.value !== otherName) {
            return { actualType: otherName, expectedType: current.name.value, success: false };
          }
          lastTypeNode.kind = current.kind;
          lastTypeNode.name = current.name;
          return { success: true, typeNode: mergedTypeNode as TypeNode };
        case Kind.LIST_TYPE:
          lastTypeNode.kind = current.kind;
          lastTypeNode.type = { kind: current.type.kind };
          lastTypeNode = lastTypeNode.type;
          current = current.type;
          other = (other as ListTypeNode).type;
          continue;
        case Kind.NON_NULL_TYPE:
          lastTypeNode.kind = current.kind;
          lastTypeNode.type = { kind: current.type.kind };
          lastTypeNode = lastTypeNode.type;
          current = current.type;
          other = (other as NonNullTypeNode).type;
          continue;
      }
    }
    if (current.kind === Kind.NON_NULL_TYPE) {
      if (divergentType === DivergentType.OTHER) {
        return { actualType: other.kind, expectedType: current.kind, success: false };
      } else {
        divergentType = DivergentType.CURRENT;
      }
      if (mostRestrictive) {
        lastTypeNode.kind = current.kind;
        lastTypeNode.type = { kind: current.type.kind };
        lastTypeNode = lastTypeNode.type;
      }
      current = current.type;
      continue;
    }
    if (other.kind === Kind.NON_NULL_TYPE) {
      if (divergentType === DivergentType.CURRENT) {
        return { actualType: other.kind, expectedType: current.kind, success: false };
      } else {
        divergentType = DivergentType.OTHER;
      }
      if (mostRestrictive) {
        lastTypeNode.kind = other.kind;
        lastTypeNode.type = { kind: other.type.kind };
        lastTypeNode = lastTypeNode.type;
      }
      other = other.type;
      continue;
    }
    // At least one of the types must be a non-null wrapper, or the types are inconsistent
    return { actualType: other.kind, expectedType: current.kind, success: false };
  }
  errors.push(maximumTypeNestingExceededError(hostPath));
  return { success: true, typeNode: current };
}

export function getLeastRestrictiveMergedTypeNode(
  current: TypeNode,
  other: TypeNode,
  hostPath: string,
  errors: Error[],
): GetMergedTypeResult {
  return getMergedTypeNode(current, other, hostPath, false, errors);
}

export function getMostRestrictiveMergedTypeNode(
  current: TypeNode,
  other: TypeNode,
  hostPath: string,
  errors: Error[],
): GetMergedTypeResult {
  return getMergedTypeNode(current, other, hostPath, true, errors);
}

export function renameNamedTypeName(fieldData: FieldData, newNamedTypeName: string, errors: Error[]) {
  let typeNode = fieldData.type;
  for (let i = 0; i < MAXIMUM_TYPE_NESTING; i++) {
    if (typeNode.kind === Kind.NAMED_TYPE) {
      fieldData.namedTypeName = newNamedTypeName;
      typeNode.name = stringToNameNode(newNamedTypeName);
      return;
    }
    typeNode = typeNode.type;
  }
  // Use a dummy renamed type if the traversal fails
  fieldData.type = { kind: Kind.NAMED_TYPE, name: stringToNameNode(newNamedTypeName) };
  errors.push(maximumTypeNestingExceededError(`${fieldData.originalParentTypeName}.${fieldData.name}`));
}
