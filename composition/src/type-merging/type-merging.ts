import { Kind, ListTypeNode, NamedTypeNode, NonNullTypeNode, TypeNode } from 'graphql';
import { federationUnexpectedNodeKindError, unexpectedTypeNodeKindError } from '../errors/errors';
import { deepCopyTypeNode, maximumTypeNesting, MutableTypeNode } from '../ast/ast';

enum DivergentType {
  NONE,
  CURRENT,
  OTHER,
}

export type MergedTypeResult = {
  typeErrors?: string[];
  typeNode?: TypeNode;
};

function getMergedTypeNode(
  current: TypeNode,
  other: TypeNode,
  parentName: string,
  childName: string,
  mostRestrictive: boolean,
): MergedTypeResult {
  other = deepCopyTypeNode(other, parentName, childName); // current is already a deep copy
  // The first type of the pair to diverge in restriction takes precedence in all future differences.
  // If the other type of the pair also diverges, it's a src error.
  // To keep the output link intact, it is not possible to spread assign "lastTypeNode".
  const mergedTypeNode: MutableTypeNode = { kind: current.kind };
  let divergentType = DivergentType.NONE;
  let lastTypeNode: MutableTypeNode = mergedTypeNode;
  for (let i = 0; i < maximumTypeNesting; i++) {
    if (current.kind === other.kind) {
      switch (current.kind) {
        case Kind.NAMED_TYPE:
          const otherName = (other as NamedTypeNode).name.value;
          if (current.name.value !== otherName) {
            return { typeErrors: [current.name.value, otherName] };
          }
          lastTypeNode.kind = current.kind;
          lastTypeNode.name = current.name;
          return { typeNode: mergedTypeNode as TypeNode };
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
        default:
          throw federationUnexpectedNodeKindError(parentName, childName);
      }
    }
    if (current.kind === Kind.NON_NULL_TYPE) {
      if (divergentType === DivergentType.OTHER) {
        return { typeErrors: [current.kind, other.kind] };
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
        return {
          typeErrors: [other.kind, current.kind],
        };
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
    return { typeErrors: [current.kind, other.kind] };
  }
  throw new Error(
    `Field ${parentName}.${childName} has more than ${maximumTypeNesting} layers of nesting, or there is a cyclical error.`,
  );
}

export function getLeastRestrictiveMergedTypeNode(
  current: TypeNode,
  other: TypeNode,
  parentName: string,
  childName: string,
): MergedTypeResult {
  return getMergedTypeNode(current, other, parentName, childName, false);
}

export function getMostRestrictiveMergedTypeNode(
  current: TypeNode,
  other: TypeNode,
  parentName: string,
  fieldName: string,
): MergedTypeResult {
  return getMergedTypeNode(current, other, parentName, fieldName, true);
}

export function isTypeRequired(node: TypeNode): boolean {
  return node.kind === Kind.NON_NULL_TYPE;
}

export function getNamedTypeForChild(childPath: string, typeNode: TypeNode): string {
  switch (typeNode.kind) {
    case Kind.NAMED_TYPE:
      return typeNode.name.value;
    case Kind.LIST_TYPE:
    // intentional fallthrough
    case Kind.NON_NULL_TYPE:
      return getNamedTypeForChild(childPath, typeNode.type);
    default:
      throw unexpectedTypeNodeKindError(childPath);
  }
}
