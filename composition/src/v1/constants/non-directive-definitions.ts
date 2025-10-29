import { EnumTypeDefinitionNode, InputObjectTypeDefinitionNode, Kind, ScalarTypeDefinitionNode } from 'graphql';
import { stringToNamedTypeNode, stringToNameNode } from '../../ast/utils';
import {
  AND_UPPER,
  CONSUMER_INACTIVE_THRESHOLD,
  CONSUMER_NAME,
  EDFS_NATS_STREAM_CONFIGURATION,
  EXECUTION,
  FIELD_PATH,
  FIELD_SET_SCALAR,
  IN_UPPER,
  INT_SCALAR,
  LINK_IMPORT,
  LINK_PURPOSE,
  NOT_UPPER,
  OR_UPPER,
  SCOPE_SCALAR,
  SECURITY,
  STREAM_NAME,
  STRING_SCALAR,
  SUBSCRIPTION_FIELD_CONDITION,
  SUBSCRIPTION_FILTER_CONDITION,
  SUBSCRIPTION_FILTER_VALUE,
  VALUES,
} from '../../utils/string-constants';
import { DEFAULT_CONSUMER_INACTIVE_THRESHOLD } from './integers';

/*
 * input edfs__NatsStreamConfiguration {
 *   consumerInactiveThreshold : Int! = 30
 *   consumerName: String!
 *   streamName: String!
 * }
 * */
export const EDFS_NATS_STREAM_CONFIGURATION_DEFINITION: InputObjectTypeDefinitionNode = {
  kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
  name: stringToNameNode(EDFS_NATS_STREAM_CONFIGURATION),
  fields: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(CONSUMER_INACTIVE_THRESHOLD),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(INT_SCALAR),
      },
      defaultValue: {
        kind: Kind.INT,
        value: DEFAULT_CONSUMER_INACTIVE_THRESHOLD.toString(),
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(CONSUMER_NAME),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(STREAM_NAME),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
    },
  ],
};

// scalar openfed__FieldSet
export const FIELD_SET_SCALAR_DEFINITION: ScalarTypeDefinitionNode = {
  kind: Kind.SCALAR_TYPE_DEFINITION,
  name: stringToNameNode(FIELD_SET_SCALAR),
};

// scalar link__Import
export const LINK_IMPORT_DEFINITION: ScalarTypeDefinitionNode = {
  kind: Kind.SCALAR_TYPE_DEFINITION,
  name: stringToNameNode(LINK_IMPORT),
};

/*
 * enum link__Purpose {
 *   EXECUTION
 *   SECURITY
 * }
 */
export const LINK_PURPOSE_DEFINITION: EnumTypeDefinitionNode = {
  kind: Kind.ENUM_TYPE_DEFINITION,
  name: stringToNameNode(LINK_PURPOSE),
  values: [
    {
      directives: [],
      kind: Kind.ENUM_VALUE_DEFINITION,
      name: stringToNameNode(EXECUTION),
    },
    {
      directives: [],
      kind: Kind.ENUM_VALUE_DEFINITION,
      name: stringToNameNode(SECURITY),
    },
  ],
};

// scalar openfed__Scope
export const SCOPE_SCALAR_DEFINITION: ScalarTypeDefinitionNode = {
  kind: Kind.SCALAR_TYPE_DEFINITION,
  name: stringToNameNode(SCOPE_SCALAR),
};

/* input openfed__SubscriptionFieldCondition {
 *   fieldPath: String!
 *   values: [openfed__SubscriptionFilterValue]!
 * }
 */
export const SUBSCRIPTION_FIELD_CONDITION_DEFINITION: InputObjectTypeDefinitionNode = {
  fields: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(FIELD_PATH),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(VALUES),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: {
          kind: Kind.LIST_TYPE,
          type: stringToNamedTypeNode(SUBSCRIPTION_FILTER_VALUE),
        },
      },
    },
  ],
  kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
  name: stringToNameNode(SUBSCRIPTION_FIELD_CONDITION),
};

/* input openfed__SubscriptionFilterCondition {
 *   AND: [openfed__SubscriptionFilterCondition!]
 *   IN: openfed__SubscriptionFieldCondition
 *   NOT: openfed__SubscriptionFilterCondition
 *   OR: [openfed__SubscriptionFilterCondition!]
 * }
 */
export const SUBSCRIPTION_FILTER_CONDITION_DEFINITION: InputObjectTypeDefinitionNode = {
  fields: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(AND_UPPER),
      type: {
        kind: Kind.LIST_TYPE,
        type: {
          kind: Kind.NON_NULL_TYPE,
          type: stringToNamedTypeNode(SUBSCRIPTION_FILTER_CONDITION),
        },
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(IN_UPPER),
      type: stringToNamedTypeNode(SUBSCRIPTION_FIELD_CONDITION),
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(OR_UPPER),
      type: {
        kind: Kind.LIST_TYPE,
        type: {
          kind: Kind.NON_NULL_TYPE,
          type: stringToNamedTypeNode(SUBSCRIPTION_FILTER_CONDITION),
        },
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(NOT_UPPER),
      type: stringToNamedTypeNode(SUBSCRIPTION_FILTER_CONDITION),
    },
  ],
  kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
  name: stringToNameNode(SUBSCRIPTION_FILTER_CONDITION),
};

// scalar openfed__SubscriptionFilterValue
export const SUBSCRIPTION_FILTER_VALUE_DEFINITION: ScalarTypeDefinitionNode = {
  kind: Kind.SCALAR_TYPE_DEFINITION,
  name: stringToNameNode(SUBSCRIPTION_FILTER_VALUE),
};
