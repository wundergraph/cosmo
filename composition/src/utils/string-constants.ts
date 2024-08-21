import { Kind } from 'graphql';

export const AND_UPPER = 'AND';
export const ANY_SCALAR = '_Any';
export const ARGUMENT = 'argument';
export const AUTHENTICATED = 'authenticated';
export const ARGUMENT_DEFINITION_UPPER = 'ARGUMENT_DEFINITION';
export const BOOLEAN = 'boolean';
export const BOOLEAN_SCALAR = 'Boolean';
export const COMPOSE_DIRECTIVE = 'composeDirective';
export const CONDITION = 'condition';
export const CONSUMER_NAME = 'consumerName';
export const DEFAULT = 'default';
export const DEFAULT_EDFS_PROVIDER_ID = 'default';
export const DEFAULT_MUTATION = 'Mutation';
export const DEFAULT_QUERY = 'Query';
export const DEFAULT_SUBSCRIPTION = 'Subscription';
export const DEPRECATED = 'deprecated';
export const DEPRECATED_DEFAULT_ARGUMENT_VALUE = 'No longer supported';
export const DIRECTIVE_DEFINITION = 'directive definition';
export const EDFS_KAFKA_PUBLISH = 'edfs__kafkaPublish';
export const EDFS_KAFKA_SUBSCRIBE = 'edfs__kafkaSubscribe';
export const EDFS_NATS_PUBLISH = 'edfs__natsPublish';
export const EDFS_NATS_REQUEST = 'edfs__natsRequest';
export const EDFS_NATS_SUBSCRIBE = 'edfs__natsSubscribe';
export const EDFS_PUBLISH_RESULT = 'edfs__PublishResult';
export const EDFS_NATS_STREAM_CONFIGURATION = 'edfs__NatsStreamConfiguration';
export const ENTITIES = 'entities';
export const ENTITIES_FIELD = '_entities';
export const ENTITY_UNION = '_Entity';
export const ENUM_UPPER = 'ENUM';
export const ENUM_VALUE_UPPER = 'ENUM_VALUE';
export const EXTERNAL = 'external';
export const EXTENDS = 'extends';
export const EXTENSIONS = 'extensions';
export const FIELD = 'field';
export const FIELD_PATH = 'fieldPath';
export const FIELD_UPPER = 'FIELD';
export const FIELD_SET_SCALAR = 'openfed__FieldSet';
export const FIELDS = 'fields';
export const FIELD_DEFINITION_UPPER = 'FIELD_DEFINITION';
export const FLOAT_SCALAR = 'Float';
export const FRAGMENT_DEFINITION_UPPER = 'FRAGMENT_DEFINITION';
export const FRAGMENT_SPREAD_UPPER = 'FRAGMENT_SPREAD';
export const FROM = 'from';
export const IN_UPPER = 'IN';
export const INACCESSIBLE = 'inaccessible';
export const INLINE_FRAGMENT = 'inlineFragment';
export const INLINE_FRAGMENT_UPPER = 'INLINE_FRAGMENT';
export const INPUT_FIELD = 'input field';
export const INPUT_FIELD_DEFINITION_UPPER = 'INPUT_FIELD_DEFINITION';
export const INPUT_OBJECT = 'input object';
export const INPUT_OBJECT_UPPER = 'INPUT_OBJECT';
export const INT_SCALAR = 'Int';
export const INTERFACE_UPPER = 'INTERFACE';
export const INTERFACE_OBJECT = 'interfaceObject';
export const KEY = 'key';
export const LINK = 'link';
export const LIST = 'list';
export const LITERAL_SPACE = ' ';
export const LITERAL_NEW_LINE = '\n';
export const NUMBER = 'number';
export const MUTATION = 'Mutation';
export const MUTATION_UPPER = 'MUTATION';
export const PROVIDER_TYPE_KAFKA = 'kafka';
export const PROVIDER_TYPE_NATS = 'nats';
export const N_A = 'N/A';
export const NAME = 'name';
export const NON_NULLABLE_EDFS_PUBLISH_EVENT_RESULT = 'edfs__PublishResult!';
export const NON_NULLABLE_BOOLEAN = 'Boolean!';
export const NON_NULLABLE_STRING = 'String!';
export const NOT_UPPER = 'NOT';
export const NULL = 'null';
export const OPERATION_TO_DEFAULT = 'operationTypeNodeToDefaultType';
export const OBJECT = 'object';
export const OBJECT_UPPER = 'OBJECT';
export const OR_UPPER = 'OR';
export const OVERRIDE = 'override';
export const PARENT_DEFINITION_DATA = 'parentDefinitionDataByTypeName';
export const PARENT_DEFINITION_DATA_MAP = 'parentDefinitionDataByParentTypeName';
export const PARENT_EXTENSION_DATA_MAP = 'parentExtensionDataByParentTypeName';
export const PERIOD = '.';
export const PROVIDER_ID = 'providerId';
export const PROVIDES = 'provides';
export const PUBLISH = 'publish';
export const QUERY = 'Query';
export const QUERY_UPPER = 'QUERY';
export const QUOTATION_JOIN = `", "`;
export const REASON = 'reason';
export const REQUEST = 'request';
export const REQUIRES = 'requires';
export const REQUIRES_SCOPES = 'requiresScopes';
export const RESOLVABLE = 'resolvable';
export const SCALAR_UPPER = 'SCALAR';
export const SCHEMA = 'schema';
export const SCHEMA_UPPER = 'SCHEMA';
export const SCOPES = 'scopes';
export const SCOPE_SCALAR = 'openfed__Scope';
export const SELECTION_REPRESENTATION = ' { ... }';
export const SERVICE_OBJECT = '_Service';
export const SERVICE_FIELD = '_service';
export const SHAREABLE = 'shareable';
export const SPECIFIED_BY = 'specifiedBy';
export const STREAM_CONFIGURATION = 'streamConfiguration';
export const STREAM_NAME = 'streamName';
export const STRING = 'string';
export const STRING_SCALAR = 'String';
export const SUBJECT = 'subject';
export const SUBJECTS = 'subjects';
export const SUBSCRIPTION = 'Subscription';
export const SUBSCRIPTION_FIELD_CONDITION = 'openfed__SubscriptionFieldCondition';
export const SUBSCRIPTION_FILTER = 'openfed__subscriptionFilter';
export const SUBSCRIPTION_FILTER_CONDITION = 'openfed__SubscriptionFilterCondition';
export const SUBSCRIPTION_FILTER_VALUE = 'openfed__SubscriptionFilterValue';
export const SUBSCRIBE = 'subscribe';
export const SUBSCRIPTION_UPPER = 'SUBSCRIPTION';
export const SUCCESS = 'success';
export const TAG = 'tag';
export const TOPIC = 'topic';
export const TOPICS = 'topics';
export const UNION = 'union';
export const UNION_UPPER = 'UNION';
export const URL_LOWER = 'url';
export const VALUES = 'values';
export const VARIABLE_DEFINITION_UPPER = 'VARIABLE_DEFINITION';

export const EXECUTABLE_DIRECTIVE_LOCATIONS = new Set<string>([
  FIELD_UPPER,
  FRAGMENT_DEFINITION_UPPER,
  FRAGMENT_SPREAD_UPPER,
  INLINE_FRAGMENT_UPPER,
  MUTATION_UPPER,
  QUERY_UPPER,
  SUBSCRIPTION_UPPER,
]);
export const IGNORED_PARENT_DIRECTIVES = new Set<string>([AUTHENTICATED, EXTENDS, REQUIRES_SCOPES]);
export const ROOT_TYPE_NAMES = new Set<string>([MUTATION, QUERY, SUBSCRIPTION]);
export const EVENT_DIRECTIVE_NAMES = new Set<string>([
  EDFS_KAFKA_PUBLISH,
  EDFS_KAFKA_SUBSCRIBE,
  EDFS_NATS_PUBLISH,
  EDFS_NATS_REQUEST,
  EDFS_NATS_SUBSCRIBE,
]);
export const STREAM_CONFIGURATION_FIELD_NAMES = new Set<string>([CONSUMER_NAME, STREAM_NAME]);
export const PERSISTED_CLIENT_DIRECTIVES = new Set<string>([AUTHENTICATED, DEPRECATED, REQUIRES_SCOPES]);
export const SUBSCRIPTION_FILTER_INPUT_NAMES = new Set<string>([AND_UPPER, IN_UPPER, NOT_UPPER, OR_UPPER]);
export const SUBSCRIPTION_FILTER_LIST_INPUT_NAMES = new Set<string>([AND_UPPER, OR_UPPER]);
export type RootTypeName = 'Mutation' | 'Query' | 'Subscription';
