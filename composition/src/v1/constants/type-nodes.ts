import { Kind, type TypeNode } from 'graphql';
import { stringToNamedTypeNode } from '../../ast/utils';
import { FIELD_SET_SCALAR, INT_SCALAR, STRING_SCALAR } from '../../utils/string-constants';

export const REQUIRED_STRING_TYPE_NODE: TypeNode = {
  kind: Kind.NON_NULL_TYPE,
  type: stringToNamedTypeNode(STRING_SCALAR),
};

export const REQUIRED_INT_TYPE_NODE: TypeNode = {
  kind: Kind.NON_NULL_TYPE,
  type: stringToNamedTypeNode(INT_SCALAR),
};

export const REQUIRED_FIELDSET_TYPE_NODE: TypeNode = {
  kind: Kind.NON_NULL_TYPE,
  type: stringToNamedTypeNode(FIELD_SET_SCALAR),
};
